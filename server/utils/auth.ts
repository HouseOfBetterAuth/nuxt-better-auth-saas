import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { createHash } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { admin as adminPlugin, anonymous, apiKey, openAPI, organization } from 'better-auth/plugins'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { appendResponseHeader, createError, getRequestHeaders } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { ensureDefaultOrganizationForUser, setUserActiveOrganization } from '~~/server/services/organization/provision'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'
import { logAuditEvent } from './auditLogger'
import { getDB } from './db'
import { cacheClient, resendInstance } from './drivers'
import { renderDeleteAccount, renderResetPassword, renderTeamInvite, renderVerifyEmail } from './email'
import { runtimeConfig } from './runtimeConfig'
import { createStripeClient, setupStripe } from './stripe'

// Only log in development
if (runtimeConfig.public.appEnv === 'development') {
  console.log(`Base URL is ${runtimeConfig.public.baseURL}`)
  console.log('Schema keys:', Object.keys(schema))
}

const trustedOrigins = [
  'http://localhost:8787',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:4000',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4000',
  runtimeConfig.public.baseURL
]

const parseConversationQuotaValue = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }
  return fallback
}

const CONVERSATION_QUOTA_SETTINGS = {
  anonymous: parseConversationQuotaValue((runtimeConfig.public as any)?.conversationQuota?.anonymous, 10),
  verified: parseConversationQuotaValue((runtimeConfig.public as any)?.conversationQuota?.verified, 50),
  paid: parseConversationQuotaValue((runtimeConfig.public as any)?.conversationQuota?.paid, 0)
} as const
const QUOTA_USAGE_THRESHOLDS = [0.5, 0.8, 1] as const

const getQuotaAdvisoryLockKeys = (organizationId: string): [number, number] => {
  const hash = createHash('sha256').update(`quota:${organizationId}`).digest()
  return [hash.readInt32BE(0), hash.readInt32BE(4)]
}

