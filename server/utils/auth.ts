import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { admin as adminPlugin, anonymous, apiKey, openAPI, organization } from 'better-auth/plugins'
import { and, asc, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { appendResponseHeader, createError, getRequestHeaders } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
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
      },
      defaultOrganizationId: {
        type: 'string',
        required: true,
        defaultValue: ''
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
            console.log('[Auth] Creating anonymous organization for user:', { userId: user.id, email: user.email })
            const db = getDB()
            let _anonymousOrgId: string | null = null
            try {
              console.log('[Auth] Starting transaction to create anonymous org...')
              await db.transaction(async (tx) => {
                const orgId = uuidv7()
                const orgSlug = `anonymous-${user.id}`
                console.log('[Auth] Inserting organization:', { orgId, orgSlug, userId: user.id })

                const [newOrg] = await tx
                  .insert(schema.organization)
                  .values({
                    id: orgId,
                    name: 'Anonymous Workspace',
                    slug: orgSlug,
                    createdAt: new Date(),
                    // Store device fingerprint if available in context/headers?
                    // Ideally we'd capture this, but for now just creating the org is the priority.
                    metadata: JSON.stringify({ isAnonymous: true }),
                    isAnonymous: true
                  })
                  .returning()

                if (!newOrg) {
                  console.error('[Auth] Organization insert returned no result')
                  throw new Error('Organization insert returned no result')
                }

                console.log('[Auth] Organization created successfully:', { orgId: newOrg.id, slug: newOrg.slug })
                _anonymousOrgId = newOrg.id

                const memberId = uuidv7()
                console.log('[Auth] Inserting member record:', { memberId, userId: user.id, organizationId: newOrg.id })
                await tx.insert(schema.member).values({
                  id: memberId,
                  userId: user.id,
                  organizationId: newOrg.id,
                  role: 'owner',
                  createdAt: new Date()
                })

                console.log('[Auth] Member record created successfully')
                // Organization is now managed by Better Auth's organization plugin

                console.log('[Auth] Updating user defaultOrganizationId:', { userId: user.id, orgId: _anonymousOrgId })

                try {
                  const updateResult = await tx
                    .update(schema.user)
                    .set({ defaultOrganizationId: _anonymousOrgId })
                    .where(eq(schema.user.id, user.id))
                    .returning({ id: schema.user.id, defaultOrganizationId: schema.user.defaultOrganizationId })

                  console.log('[Auth] Update query executed, result:', updateResult)

                  if (!updateResult || updateResult.length === 0) {
                    console.error('[Auth] ❌ Update returned no rows - user might not exist!')
                    throw new Error('Failed to update user defaultOrganizationId (no rows returned)')
                  } else {
                    console.log('[Auth] Update returned rows:', updateResult.length)
                    console.log('[Auth] ✅ Successfully set defaultOrganizationId:', { userId: user.id, orgId: _anonymousOrgId })
                  }
                } catch (updateError) {
                  console.error('[Auth] ❌ Exception during user update:', updateError)
                  if (updateError instanceof Error) {
                    console.error('[Auth] Update error stack:', updateError.stack)
                  }
                  // Throw to rollback the whole transaction (org + member + user update)
                  throw updateError
                }
              })

              console.log('[Auth] Transaction completed, _anonymousOrgId:', _anonymousOrgId)
            } catch (error) {
              console.error('[Auth] ❌ Failed to create anonymous organization - aborting user creation:', error)
              if (error instanceof Error) {
                console.error('[Auth] Error stack:', error.stack)
              }
              // Rethrow to prevent user from being created without a valid organization
              throw new Error('Failed to provision anonymous workspace', { cause: error })
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
              throw new APIError('UNAUTHORIZED', {
                message: 'Invalid session: user not found. Please sign in again.'
              })
            }
            if (process.env.NODE_ENV === 'development') {
              console.log('[Auth] User validated, allowing member creation')
            }
          }
          // Return undefined to continue with default behavior
          return undefined
        },
        after: async (member: Record<string, any>) => {
          if (!member?.userId || !member?.organizationId) {
            return
          }

          try {
            const db = getDB()
            const existing = await db.query.user.findFirst({
              columns: { defaultOrganizationId: true },
              where: eq(schema.user.id, member.userId)
            })

            if (!existing || existing.defaultOrganizationId) {
              return
            }

            await db
              .update(schema.user)
              .set({ defaultOrganizationId: member.organizationId })
              .where(eq(schema.user.id, member.userId))
          } catch (error) {
            console.error('[Auth] Failed to set default organization after membership creation:', error)
          }
        }
      }
    },
    session: {
      create: {
        before: async (session) => {
          if (!session?.userId || session.activeOrganizationId) {
            return
          }

          const db = getDB()
          const userRecord = await db.query.user.findFirst({
            columns: { defaultOrganizationId: true },
            where: eq(schema.user.id, session.userId)
          })

          const defaultOrgId = userRecord?.defaultOrganizationId?.trim()
          if (defaultOrgId) {
            return {
              data: {
                ...session,
                activeOrganizationId: defaultOrgId
              }
            }
          }

          const [membership] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1)

          if (!membership?.organizationId) {
            return
          }

          // Persist the discovered organization as the user's default for future sessions
          await db
            .update(schema.user)
            .set({ defaultOrganizationId: membership.organizationId })
            .where(eq(schema.user.id, session.userId))

          return {
            data: {
              ...session,
              activeOrganizationId: membership.organizationId
            }
          }
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
        },
        after: async (org: Record<string, any>, ctx: any) => {
          try {
            const sessionUserId =
              ctx?.session?.user?.id
              ?? ctx?.context?.session?.user?.id

            if (!sessionUserId) {
              return
            }

            const db = getDB()
            const existing = await db.query.user.findFirst({
              columns: { defaultOrganizationId: true },
              where: eq(schema.user.id, sessionUserId)
            })

            if (!existing || existing.defaultOrganizationId) {
              return
            }

            await db
              .update(schema.user)
              .set({ defaultOrganizationId: org.id })
              .where(eq(schema.user.id, sessionUserId))
          } catch (error) {
            console.error('[Auth] Failed to update default organization after org creation:', error)
          }
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
  socialProviders: (() => {
    const providers: Record<string, { clientId: string, clientSecret: string }> = {}

    if (runtimeConfig.githubClientId && runtimeConfig.githubClientSecret) {
      providers.github = {
        clientId: runtimeConfig.githubClientId,
        clientSecret: runtimeConfig.githubClientSecret
      }
    }

    if (runtimeConfig.googleClientId && runtimeConfig.googleClientSecret) {
      providers.google = {
        clientId: runtimeConfig.googleClientId,
        clientSecret: runtimeConfig.googleClientSecret
      }
    }

    return providers
  })(),
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
          try {
            await logAuditEvent({
              userId,
              category: 'auth',
              action: ctx.path.replace(':id', provider),
              targetType,
              targetId,
              ipAddress,
              userAgent,
              status: 'success'
            }, {
              timeout: 2000,
              queueOnFailure: true,
              throwOnFailure: false // Don't throw - queue for retry instead
            })
          } catch (error) {
            // Log error but don't block response - event is queued for retry
            console.error('[Auth] Audit log failed (queued for retry):', error)
          }
        } else {
          try {
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
            }, {
              timeout: 2000,
              queueOnFailure: true,
              throwOnFailure: false // Don't throw - queue for retry instead
            })
          } catch (error) {
            // Log error but don't block response - event is queued for retry
            console.error('[Auth] Audit log failed (queued for retry):', error)
          }
        }
      } else {
        // Handle successful social sign-in callbacks
        if (ctx.path.startsWith('/callback/') && ctx.context.newSession?.user?.id) {
          const provider = ctx.path.replace('/callback/', '')
          try {
            await logAuditEvent({
              userId: ctx.context.newSession.user.id,
              category: 'auth',
              action: `/callback/${provider}`,
              targetType: 'user',
              targetId: ctx.context.newSession.user.id,
              ipAddress,
              userAgent,
              status: 'success'
            }, {
              timeout: 2000,
              queueOnFailure: true,
              throwOnFailure: false // Don't throw - queue for retry instead
            })
          } catch (error) {
            // Log error but don't block response - event is queued for retry
            console.error('[Auth] Audit log failed (queued for retry):', error)
          }
        }

        if (['/sign-in/email', '/sign-up/email', '/forget-password', '/reset-password'].includes(ctx.path)) {
          let userId: string | undefined
          if (['/sign-in/email', '/sign-up/email'].includes(ctx.path)) {
            userId = ctx.context.newSession?.user.id
          } else {
            userId = ctx.context.session?.user.id
          }

          // Critical security events (sign-in/sign-up) must be logged with timeout protection
          // to ensure compliance. Failed events are automatically queued for retry.
          const isCriticalAuthEvent = ['/sign-in/email', '/sign-up/email'].includes(ctx.path)

          try {
            // Use timeout protection (2s default) to prevent hanging, but keep it blocking
            // for critical events to ensure audit trail completeness
            await logAuditEvent({
              userId,
              category: 'auth',
              action: ctx.path,
              targetType,
              targetId,
              ipAddress,
              userAgent,
              status: 'success'
            }, {
              timeout: isCriticalAuthEvent ? 2000 : 5000, // Shorter timeout for critical events
              queueOnFailure: true, // Automatically queue failures for retry
              throwOnFailure: false // Don't throw - queue for retry instead
            })
          } catch (error) {
            // Log error but don't block response - event is queued for retry
            // For critical events, we've attempted to log synchronously with timeout
            console.error('[Auth] Audit log failed (queued for retry):', error)
          }
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
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/db/schema/auth.ts'))
if (isAuthSchemaCommand) {
  _auth = createBetterAuth()
}
export const auth = _auth!

interface RequireAuthOptions {
  allowAnonymous?: boolean
}

export const getServerAuth = () => {
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
    console.log('[Auth] createAnonymousUserSession: Starting anonymous user creation')
    const serverAuth = getServerAuth()
    const headers = new Headers()
    const reqHeaders = getRequestHeaders(event)
    for (const [key, value] of Object.entries(reqHeaders)) {
      if (value)
        headers.set(key, value)
    }

    console.log('[Auth] Calling signInAnonymous API...')
    // Call the anonymous sign-in endpoint directly via the API
    const result = await (serverAuth.api as any).signInAnonymous({
      headers,
      returnHeaders: true
    } as any)

    if (!result) {
      console.error('[Auth] ❌ signInAnonymous returned no result')
      return null
    }

    console.log('[Auth] signInAnonymous returned result, processing...')

    if (result?.headers) {
      result.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() === 'set-cookie') {
          appendResponseHeader(event, 'set-cookie', value)
        }
      })
    }

    const responsePayload = (result as any)?.response
    const userId = responsePayload?.user?.id
    if (!userId) {
      console.error('[Auth] ❌ signInAnonymous did not return a user ID', { result })
      return null
    }

    console.log('[Auth] Anonymous user created, userId:', userId)
    const sessionToken = typeof responsePayload?.token === 'string' ? responsePayload.token : null

    const db = getDB()
    console.log('[Auth] Fetching user record from database...')
    const [userRecord] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        isAnonymous: schema.user.isAnonymous,
        defaultOrganizationId: schema.user.defaultOrganizationId
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1)

    if (!userRecord) {
      console.error('[Auth] ❌ User record not found after anonymous sign-in', { userId })
      return null
    }

    console.log('[Auth] User record found:', {
      userId: userRecord.id,
      email: userRecord.email,
      isAnonymous: userRecord.isAnonymous,
      defaultOrganizationId: userRecord.defaultOrganizationId || 'NONE'
    })

    // Resolve organization immediately for THIS request, because the session cookie was just set on the response
    // and will not be available to getSession() until the NEXT request.
    let resolvedOrgId = (userRecord.defaultOrganizationId || '').trim()

    if (!resolvedOrgId) {
      console.warn('[Auth] defaultOrganizationId missing right after anonymous sign-in; checking membership...')
      const [membership] = await db
        .select({ organizationId: schema.member.organizationId })
        .from(schema.member)
        .where(eq(schema.member.userId, userId))
        .orderBy(asc(schema.member.createdAt))
        .limit(1)

      if (membership?.organizationId) {
        resolvedOrgId = membership.organizationId
        console.warn('[Auth] Found membership orgId; persisting as defaultOrganizationId', { userId, orgId: resolvedOrgId })
        await db
          .update(schema.user)
          .set({ defaultOrganizationId: resolvedOrgId })
          .where(eq(schema.user.id, userId))
      }
    }

    if (resolvedOrgId) {
      event.context.organizationId = resolvedOrgId
      console.log('[Auth] ✅ Resolved organization for current request', { userId, orgId: resolvedOrgId })

      // Persist onto session row if we can (token is returned by signInAnonymous)
      if (sessionToken) {
        await db
          .update(schema.session)
          .set({ activeOrganizationId: resolvedOrgId })
          .where(eq(schema.session.token, sessionToken))
        console.log('[Auth] ✅ Updated session.activeOrganizationId via token', { token: sessionToken, orgId: resolvedOrgId })
      } else {
        console.warn('[Auth] No session token returned from signInAnonymous; cannot persist activeOrganizationId on session row')
      }
    } else {
      console.error('[Auth] ❌ Unable to resolve organization for anonymous user', { userId })
    }

    return userRecord
  } catch (error) {
    console.error('[Auth] ❌ Failed to create anonymous session', error)
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

  const serverAuth = getServerAuth()
  const session = await serverAuth.api.getSession({
    headers
  })
  return session
}

