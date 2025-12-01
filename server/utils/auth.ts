import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { admin as adminPlugin, anonymous, apiKey, openAPI, organization } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { ac, admin, member, owner } from '../../shared/utils/permissions'
import * as schema from '../database/schema'
import { logAuditEvent } from './auditLogger'
import { getDB } from './db'
import { cacheClient, resendInstance } from './drivers'
import { renderDeleteAccount, renderResetPassword, renderTeamInvite, renderVerifyEmail } from './email'
import { runtimeConfig } from './runtimeConfig'
import { createStripeClient, setupStripe } from './stripe'

console.log(`Base URL is ${runtimeConfig.public.baseURL}`)
console.log('Schema keys:', Object.keys(schema))

export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL,
  trustedOrigins: [
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
  ],
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
          const name = user.name || user.email.split('@')[0]
          const html = await renderDeleteAccount(name, url)
          await resendInstance.emails.send({
            from: runtimeConfig.emailFrom!,
            to: user.email,
            subject: 'Confirm account deletion',
            html
          })
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
          if (ctx.path.startsWith('/callback')) {
            try {
              const additionalData = await getOAuthState(ctx)
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
        after: async (user) => {
          // When user email changes, update Stripe customer email for orgs they own
          console.log('[Auth] User update hook triggered:', { userId: user.id, email: user.email, emailVerified: user.emailVerified })

          // Always sync email to Stripe when user is updated (email is verified by the change-email flow)
          if (user.email) {
            try {
              const db = getDB()
              // Find all orgs where this user is owner and has a Stripe customer
              const ownedOrgs = await db
                .select()
                .from(schema.member)
                .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
                .where(and(
                  eq(schema.member.userId, user.id),
                  eq(schema.member.role, 'owner')
                ))

              console.log('[Auth] Found owned orgs:', ownedOrgs.length)

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
                    console.log(`[Auth] Updated Stripe customer ${org.stripeCustomerId} email to ${user.email}, name to "${org.name}"`)
                  } else {
                    console.log(`[Auth] Org ${org.id} has no stripeCustomerId`)
                  }
                }
              }
            } catch (e) {
              console.error('[Auth] Failed to update Stripe customer email:', e)
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

            if (members.length > 0)
              activeOrgId = members[0].organizationId
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
        before: async (org, ctx) => {
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
          console.log('[Auth Hook] Organization Update Payload:', JSON.stringify(org, null, 2))
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
    }
  },
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const name = user.name || user.email.split('@')[0]
      const html = await renderResetPassword(name, url)
      const response = await resendInstance.emails.send({
        from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
        to: user.email,
        subject: 'Reset your password',
        html
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
      console.log('>>> EMAIL VERIFICATION LINK <<<')
      console.log(`To: ${user.email}`)
      console.log(url)
      console.log('>>> ------------------------ <<<')
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
        console.log('>>> MANUAL VERIFICATION LINK <<<')
        console.log(url)
        console.log('>>> ------------------------ <<<')
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
      enabled: true
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
          const host = new URL(runtimeConfig.public.baseURL).hostname
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
          const inviterName = inviter.user.name || inviter.user.email.split('@')[0]
          const inviteUrl = `${runtimeConfig.public.baseURL}/invite/${invitation.id}`
          const html = await renderTeamInvite(inviterName, organization.name, inviteUrl)
          await resendInstance.emails.send({
            from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
            to: email,
            subject: `You're invited to join ${organization.name}`,
            html
          })
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

export const requireAuth = async (event: H3Event) => {
  const session = await getAuthSession(event)
  if (!session || !session.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }
  // Save the session to the event context for later use
  event.context.user = session.user
  return session.user as User
}