export const createBetterAuth = () => betterAuth({
  baseURL: `${runtimeConfig.public.baseURL}/api/auth`,
  trustedOrigins,
  secret: runtimeConfig.betterAuthSecret,
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // Cache for 5 minutes
    }
  },
  database: drizzleAdapter(
    getDB(),
    {
      provider: 'pg',
      schema
    }
  ),
  advanced: {
    database: {
      generateId: () => {
        return uuidv7()
      }
    }
  },
  user: {
    changeEmail: {
      enabled: true
    },
    deleteUser: {
      enabled: true,
      async sendDeleteAccountVerification({ user, url }) {
        if (resendInstance) {
          try {
            if (!user.email) {
              throw new Error('User email is required for delete verification')
            }
            if (!url) {
              throw new Error('Delete verification URL is required')
            }
            const name = user.name || user.email.split('@')[0]
            const html = await renderDeleteAccount(name, url)
            const response = await resendInstance.emails.send({
              from: runtimeConfig.emailFrom!,
              to: user.email,
              subject: 'Confirm account deletion',
              html
            })

            // Log success audit event
            await logAuditEvent({
              userId: user.id,
              category: 'email',
              action: 'delete_account_sent',
              targetType: 'email',
              targetId: user.email,
              status: response.error ? 'failure' : 'success',
              details: response.error?.message
            })

            if (response.error) {
              console.error('[Auth] Failed to send delete account email:', response.error.message)
              throw new Error(response.error.message)
            }
          } catch (e) {
            console.error('[Auth] Error sending delete account verification email:', e)
            // Log failure audit event
            await logAuditEvent({
              userId: user.id,
              category: 'email',
              action: 'delete_account_failed',
              targetType: 'email',
              targetId: user.email,
              status: 'failure',
              details: e instanceof Error ? e.message : 'Unknown error'
            })
            // Rethrow to prevent account deletion if email fails
            throw e
          }
        }
      }
    },
    additionalFields: {
      referralCode: {
        type: 'string',
        required: false
      }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (ctx?.path?.startsWith('/callback')) {
            try {
              const additionalData = await getOAuthState()
              if (additionalData?.referralCode) {
                return {
                  data: {
                    ...user,
                    referralCode: additionalData.referralCode
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        },
        after: async (user) => {
          // Immediately create an anonymous organization for anonymous users
          // This ensures they always have a valid organization context
          if (user.isAnonymous) {
            const db = getDB()
            let anonymousOrgId: string | null = null
            try {
              await db.transaction(async (tx) => {
                const [newOrg] = await tx
                  .insert(schema.organization)
                  .values({
                    id: uuidv7(),
                    name: 'Anonymous Workspace',
                    slug: `anonymous-${user.id}`,
                    createdAt: new Date(),
                    // Store device fingerprint if available in context/headers?
                    // Ideally we'd capture this, but for now just creating the org is the priority.
                    metadata: JSON.stringify({ isAnonymous: true })
                  })
                  .returning()

                if (!newOrg)
                  return

                anonymousOrgId = newOrg.id
                await tx.insert(schema.member).values({
                  id: uuidv7(),
                  userId: user.id,
                  organizationId: newOrg.id,
                  role: 'owner',
                  createdAt: new Date()
                })

                // Organization is now managed by Better Auth's organization plugin
              })
            } catch (error) {
              console.error('[Auth] Failed to create anonymous organization - aborting user creation:', error)
              // Rethrow to prevent user from being created without a valid organization
              throw new Error('Failed to provision anonymous workspace', { cause: error })
            }

            if (anonymousOrgId) {
              await setUserActiveOrganization(user.id, anonymousOrgId)
            }
          } else {
            await ensureDefaultOrganizationForUser(user)
          }
        }
      },
      update: {
        before: async (user, ctx) => {
          // Capture previous email before update to detect changes
          if (user.id) {
            const db = getDB()
            const previousUser = await db.query.user.findFirst({
              where: eq(schema.user.id, user.id)
            })
            // Store previous email in context for use in after hook
            if (previousUser) {
              (ctx as any).previousEmail = previousUser.email
            }
          }
        },
        after: async (user, ctx) => {
          // When user email changes, update Stripe customer email for orgs they own
          // Only sync if email is verified (email ownership validation)
          const previousEmail = (ctx as any).previousEmail
          const emailChanged = previousEmail && previousEmail !== user.email

          if (user.email && user.emailVerified && emailChanged) {
            try {
              const db = getDB()

              // Log email update for audit
              await logAuditEvent({
                userId: user.id,
                category: 'email',
                action: 'email_updated',
                targetType: 'email',
                targetId: user.email,
                status: 'success',
                details: `Email changed from ${previousEmail} to ${user.email}`
              })

              // Find all orgs where this user is owner and has a Stripe customer
              const ownedOrgs = await db
                .select()
                .from(schema.member)
                .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
                .where(and(
                  eq(schema.member.userId, user.id),
                  eq(schema.member.role, 'owner')
                ))

              if (ownedOrgs.length > 0) {
                const stripe = createStripeClient()
                for (const row of ownedOrgs) {
                  const org = row.organization
                  if (org.stripeCustomerId) {
                    // Update customer email (used for receipts and communications)
                    // Also ensure customer name stays as org name (not cardholder name)
                    await stripe.customers.update(org.stripeCustomerId, {
                      email: user.email,
                      name: org.name
                    })

                    // Log Stripe sync for audit
                    await logAuditEvent({
                      userId: user.id,
                      category: 'payment',
                      action: 'stripe_customer_email_synced',
                      targetType: 'organization',
                      targetId: org.id,
                      status: 'success',
                      details: `Stripe customer ${org.stripeCustomerId} email updated to ${user.email}`
                    })
                  }
                }
              }
            } catch (e) {
              console.error('[Auth] Failed to update Stripe customer email:', e)
              // Log failure for audit
              await logAuditEvent({
                userId: user.id,
                category: 'email',
                action: 'email_update_failed',
                targetType: 'email',
                targetId: user.email,
                status: 'failure',
                details: e instanceof Error ? e.message : 'Unknown error'
              })
            }
          }
        }
      }
    },
    member: {
      create: {
        before: async (member: Record<string, any>) => {
          // Validate user exists before creating member
          // This prevents foreign key violations if user was deleted but session still exists
          if (member.userId) {
            if (process.env.NODE_ENV === 'development') {
              console.log('[Auth] member.create.before hook called for userId:', member.userId)
            }
            const db = getDB()
            const user = await db.query.user.findFirst({
              where: eq(schema.user.id, member.userId)
            })

            if (!user) {
              console.error('[Auth] Cannot create member: user does not exist:', member.userId)
              // Throw error - database hooks can throw to prevent the operation
              throw new APIError('INVALID_SESSION', {
                message: 'Invalid session: user not found. Please sign in again.'
              })
            }
            if (process.env.NODE_ENV === 'development') {
              console.log('[Auth] User validated, allowing member creation')
            }
          }
          // Return undefined to continue with default behavior
          return undefined
        }
      }
    },
    organization: {
      create: {
        before: async (org: Record<string, any>, ctx: any) => {
          try {
            const session = ctx.session || ctx.context?.session
            if (session?.user?.id) {
              const db = getDB()
              const user = await db.query.user.findFirst({
                where: eq(schema.user.id, session.user.id)
              })

              if (user?.referralCode) {
                return {
                  data: {
                    ...org,
                    referralCode: user.referralCode
                  }
                }
              }
            }
          } catch (error) {
            console.error('[Auth] Error in organization.create.before hook:', error)
            // Don't block organization creation if referral code lookup fails
          }
          // Return undefined to continue with default behavior
          return undefined
        }
      }
    },
    apiKey: {
      create: {
        before: async (key: any, _ctx: any) => {
          // Validate maximum 4 API keys per organization
          const metadata = key.metadata
          if (!metadata) {
            return // No organization restriction if no metadata
          }

          let orgId: string | undefined
          try {
            let meta: any = metadata
            // Handle potentially double-encoded JSON string
            if (typeof meta === 'string') {
              try {
                meta = JSON.parse(meta)
              } catch {
                // ignore
              }
            }
            // Try parsing again if it's still a string (double encoded)
            if (typeof meta === 'string') {
              try {
                meta = JSON.parse(meta)
              } catch {
                // ignore
              }
            }
            orgId = meta?.organizationId
          } catch {
            // Ignore parse error, no org restriction
            return
          }

          if (!orgId) {
            return // No organization restriction if no orgId in metadata
          }

          // Count existing API keys for this organization using database-side query
          // This avoids loading all keys into memory and scales better
          const db = getDB()

          // Use SQL to count keys where metadata contains the organizationId
          // Use text pattern matching which works for both JSON string and object formats
          // This is more reliable than JSONB casting which can fail on invalid JSON
          const result = await db
            .select({ count: count() })
            .from(schema.apiKey)
            .where(
              sql`(
                ${schema.apiKey.metadata} IS NOT NULL
                AND (
                  ${schema.apiKey.metadata}::text LIKE ${`%"organizationId":"${orgId}"%`}
                  OR ${schema.apiKey.metadata}::text LIKE ${`%'organizationId':'${orgId}'%`}
                )
              )`
            )

          const keyCount = result[0]?.count || 0

          if (keyCount >= 4) {
            throw new APIError('BAD_REQUEST', {
              message: 'Maximum of 4 API keys allowed per organization'
            })
          }
        }
      }
    }
  },
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      if (!user.email) {
        throw new Error('User email is required for password reset')
      }
      if (!url) {
        throw new Error('Password reset URL is required')
      }
      const name = user.name || user.email.split('@')[0]
      const html = await renderResetPassword(name, url)

      // Generate plain text version for better deliverability and accessibility
      const { render } = await import('@react-email/render')
      const { ResetPassword } = await import('../../emails/ResetPassword')
      const text = await render(ResetPassword({ name, url, appName: runtimeConfig.public.appName }), { plainText: true })

      // Only log links in development
      if (runtimeConfig.public.appEnv === 'development') {
        console.log('>>> RESET PASSWORD LINK <<<')
        console.log(`To: ${user.email}`)
        console.log(url)
        console.log('>>> ------------------------ <<<')
      }

      const response = await resendInstance.emails.send({
        from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
        to: user.email,
        subject: 'Reset your password',
        html,
        text
      })

      await logAuditEvent({
        userId: user.id,
        category: 'email',
        action: 'reset_password',
        targetType: 'email',
        targetId: user.email,
        status: response.error ? 'failure' : 'success',
        details: response.error?.message
      })

      if (response.error) {
        console.error(`Failed to send reset password email: ${response.error.message}`)
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error'
        })
      }
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!user.email) {
        throw new Error('User email is required for verification')
      }
      if (!url) {
        throw new Error('Verification URL is required')
      }
      // Only log links in development
      if (runtimeConfig.public.appEnv === 'development') {
        console.log('>>> EMAIL VERIFICATION LINK <<<')
        console.log(`To: ${user.email}`)
        console.log(url)
        console.log('>>> ------------------------ <<<')
      }
      try {
        const name = user.name || user.email.split('@')[0]
        const html = await renderVerifyEmail(name, url)
        const response = await resendInstance.emails.send({
          from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
          to: user.email,
          subject: 'Verify your email address',
          html
        })
        await logAuditEvent({
          userId: user.id,
          category: 'email',
          action: 'verification',
          targetType: 'email',
          targetId: user.email,
          status: response.error ? 'failure' : 'success',
          details: response.error?.message
        })
        if (response.error) {
          throw new Error(response.error.message)
        }
      } catch (e) {
        console.warn('Failed to send verification email:', e)
        // Only log links in development
        if (runtimeConfig.public.appEnv === 'development') {
          console.log('>>> MANUAL VERIFICATION LINK <<<')
          console.log(url)
          console.log('>>> ------------------------ <<<')
        }
      }
    }
  },
  socialProviders: {
    github: {
      clientId: runtimeConfig.githubClientId!,
      clientSecret: runtimeConfig.githubClientSecret!
    },
    google: {
      clientId: runtimeConfig.googleClientId!,
      clientSecret: runtimeConfig.googleClientSecret!
    }
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true
      // Better Auth v1.4.1+ enforces email matching between linked providers by default
      // allowDifferentEmails: true allows linking accounts with different email addresses
      // User notifications are handled in the frontend (see app/pages/[slug]/profile.vue)
      // Email verification is required before account creation, which provides additional security
    }
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const ipAddress = ctx.getHeader('x-forwarded-for')
        || ctx.getHeader('remoteAddress') || undefined
      const userAgent = ctx.getHeader('user-agent') || undefined

      let targetType
      let targetId
      if (ctx.context.session || ctx.context.newSession) {
        targetType = 'user'
        targetId = ctx.context.session?.user.id || ctx.context.newSession?.user.id
      } else if (['/sign-in/email', '/sign-up/email', 'forget-password'].includes(ctx.path)) {
        targetType = 'email'
        targetId = ctx.body.email || ''
      }
      const returned = ctx.context.returned
      if (returned && returned instanceof APIError) {
        const userId = ctx.context.newSession?.user.id
        if (ctx.path == '/callback/:id' && returned.status == 'FOUND' && userId) {
          const provider = ctx.params.id
          await logAuditEvent({
            userId,
            category: 'auth',
            action: ctx.path.replace(':id', provider),
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'success'
          })
        } else {
          await logAuditEvent({
            userId: ctx.context.session?.user.id,
            category: 'auth',
            action: ctx.path,
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'failure',
            details: returned.body?.message
          })
        }
      } else {
        if (['/sign-in/email', '/sign-up/email', '/forget-password', '/reset-password'].includes(ctx.path)) {
          let userId: string | undefined
          if (['/sign-in/email', '/sign-up/email'].includes(ctx.path)) {
            userId = ctx.context.newSession?.user.id
          } else {
            userId = ctx.context.session?.user.id
          }
          await logAuditEvent({
            userId,
            category: 'auth',
            action: ctx.path,
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'success'
          })
        }
      }

      const sessionUser = ctx.context.newSession?.user || ctx.context.session?.user
      const shouldEnsureOrganization = Boolean(sessionUser) && !sessionUser.isAnonymous && (
        Boolean(ctx.context.newSession)
        || ctx.path.startsWith('/organization/delete')
        || ctx.path.startsWith('/organization/leave')
      )

      if (shouldEnsureOrganization) {
        await ensureDefaultOrganizationForUser(sessionUser)
      }
    })
  },
  plugins: [
    ...(runtimeConfig.public.appEnv === 'development' ? [openAPI()] : []),
    anonymous({
      emailDomainName: (() => {
        try {
          const baseUrl = runtimeConfig.public.baseURL
          if (!baseUrl) {
            return undefined
          }
          const host = new URL(baseUrl).hostname
          return host.replace(/^www\./, '') || undefined
        } catch {
          return undefined
        }
      })()
    }),
    adminPlugin(),
    organization({
      ac,
      roles: {
        owner,
        admin,
        member
      },
      enableMetadata: true,
      async sendInvitationEmail({ email, inviter, organization, invitation }) {
        if (resendInstance) {
          try {
            const inviterEmail = inviter.user.email ?? ''
            const inviterName = inviter.user.name || inviterEmail.split('@')[0] || 'A teammate'
            const inviteUrl = `${runtimeConfig.public.baseURL}/invite/${invitation.id}`
            const html = await renderTeamInvite(inviterName, organization.name, inviteUrl)
            const response = await resendInstance.emails.send({
              from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
              to: email,
              subject: `You're invited to join ${organization.name}`,
              html
            })

            // Log success audit event
            await logAuditEvent({
              userId: inviter.user.id,
              category: 'email',
              action: 'invite_email_sent',
              targetType: 'invitation',
              targetId: invitation.id,
              status: response.error ? 'failure' : 'success',
              details: response.error
                ? response.error.message
                : `Invitation email sent to ${email} for organization ${organization.name} (${organization.id})`
            })

            if (response.error) {
              console.error('[Auth] Failed to send invitation email:', {
                inviterId: inviter.user.id,
                orgId: organization.id,
                invitationId: invitation.id,
                email,
                error: response.error.message
              })
              // Don't throw - allow invitation creation to continue even if email fails
            }
          } catch (e) {
            console.error('[Auth] Error sending invitation email:', {
              inviterId: inviter.user.id,
              orgId: organization.id,
              invitationId: invitation.id,
              email,
              error: e instanceof Error ? e.message : 'Unknown error'
            })

            // Log failure audit event
            await logAuditEvent({
              userId: inviter.user.id,
              category: 'email',
              action: 'invite_email_failed',
              targetType: 'invitation',
              targetId: invitation.id,
              status: 'failure',
              details: `Failed to send invitation email to ${email} for organization ${organization.name}: ${e instanceof Error ? e.message : 'Unknown error'}`
            })

            // Don't throw - allow invitation creation to continue even if email fails
          }
        }
      }
    }),
    apiKey({
      enableMetadata: true,
      schema: {
        apikey: {
          modelName: 'apiKey'
        }
      }
    }),
    setupStripe()
  ]
})

