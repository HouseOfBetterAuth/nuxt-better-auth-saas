import type { Subscription } from '@better-auth/stripe'
import { stripe } from '@better-auth/stripe'
import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable } from '../database/schema'
import { logAuditEvent } from './auditLogger'
import { useDB } from './db'
import { runtimeConfig } from './runtimeConfig'

/**
 * STRIPE ORGANIZATION BILLING IMPLEMENTATION
 *
 * 1. Customer Creation:
 *    - Customers are created for ORGANIZATIONS, not Users.
 *    - `ensureStripeCustomer(organizationId)` is called explicitly (e.g. before checkout).
 *    - It fetches the Organization and its Owner (for email).
 *    - It creates a Stripe Customer with metadata `organizationId`.
 *    - The Stripe Customer ID is stored in `organization.stripeCustomerId`.
 *
 * 2. Webhook Handling:
 *    - Webhooks are handled by Better Auth's `stripe` plugin.
 *    - The `addPaymentLog` function processes events.
 *    - It retrieves the Organization using `getOrgByStripeCustomerId`.
 *    - Logs are associated with the Organization (via details) and marked as 'system' user actions.
 *
 * 3. Metadata:
 *    - `ownerUserId` is stored in metadata to track the initiator.
 *    - `organizationId` is the primary reference.
 */

const createStripeClient = () => {
  return new Stripe(runtimeConfig.stripeSecretKey!)
}

export const ensureStripeCustomer = async (organizationId: string) => {
  const client = createStripeClient()
  const db = await useDB()

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org) {
    throw new Error('Organization not found')
  }

  // Check if customer already exists
  if (org.stripeCustomerId) {
    return { id: org.stripeCustomerId }
  }

  // Fetch Owner for email
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.role, 'owner')
    ),
    with: { user: true }
  })

  const email = member?.user.email

  // Create new customer if not exists
  const customerParams: Stripe.CustomerCreateParams = {
    name: org.name,
    metadata: {
      organizationId: org.id,
      ownerUserId: member?.user.id || ''
    }
  }

  if (email) {
    customerParams.email = email
  }

  const customer = await client.customers.create(customerParams)

  // Update organization with stripe customer id
  await db.update(organizationTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizationTable.id, organizationId))

  return customer
}

const getOrgByStripeCustomerId = async (stripeCustomerId: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.stripeCustomerId, stripeCustomerId)
  })
  return org
}

const addPaymentLog = async (action: string, subscription: Subscription) => {
  const org = await getOrgByStripeCustomerId(subscription.stripeCustomerId!)
  if (!org)
    return

  await logAuditEvent({
    userId: 'system', // Webhook event, no specific user
    category: 'payment',
    action: `${action}:${subscription.plan}`,
    targetType: 'stripeCustomerId',
    targetId: subscription.stripeCustomerId,
    status: 'success',
    details: `Organization: ${org.name} (${org.id})`
  })
}

export const setupStripe = () => stripe({
  stripeClient: createStripeClient(),
  stripeWebhookSecret: runtimeConfig.stripeWebhookSecret,
  createCustomerOnSignUp: false, // Disable for Org-based billing
  subscription: {
    enabled: true,
    plans: [
      {
        name: 'pro-monthly',
        priceId: runtimeConfig.stripePriceIdProMonth,
        freeTrial: {
          days: 14,
          onTrialStart: async (subscription) => {
            await addPaymentLog('trial_start', subscription)
          },
          onTrialEnd: async ({ subscription }) => {
            await addPaymentLog('trial_end', subscription)
          },
          onTrialExpired: async (subscription) => {
            await addPaymentLog('trial_expired', subscription)
          }
        }
      },
      {
        name: 'pro-yearly',
        priceId: runtimeConfig.stripePriceIdProYear,
        freeTrial: {
          days: 14,
          onTrialStart: async (subscription) => {
            await addPaymentLog('trial_start', subscription)
          },
          onTrialEnd: async ({ subscription }) => {
            await addPaymentLog('trial_end', subscription)
          },
          onTrialExpired: async (subscription) => {
            await addPaymentLog('trial_expired', subscription)
          }
        }
      }
    ],
    onSubscriptionComplete: async ({ subscription }) => {
      await addPaymentLog('subscription_created', subscription)
    },
    onSubscriptionUpdate: async ({ subscription }) => {
      await addPaymentLog('subscription_updated', subscription)
    },
    onSubscriptionCancel: async ({ subscription }) => {
      await addPaymentLog('subscription_canceled', subscription)
    },
    onSubscriptionDeleted: async ({ subscription }) => {
      await addPaymentLog('subscription_deleted', subscription)
    }
  }
})
