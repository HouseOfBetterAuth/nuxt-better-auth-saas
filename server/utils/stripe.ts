import type { Subscription } from '@better-auth/stripe'
import { stripe } from '@better-auth/stripe'
import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { PAID_TIERS } from '~~/shared/utils/plans'
import { member as memberTable, organization as organizationTable } from '../database/schema'
import { logAuditEvent } from './auditLogger'
import { useDB } from './db'
import { runtimeConfig } from './runtimeConfig'
import {
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendSubscriptionConfirmedEmail,
  sendSubscriptionExpiredEmail,
  sendTrialExpiredEmail,
  sendTrialStartedEmail
} from './stripeEmails'
import { removeExcessMembersOnExpiration } from './subscription-handlers'

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

export const createStripeClient = () => {
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

/**
 * Sync Stripe customer name with organization name (shows on invoices).
 * Called after subscription events to ensure the customer name stays as the org name
 * (not the cardholder name from payment method).
 * @param organizationId - The organization ID
 * @param newName - Optional: pass the new name directly to avoid DB race conditions
 */
export const syncStripeCustomerName = async (organizationId: string, newName?: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org?.stripeCustomerId)
    return

  const nameToSync = newName || org.name
  const client = createStripeClient()
  await client.customers.update(org.stripeCustomerId, {
    name: nameToSync
  })
  console.log(`[Stripe] Synced customer ${org.stripeCustomerId} name to "${nameToSync}"`)
}

export const addPaymentLog = async (action: string, subscription: any) => {
  // Handle both Better Auth subscription object and raw Stripe subscription object
  const customerId = subscription.stripeCustomerId ||
    (typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id)

  if (!customerId)
    return

  const org = await getOrgByStripeCustomerId(customerId)
  if (!org)
    return

  await logAuditEvent({
    userId: undefined, // Webhook event, no specific user
    category: 'payment',
    action: `${action}:${subscription.plan?.id || subscription.plan?.name || 'unknown'}`,
    targetType: 'stripeCustomerId',
    targetId: customerId,
    status: 'success',
    details: `Organization: ${org.name} (${org.id})`
  })
}

export const syncSubscriptionQuantity = async (organizationId: string) => {
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId),
    with: {
      members: true,
      invitations: true
    }
  })

  if (!org?.stripeCustomerId)
    return

  const client = createStripeClient()

  // Find active subscription
  const subscriptions = await client.subscriptions.list({
    customer: org.stripeCustomerId,
    status: 'active',
    limit: 1
  })

  if (subscriptions.data.length === 0)
    return

  const subscription = subscriptions.data[0]
  const currentQuantity = subscription.items.data[0].quantity

  // Calculate new quantity
  const memberCount = org.members.length
  const inviteCount = org.invitations.filter(i => i.status === 'pending').length
  const newQuantity = memberCount + inviteCount

  if (currentQuantity !== newQuantity && newQuantity > 0) {
    await client.subscriptions.update(subscription.id, {
      items: [{
        id: subscription.items.data[0].id,
        quantity: newQuantity
      }]
    })

    await logAuditEvent({
      userId: undefined,
      category: 'payment',
      action: 'update_quantity',
      targetType: 'subscription',
      targetId: subscription.id,
      status: 'success',
      details: `Updated quantity from ${currentQuantity} to ${newQuantity}`
    })
  }
}