let _auth: ReturnType<typeof betterAuth>

// Used by npm run auth:schema only.
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/db/schema/auth.ts'))
if (isAuthSchemaCommand) {
  _auth = createBetterAuth()
}
export const auth = _auth!

interface RequireAuthOptions {
  allowAnonymous?: boolean
}

export const useServerAuth = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!_auth) {
      _auth = createBetterAuth()
    }
    return _auth
  } else {
    return createBetterAuth()
  }
}

const createAnonymousUserSession = async (event: H3Event) => {
  try {
    const serverAuth = useServerAuth()
    const headers = new Headers()
    const reqHeaders = getRequestHeaders(event)
    for (const [key, value] of Object.entries(reqHeaders)) {
      if (value)
        headers.set(key, value)
    }

    // Call the anonymous sign-in endpoint directly via the API
    const result = await (serverAuth.api as any).signInAnonymous({
      headers,
      returnHeaders: true
    } as any)

    if (!result) {
      console.error('[Auth] signInAnonymous returned no result')
      return null
    }

    if (result?.headers) {
      result.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() === 'set-cookie') {
          appendResponseHeader(event, 'set-cookie', value)
        }
      })
    }

    const userId = (result as any)?.response?.user?.id
    if (!userId) {
      console.error('[Auth] signInAnonymous did not return a user ID', { result })
      return null
    }

    const db = getDB()
    const [userRecord] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    if (!userRecord) {
      console.error('[Auth] User record not found after anonymous sign-in', { userId })
      return null
    }

    return userRecord
  } catch (error) {
    console.error('[Auth] Failed to create anonymous session', error)
    if (error instanceof Error) {
      console.error('[Auth] Error details:', error.message, error.stack)
    }
    return null
  }
}

