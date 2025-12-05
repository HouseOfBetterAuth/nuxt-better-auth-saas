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
import { ac, admin, member, owner } from '../../shared/utils/permissions'
import * as schema from '../database/schema'
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

const parseDraftQuotaValue = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }
  return fallback
}

const DRAFT_QUOTA_SETTINGS = {
  anonymous: parseDraftQuotaValue(runtimeConfig.public?.draftQuota?.anonymous, 5),
  verified: parseDraftQuotaValue(runtimeConfig.public?.draftQuota?.verified, 25),
  paid: parseDraftQuotaValue(runtimeConfig.public?.draftQuota?.paid, 0)
} as const
const QUOTA_USAGE_THRESHOLDS = [0.5, 0.8, 1] as const

const getQuotaAdvisoryLockKeys = (organizationId: string): [number, number] => {
  const hash = createHash('sha256').update(`quota:${organizationId}`).digest()
  return [hash.readInt32BE(0), hash.readInt32BE(4)]
}

export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL,
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
      lastActiveOrganizationId: {
        type: 'string',
        required: false,
        defaultValue: null
      },
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
    session: {
      create: {
        before: async (session) => {
          const db = getDB()

          // 1. Try to get user's last active org
          const users = await db
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1)

          let activeOrgId = users[0]?.lastActiveOrganizationId

          // 2. Verify user is still a member of that org
          if (activeOrgId) {
            const member = await db
              .select()
              .from(schema.member)
              .where(and(
                eq(schema.member.userId, session.userId),
                eq(schema.member.organizationId, activeOrgId)
              ))
              .limit(1)

            if (member.length === 0)
              activeOrgId = null
          }

          // 3. Fallback to first organization
          if (!activeOrgId) {
            const members = await db
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            const firstMember = members[0]
            if (firstMember)
              activeOrgId = firstMember.organizationId
          }

          // 4. For anonymous users without organizations, create a default one
          if (!activeOrgId) {
            const user = users[0]
            if (user && user.isAnonymous) {
              // Create a default organization for anonymous users
              const [newOrg] = await db
                .insert(schema.organization)
                .values({
                  id: uuidv7(),
                  name: 'Anonymous Workspace',
                  slug: `anonymous-${user.id}`,
                  createdAt: new Date()
                })
                .returning()

              if (!newOrg) {
                throw createError({
                  statusCode: 500,
                  statusMessage: 'Failed to create anonymous organization'
                })
              }

              // Add user as owner of the organization
              await db
                .insert(schema.member)
                .values({
                  id: uuidv7(),
                  userId: user.id,
                  organizationId: newOrg.id,
                  role: 'owner',
                  createdAt: new Date()
                })

              // Update user's active organization
              await db
                .update(schema.user)
                .set({ lastActiveOrganizationId: newOrg.id })
                .where(eq(schema.user.id, user.id))

              activeOrgId = newOrg.id
            }
          }

          if (activeOrgId) {
            return {
              data: {
                ...session,
                activeOrganizationId: activeOrgId
              }
            }
          }
        }
      },
      update: {
        after: async (session) => {
          const activeOrgId = (session as any).activeOrganizationId
          if (activeOrgId) {
            await getDB()
              .update(schema.user)
              .set({ lastActiveOrganizationId: activeOrgId })
              .where(eq(schema.user.id, session.userId))
          }
        }
      }
    },
    organization: {
      create: {
        before: async (org: Record<string, any>, ctx: any) => {
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
        }
      },
      update: {
        before: async (org: any) => {
          // Only log in development
          if (runtimeConfig.public.appEnv === 'development') {
            console.log('[Auth Hook] Organization Update Payload:', JSON.stringify(org, null, 2))
          }
        }
      }
    },
    member: {
      create: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      },
      delete: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      }
    },
    invitation: {
      create: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
        }
      },
      delete: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
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
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/database/schema/auth.ts'))
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

    const result = await (serverAuth.api as any).signInAnonymous({
      headers,
      returnHeaders: true
    } as any)

    if (result?.headers) {
      result.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() === 'set-cookie') {
          appendResponseHeader(event, 'set-cookie', value)
        }
      })
    }

    const userId = (result as any)?.response?.user?.id
    if (!userId)
      return null

    const db = getDB()
    const [userRecord] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    return userRecord || null
  } catch (error) {
    console.error('Failed to create anonymous session', error)
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

const resolveDraftQuotaProfile = (user: User | null, hasActiveSubscription: boolean) => {
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
  quota: DraftQuotaUsageResult
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

export interface DraftQuotaUsageResult {
  limit: number | null
  used: number
  remaining: number | null
  label: string
  unlimited: boolean
  profile: 'anonymous' | 'verified' | 'paid'
}

export const getDraftQuotaUsage = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  user: User | null
): Promise<DraftQuotaUsageResult> => {
  const [countResult] = await db
    .select({ total: count() })
    .from(schema.content)
    .where(eq(schema.content.organizationId, organizationId))

  const used = Number(countResult?.total ?? 0) || 0
  const { hasActiveSubscription, planLabel } = await getOrganizationSubscriptionStatus(db, organizationId)
  const { profile, label } = resolveDraftQuotaProfile(user, hasActiveSubscription)
  const configuredLimit = DRAFT_QUOTA_SETTINGS[profile]
  const unlimited = profile === 'paid' && configuredLimit <= 0

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

export const ensureEmailVerifiedDraftCapacity = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  user: User
): Promise<{ limit: number, used: number, remaining: number } | null> => {
  const quota = await getDraftQuotaUsage(db, organizationId, user)
  if (!quota || quota.unlimited || quota.limit === null) {
    return null
  }

  if (quota.used >= quota.limit) {
    const statusMessage = quota.profile === 'anonymous'
      ? 'Draft limit reached. Please create an account to continue creating drafts.'
      : 'Draft limit reached. Please upgrade your plan to continue creating drafts.'
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