export const setupStripe = () => stripe({
  stripeClient: createStripeClient(),
  stripeWebhookSecret: runtimeConfig.stripeWebhookSecret,
  onEvent: async (event) => {
    // Handle payment_intent.payment_failed - send email when card is declined
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      const customerId = typeof paymentIntent.customer === 'string'
        ? paymentIntent.customer
        : paymentIntent.customer?.id

      if (customerId) {
        console.log('[Stripe] Payment failed for customer:', customerId, 'Amount:', paymentIntent.amount, 'PI:', paymentIntent.id)
        // sendPaymentFailedEmail has built-in deduplication using KV storage
        await sendPaymentFailedEmail(customerId, paymentIntent.amount, paymentIntent.id)
      }
    }
  },
  createCustomerOnSignUp: false, // Disable for Org-based billing
  subscription: {
    enabled: true,
    getSubscriptionReference: async (subscription: any) => {
      // Try to get organizationId from metadata first
      if (subscription.metadata?.organizationId) {
        return subscription.metadata.organizationId
      }

      // Fallback to stripeCustomerId lookup
      let customerId = subscription.stripeCustomerId
      if (!customerId) {
        if (typeof subscription.customer === 'string') {
          customerId = subscription.customer
        } else if (subscription.customer && typeof subscription.customer === 'object' && 'id' in subscription.customer) {
          customerId = subscription.customer.id
        }
      }

      if (customerId) {
        const org = await getOrgByStripeCustomerId(customerId)
        if (org) {
          return org.id
        }
      }

      return null
    },
    authorizeReference: async ({ user, referenceId }, ctx) => {
      const db = await useDB()
      const member = await db.query.member.findFirst({
        where: and(
          eq(memberTable.organizationId, referenceId),
          eq(memberTable.userId, user.id)
        )
      })

      // Allow all members to view subscription data (for badges, etc.)
      if (member) {
        // For read-only operations (GET requests), allow all members
        if (ctx?.method === 'GET') {
          return true
        }

        // For write operations (POST, PUT, DELETE), only allow owners
        if (member.role === 'owner') {
          // Ensure Stripe Customer exists for the Organization before allowing action
          await ensureStripeCustomer(referenceId)
          return true
        }
      }

      return false
    },
    getCheckoutSessionParams: async ({ session, plan }, ctx) => {
      // Try to find referenceId from the request body or session
      let customerId
      const body = ctx?.body as any
      const activeOrganizationId = (session as any)?.activeOrganizationId

      const targetOrgId = body?.referenceId || activeOrganizationId
      let quantity = 1

      if (targetOrgId) {
        const db = await useDB()
        // We need to look up the org by ID
        const organization = await db.query.organization.findFirst({
          where: eq(organizationTable.id, targetOrgId),
          with: {
            members: true,
            invitations: true
          }
        })
        if (organization) {
          if (organization.stripeCustomerId) {
            customerId = organization.stripeCustomerId
          }
          // Calculate quantity: Members + Pending Invites
          // Default to 1 if count is 0 (should be at least 1 owner)
          const memberCount = organization.members.length
          const inviteCount = organization.invitations.filter(i => i.status === 'pending').length
          const count = memberCount + inviteCount
          quantity = count > 0 ? count : 1
          console.log('[Stripe] Calculated Quantity:', quantity, 'Members:', memberCount, 'Invites:', inviteCount, 'Org:', targetOrgId)
        }
      }

      // Build checkout params
      const params: any = {
        customer: customerId, // Explicitly set the Org's customer ID
        allow_promotion_codes: true,
        line_items: [{
          price: plan.priceId,
          quantity
        }],
        tax_id_collection: {
          enabled: true
        },
        billing_address_collection: 'required',
        metadata: {
          // Ensure metadata is preserved/set
          ...(body?.metadata || {}),
          organizationId: targetOrgId // Explicitly add org ID to metadata
        }
      }

      return { params }
    },
    plans: async () => {
      // Generate plans dynamically from PLAN_TIERS
      const plans: any[] = []

      for (const tier of PAID_TIERS) {
        // Monthly plan with trial
        plans.push({
          name: tier.monthly.id,
          priceId: tier.monthly.priceId,
          freeTrial: {
            days: tier.trialDays,
            onTrialStart: async (subscription: Subscription) => {
              console.log(`[Stripe] ${tier.key} monthly onTrialStart fired:`, { referenceId: subscription.referenceId })
              await addPaymentLog('trial_start', subscription)
              if (subscription.referenceId) {
                await sendTrialStartedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialEnd: async ({ subscription }: { subscription: Subscription }) => {
              console.log(`[Stripe] ${tier.key} monthly onTrialEnd fired:`, { referenceId: subscription.referenceId, status: subscription.status })
              await addPaymentLog('trial_end', subscription)
              if (subscription.referenceId && subscription.status === 'active') {
                console.log('[Stripe] Sending subscription confirmed email for trial end')
                await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialExpired: async (subscription: Subscription) => {
              await addPaymentLog('trial_expired', subscription)
              if (subscription.referenceId) {
                await removeExcessMembersOnExpiration(subscription.referenceId)
                await sendTrialExpiredEmail(subscription.referenceId, subscription)
              }
            }
          }
        })

        // Yearly plan with trial
        plans.push({
          name: tier.yearly.id,
          priceId: tier.yearly.priceId,
          freeTrial: {
            days: tier.trialDays,
            onTrialStart: async (subscription: Subscription) => {
              console.log(`[Stripe] ${tier.key} yearly onTrialStart fired:`, { referenceId: subscription.referenceId })
              await addPaymentLog('trial_start', subscription)
              if (subscription.referenceId) {
                await sendTrialStartedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialEnd: async ({ subscription }: { subscription: Subscription }) => {
              console.log(`[Stripe] ${tier.key} yearly onTrialEnd fired:`, { referenceId: subscription.referenceId, status: subscription.status })
              await addPaymentLog('trial_end', subscription)
              if (subscription.referenceId && subscription.status === 'active') {
                console.log('[Stripe] Sending subscription confirmed email for trial end')
                await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
              }
            },
            onTrialExpired: async (subscription: Subscription) => {
              await addPaymentLog('trial_expired', subscription)
              if (subscription.referenceId) {
                await removeExcessMembersOnExpiration(subscription.referenceId)
                await sendTrialExpiredEmail(subscription.referenceId, subscription)
              }
            }
          }
        })

        // No-trial versions (for users who own multiple orgs)
        plans.push({
          name: `${tier.monthly.id}-no-trial`,
          priceId: tier.monthly.priceId
        })
        plans.push({
          name: `${tier.yearly.id}-no-trial`,
          priceId: tier.yearly.priceId
        })
      }

      return plans
    },
    onSubscriptionComplete: async ({ subscription }) => {
      await addPaymentLog('subscription_created', subscription)
      // Sync customer name back to org name (in case payment method changed it)
      if (subscription.referenceId) {
        await syncStripeCustomerName(subscription.referenceId)
        // Only send confirmation email if subscription has NO trial
        // If there's a trial, emails are handled by onTrialStart (trial started) and onTrialEnd (confirmed/expired)
        const hasTrial = subscription.trialStart || subscription.trialEnd || subscription.status === 'trialing'
        if (!hasTrial) {
          await sendSubscriptionConfirmedEmail(subscription.referenceId, subscription)
        }
      }
    },
    onSubscriptionUpdate: async ({ subscription }) => {
      console.log('[Stripe] onSubscriptionUpdate fired:', {
        referenceId: subscription.referenceId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
      })
      await addPaymentLog('subscription_updated', subscription)
      // Sync customer name back to org name (in case payment method changed it)
      if (subscription.referenceId) {
        await syncStripeCustomerName(subscription.referenceId)

        // Check if this is a cancellation (cancel_at_period_end was just set to true)
        // This happens when user clicks "Downgrade to Free"
        if (subscription.cancelAtPeriodEnd) {
          console.log('[Stripe] Subscription scheduled for cancellation, sending cancellation email')
          await sendSubscriptionCanceledEmail(subscription.referenceId, subscription)
        }

        // Note: Confirmation emails are sent from onTrialEnd (trial → active)
        // and onSubscriptionComplete (direct subscribe without trial)
        // We don't send emails here to avoid duplicates on plan/seat changes
      }
    },
    onSubscriptionCancel: async ({ subscription }) => {
      await addPaymentLog('subscription_canceled', subscription)
      if (subscription.referenceId) {
        // Note: Cancellation email is sent from onSubscriptionUpdate when cancelAtPeriodEnd is set
        // This hook fires for immediate cancellations, not scheduled ones
        // Remove excess members when subscription is canceled
        await removeExcessMembersOnExpiration(subscription.referenceId)
      }
    },
    onSubscriptionDeleted: async ({ subscription }) => {
      await addPaymentLog('subscription_deleted', subscription)
      // Remove excess members when subscription is deleted/expired
      if (subscription.referenceId) {
        const result = await removeExcessMembersOnExpiration(subscription.referenceId)
        const membersRemoved = result?.removedCount || 0
        // Send subscription expired email
        await sendSubscriptionExpiredEmail(subscription.referenceId, subscription, membersRemoved)
      }
    }
  }
})