export const getAuthSession = async (event: H3Event) => {
  const reqHeaders = getRequestHeaders(event)
  const headers = new Headers()
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value)
      headers.append(key, value)
  }

  const serverAuth = useServerAuth()
  const session = await serverAuth.api.getSession({
    headers
  })
  return session
}

export const requireAuth = async (event: H3Event, options: RequireAuthOptions = {}) => {
  if (event.context.user) {
    return event.context.user as User
  }

  const session = await getAuthSession(event)
  if (session?.user) {
    event.context.user = session.user
    return session.user as User
  }

  if (options.allowAnonymous) {
    const anonymousUser = await createAnonymousUserSession(event)
    if (anonymousUser) {
      event.context.user = anonymousUser
      return anonymousUser as User
    }
  }

  throw createError({
    statusCode: 401,
    statusMessage: 'Unauthorized'
  })
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const

const getOrganizationSubscriptionStatus = async (db: NodePgDatabase<typeof schema>, organizationId: string) => {
  const [activeSubscription] = await db
    .select({
      plan: schema.subscription.plan,
      status: schema.subscription.status
    })
    .from(schema.subscription)
    .where(and(
      eq(schema.subscription.referenceId, organizationId),
      inArray(schema.subscription.status, ACTIVE_SUBSCRIPTION_STATUSES)
    ))
    .limit(1)

  return {
    hasActiveSubscription: Boolean(activeSubscription),
    planLabel: activeSubscription ? 'Pro plan' : 'Starter plan'
  }
}

const resolveConversationQuotaProfile = (user: User | null, hasActiveSubscription: boolean) => {
  if (hasActiveSubscription) {
    return { profile: 'paid' as const, label: 'Pro plan' }
  }
  if (!user || user.isAnonymous || !user.emailVerified) {
    return { profile: 'anonymous' as const, label: 'Guest access' }
  }
  return { profile: 'verified' as const, label: 'Starter plan' }
}

const logQuotaUsageSnapshot = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  quota: ConversationQuotaUsageResult
) => {
  const thresholdsToLog: Array<{ threshold: number, ratio: number, used: number, limit: number }> = []
  try {
    await db.transaction(async (tx) => {
      const [lockKeyA, lockKeyB] = getQuotaAdvisoryLockKeys(organizationId)
      await tx.execute(sql`select pg_advisory_xact_lock(${lockKeyA}, ${lockKeyB})`)

      const [last] = await tx
        .select()
        .from(schema.quotaUsageLog)
        .where(eq(schema.quotaUsageLog.organizationId, organizationId))
        .orderBy(desc(schema.quotaUsageLog.createdAt))
        .limit(1)

      const hasMeaningfulChange = !last ||
        last.used !== quota.used ||
        (last.quotaLimit ?? null) !== (quota.limit ?? null) ||
        last.unlimited !== Boolean(quota.unlimited)

      if (!hasMeaningfulChange) {
        return
      }

      await tx.insert(schema.quotaUsageLog).values({
        organizationId,
        quotaLimit: quota.limit ?? null,
        used: quota.used,
        remaining: quota.remaining ?? (quota.limit !== null ? Math.max(0, quota.limit - quota.used) : null),
        profile: quota.profile,
        label: quota.label,
        unlimited: Boolean(quota.unlimited)
      })

      if (quota.limit && quota.limit > 0) {
        const ratio = quota.used / quota.limit
        const lastRatio = last && last.quotaLimit ? (last.used / last.quotaLimit) : 0
        for (const threshold of QUOTA_USAGE_THRESHOLDS) {
          if (ratio >= threshold && lastRatio < threshold) {
            thresholdsToLog.push({
              threshold,
              ratio,
              used: quota.used,
              limit: quota.limit
            })
          }
        }
      }
    })
  } catch (error) {
    console.error('Unable to log quota usage snapshot', error)
  }

  for (const event of thresholdsToLog) {
    await logAuditEvent({
      category: 'quota',
      action: `threshold_${Math.round(event.threshold * 100)}`,
      targetType: 'organization',
      targetId: organizationId,
      details: `Usage at ${Math.round(event.ratio * 100)}% (${event.used}/${event.limit}).`
    })
  }
}