const getSessionOrganizationId = (session: any): string | null => {
  return session?.session?.activeOrganizationId
    ?? session?.data?.session?.activeOrganizationId
    ?? session?.activeOrganizationId
    ?? null
}

export const requireAuth = async (event: H3Event, options: RequireAuthOptions = {}) => {
  if (event.context.user) {
    return event.context.user as User
  }

  const session = await getAuthSession(event)
  if (session?.user) {
    event.context.authSession = session
    const organizationId = getSessionOrganizationId(session)
    if (organizationId) {
      event.context.organizationId = organizationId
    }
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

export const requireActiveOrganization = async (
  event: H3Event
) => {
  const cachedOrgId = event.context.organizationId
  if (typeof cachedOrgId === 'string' && cachedOrgId.length > 0) {
    return { organizationId: cachedOrgId }
  }

  const session = event.context.authSession ?? await getAuthSession(event)
  const organizationId = getSessionOrganizationId(session)

  if (!organizationId) {
    // Fallback: sessions can be created before anonymous org provisioning finishes.
    // For robustness (and to support anonymous-first flows), derive the org from the user record
    // or memberships, then persist it back onto the user + session for future requests.
    try {
      const userId = session?.user?.id ?? session?.session?.userId ?? session?.data?.session?.userId
      const sessionToken = session?.session?.token ?? session?.data?.session?.token ?? session?.token
      const sessionId = session?.session?.id ?? session?.data?.session?.id ?? session?.id

      if (typeof userId === 'string' && userId.length > 0) {
        const db = getDB()

        const [userRecord] = await db
          .select({ defaultOrganizationId: schema.user.defaultOrganizationId })
          .from(schema.user)
          .where(eq(schema.user.id, userId))
          .limit(1)

        let resolvedOrgId = userRecord?.defaultOrganizationId?.trim() || ''

        if (!resolvedOrgId) {
          const [membership] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1)

          if (membership?.organizationId) {
            resolvedOrgId = membership.organizationId
            // Persist for future sessions
            await db
              .update(schema.user)
              .set({ defaultOrganizationId: resolvedOrgId })
              // Avoid redundant writes under concurrency: only set if unset.
              .where(and(
                eq(schema.user.id, userId),
                or(isNull(schema.user.defaultOrganizationId), eq(schema.user.defaultOrganizationId, ''))
              ))
          }
        }

        if (resolvedOrgId) {
          // Persist onto the current session if we can identify it
          if (typeof sessionId === 'string' && sessionId.length > 0) {
            await db
              .update(schema.session)
              .set({ activeOrganizationId: resolvedOrgId })
              // Avoid redundant writes: only update if unset or different.
              .where(and(
                eq(schema.session.id, sessionId),
                or(
                  isNull(schema.session.activeOrganizationId),
                  eq(schema.session.activeOrganizationId, ''),
                  ne(schema.session.activeOrganizationId, resolvedOrgId)
                )
              ))
          } else if (typeof sessionToken === 'string' && sessionToken.length > 0) {
            await db
              .update(schema.session)
              .set({ activeOrganizationId: resolvedOrgId })
              // Avoid redundant writes: only update if unset or different.
              .where(and(
                eq(schema.session.token, sessionToken),
                or(
                  isNull(schema.session.activeOrganizationId),
                  eq(schema.session.activeOrganizationId, ''),
                  ne(schema.session.activeOrganizationId, resolvedOrgId)
                )
              ))
          }

          event.context.organizationId = resolvedOrgId
          return { organizationId: resolvedOrgId }
        }
      }
    } catch (error) {
      console.error('[Auth] Failed to recover active organization from user/membership fallback:', error)
    }

    throw createError({
      statusCode: 400,
      statusMessage: 'No active organization found in session'
    })
  }

  event.context.organizationId = organizationId
  return { organizationId }
}

export const requireAdmin = async (event: H3Event) => {
  const user = await requireAuth(event)
  if (user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Admin access required'
    })
  }

  return user
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const

const _getOrganizationSubscriptionStatus = async (db: NodePgDatabase<typeof schema>, organizationId: string) => {
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