export interface ConversationQuotaUsageResult {
  limit: number | null
  used: number
  remaining: number | null
  label: string
  unlimited: boolean
  profile: 'anonymous' | 'verified' | 'paid'
}

/**
 * Get device fingerprint for anonymous quota tracking
 * This prevents quota reset when cookies are cleared
 *
 * Uses Better Auth session data when available, falls back to request headers.
 * Follows Better Auth's IP address detection patterns.
 */
export const getDeviceFingerprint = async (
  db: NodePgDatabase<typeof schema>,
  event?: H3Event | null,
  userId?: string | null
): Promise<string | null> => {
  if (!event)
    return null

  try {
    let ipAddress = ''
    let userAgent = ''

    // Try to get IP/User-Agent from current session if available
    // This uses Better Auth's stored session data which is more reliable
    if (userId) {
      try {
        const [currentSession] = await db
          .select({
            ipAddress: schema.session.ipAddress,
            userAgent: schema.session.userAgent
          })
          .from(schema.session)
          .where(
            and(
              eq(schema.session.userId, userId),
              sql`${schema.session.expiresAt} > NOW()`
            )
          )
          .orderBy(desc(schema.session.createdAt))
          .limit(1)

        if (currentSession?.ipAddress)
          ipAddress = currentSession.ipAddress

        if (currentSession?.userAgent)
          userAgent = currentSession.userAgent
      } catch {
        // Fall through to request headers
      }
    }

    // Fall back to request headers if session data not available
    // This handles cases where cookies are cleared but we still need device tracking
    if (!ipAddress || !userAgent) {
      const headers = getRequestHeaders(event)

      // Better Auth uses X-Forwarded-For by default, but can be configured
      // We follow the same pattern for consistency
      // Handle both string and array formats (some proxies return arrays)
      if (!ipAddress) {
        const forwardedFor = headers['x-forwarded-for']
        const forwardedForStr = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
        ipAddress = forwardedForStr?.split(',')[0]?.trim()
          || headers['x-real-ip']
          || headers['cf-connecting-ip']
          || ''
      }

      if (!userAgent)
        userAgent = headers['user-agent'] || ''
    }

    // Need at least one identifier to create fingerprint
    if (!ipAddress && !userAgent)
      return null

    // Create a hash of IP + User-Agent for device identification
    // Using SHA-256 for security (same as Better Auth uses for signing)
    const fingerprint = `${ipAddress}|${userAgent}`
    const hash = createHash('sha256').update(fingerprint).digest('hex')
    return hash
  } catch {
    return null
  }
}

/**
 * Ensure device fingerprint is stored in anonymous organization metadata
 * This allows quota tracking across cookie clears
 *
 * Follows Better Auth patterns by using session data when available
 */
const ensureDeviceFingerprintInOrg = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  event?: H3Event | null,
  userId?: string | null
): Promise<void> => {
  if (!event)
    return

  const deviceFingerprint = await getDeviceFingerprint(db, event, userId)
  if (!deviceFingerprint)
    return

  try {
    // Check if organization is anonymous
    // Use atomic JSONB update to prevent race conditions
    // Only update if deviceFingerprint not already set
    const [org] = await db
      .select({
        id: schema.organization.id,
        slug: schema.organization.slug
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1)

    if (!org || !org.slug.startsWith('anonymous-'))
      return

    // Atomically update only if deviceFingerprint not already set
    // Uses JSONB operations to avoid race condition and ensure type safety
    // Uses parameterized query to prevent SQL injection
    await db
      .update(schema.organization)
      .set({
        metadata: sql`
          CASE
            WHEN ${schema.organization.metadata}::jsonb ? 'deviceFingerprint'
            THEN ${schema.organization.metadata}
            ELSE jsonb_set(
              COALESCE(${schema.organization.metadata}::jsonb, '{}'::jsonb),
              '{deviceFingerprint}',
              ${JSON.stringify(deviceFingerprint)}::jsonb
            )::text
          END
        `
      })
      .where(eq(schema.organization.id, organizationId))
  } catch (error) {
    // Silently fail - device fingerprint is optional
    console.error('Failed to store device fingerprint:', error)
  }
}

export const getConversationQuotaUsage = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  user: User | null,
  event?: H3Event | null
): Promise<ConversationQuotaUsageResult> => {
  const { hasActiveSubscription, planLabel } = await getOrganizationSubscriptionStatus(db, organizationId)
  const { profile, label } = resolveConversationQuotaProfile(user, hasActiveSubscription)
  const configuredLimit = CONVERSATION_QUOTA_SETTINGS[profile]
  const unlimited = profile === 'paid' && configuredLimit <= 0

  // Ensure device fingerprint is stored for anonymous organizations
  if (profile === 'anonymous' && event) {
    await ensureDeviceFingerprintInOrg(db, organizationId, event, user?.id || null)
  }

  let used = 0

  // For anonymous users, aggregate quota across all organizations from the same device
  // This prevents quota reset when cookies are cleared
  // Uses Better Auth session data when available for more reliable tracking
  if (profile === 'anonymous' && event) {
    const deviceFingerprint = await getDeviceFingerprint(db, event, user?.id || null)
    if (deviceFingerprint) {
      // Find all anonymous organizations with matching device fingerprint in metadata
      const anonymousOrgs = await db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(
          and(
            sql`${schema.organization.metadata}::jsonb @> ${JSON.stringify({ deviceFingerprint })}::jsonb`,
            sql`${schema.organization.slug} LIKE 'anonymous-%'`
          )
        )

      const orgIds = anonymousOrgs.map(org => org.id)

      if (orgIds.length > 0) {
        // Count conversations across all anonymous orgs from this device
        // Exclude archived/completed conversations from quota
        const [aggregateResult] = await db
          .select({ total: count() })
          .from(schema.conversation)
          .where(and(
            inArray(schema.conversation.organizationId, orgIds),
            sql`${schema.conversation.status} != 'archived'`,
            sql`${schema.conversation.status} != 'completed'`
          ))

        used = Number(aggregateResult?.total ?? 0) || 0
      } else {
        // Fallback to current organization if no device match found
        const [countResult] = await db
          .select({ total: count() })
          .from(schema.conversation)
          .where(and(
            eq(schema.conversation.organizationId, organizationId),
            sql`${schema.conversation.status} != 'archived'`,
            sql`${schema.conversation.status} != 'completed'`
          ))
        used = Number(countResult?.total ?? 0) || 0
      }
    } else {
      // Fallback to current organization if device fingerprint unavailable
      const [countResult] = await db
        .select({ total: count() })
        .from(schema.conversation)
        .where(and(
          eq(schema.conversation.organizationId, organizationId),
          sql`${schema.conversation.status} != 'archived'`,
          sql`${schema.conversation.status} != 'completed'`
        ))
      used = Number(countResult?.total ?? 0) || 0
    }
  } else {
    // For non-anonymous users, use organization-based quota
    const [countResult] = await db
      .select({ total: count() })
      .from(schema.conversation)
      .where(and(
        eq(schema.conversation.organizationId, organizationId),
        sql`${schema.conversation.status} != 'archived'`,
        sql`${schema.conversation.status} != 'completed'`
      ))
    used = Number(countResult?.total ?? 0) || 0
  }

  if (unlimited) {
    const quota = {
      limit: null,
      used,
      remaining: null,
      label: planLabel,
      unlimited: true,
      profile
    }
    await logQuotaUsageSnapshot(db, organizationId, quota)
    return quota
  }

  const limit = Math.max(0, configuredLimit)
  const quota = {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    label,
    unlimited: false,
    profile
  }
  await logQuotaUsageSnapshot(db, organizationId, quota)
  return quota
}

export const ensureConversationCapacity = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  user: User,
  event?: H3Event | null
): Promise<{ limit: number, used: number, remaining: number } | null> => {
  const quota = await getConversationQuotaUsage(db, organizationId, user, event)
  if (!quota || quota.unlimited || quota.limit === null) {
    return null
  }

  if (quota.used >= quota.limit) {
    const statusMessage = quota.profile === 'anonymous'
      ? 'Conversation limit reached. Please create an account to continue chatting.'
      : 'Conversation limit reached. Please upgrade your plan to continue chatting.'
    throw createError({
      statusCode: 403,
      statusMessage,
      data: {
        limitReached: true,
        anonLimitReached: quota.profile === 'anonymous',
        limit: quota.limit,
        used: quota.used,
        remaining: 0
      }
    })
  }

  return {
    limit: quota.limit,
    used: quota.used,
    remaining: quota.remaining ?? Math.max(0, quota.limit - quota.used)
  }
}
