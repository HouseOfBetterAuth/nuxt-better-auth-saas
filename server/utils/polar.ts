import type { Benefit } from '@polar-sh/sdk/models/components/benefit.js'
import type { BenefitGrantWebhook } from '@polar-sh/sdk/models/components/benefitgrantwebhook.js'
import type { Checkout } from '@polar-sh/sdk/models/components/checkout.js'
import type { Customer } from '@polar-sh/sdk/models/components/customer.js'
import type { CustomerState } from '@polar-sh/sdk/models/components/customerstate.js'
import type { Order } from '@polar-sh/sdk/models/components/order.js'
import type { Organization } from '@polar-sh/sdk/models/components/organization.js'
import type { Product } from '@polar-sh/sdk/models/components/product.js'
import type { Refund } from '@polar-sh/sdk/models/components/refund.js'
import type { Subscription } from '@polar-sh/sdk/models/components/subscription.js'
import { checkout, polar, portal, usage, webhooks } from '@polar-sh/better-auth'
import { Polar } from '@polar-sh/sdk'
import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable } from '../database/schema'
import { logAuditEvent } from './auditLogger'
import { useDB } from './db'
import { runtimeConfig } from './runtimeConfig'

/**
 * POLAR ORGANIZATION BILLING IMPLEMENTATION
 *
 * 1. Customer Creation:
 *    - Customers are created for ORGANIZATIONS, not Users.
 *    - `ensurePolarCustomer(organizationId)` is called when a billing action is initiated.
 *    - It fetches the Organization and its Owner (for email).
 *    - It creates a Polar Customer with `externalId` = `organizationId`.
 *    - The Polar Customer ID is stored in `organization.polarCustomerId`.
 *
 * 2. Webhook Handling:
 *    - Webhooks are handled by Better Auth's `polar` plugin via `webhooks.onPayload`.
 *    - The `addPaymentLog` function processes these events.
 *    - It links events back to the Organization using `customer.externalId` (which is the Org ID).
 *    - If `customer.created` event fires with an `externalId`, we ensure the DB is synced.
 *
 * 3. Metadata:
 *    - `ownerUserId` is stored in metadata to track WHO initiated the subscription,
 *      but the billing entity remains the Organization.
 */

const createPolarClient = () => {
  return new Polar({
    accessToken: runtimeConfig.polarAccessToken,
    server: runtimeConfig.polarServer as 'sandbox' | 'production'
  })
}

export const ensurePolarCustomer = async (organizationId: string) => {
  const client = createPolarClient()
  const db = await useDB()

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org) {
    throw new Error('Organization not found')
  }

  if (org.polarCustomerId) {
    // Check if exists in Polar? We assume DB is truth source for ID mapping.
    // But we might want to ensure sync. For now, just return ID.
    return { id: org.polarCustomerId }
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
  if (!email)
    throw new Error('Organization owner email not found')

  // Create Customer
  const customer = await client.customers.create({
    email,
    name: org.name,
    externalId: org.id,
    metadata: {
      ownerUserId: member?.user.id
    }
  })

  // Save to DB
  await db.update(organizationTable)
    .set({ polarCustomerId: customer.id })
    .where(eq(organizationTable.id, organizationId))

  return customer
}

const addPaymentLog = async (hookType: string, data: Customer | Checkout | Benefit | BenefitGrantWebhook | Order | Organization | Product | Refund | Subscription | CustomerState) => {
  if (hookType.startsWith('checkout.')) {
    const checkout = data as Checkout
    // Target ID is Org ID (externalId) if set
    await logAuditEvent({
      userId: 'system',
      category: 'payment',
      action: `polar:${hookType}:${checkout.product.name}`,
      targetType: 'polarExternalId',
      targetId: checkout.customerExternalId || checkout.metadata.email as string,
      status: 'success'
    })
  } else if (hookType.startsWith('customer.')) {
    const customer = data as Customer
    if (hookType == 'customer.created' && customer.externalId) {
      const db = await useDB()
      await db.update(organizationTable).set({
        polarCustomerId: customer.id
      }).where(eq(organizationTable.id, customer.externalId))
    }
    await logAuditEvent({
      userId: 'system',
      category: 'payment',
      action: `polar:${hookType}`,
      targetType: 'polarExternalId',
      targetId: customer.externalId || undefined,
      status: 'success'
    })
  } else if (hookType.startsWith('subscription.')) {
    const subscription = data as Subscription
    await logAuditEvent({
      userId: 'system',
      category: 'payment',
      action: `polar:${hookType}:${subscription.product.name}`,
      targetType: 'polarExternalId',
      targetId: subscription.customer.externalId || undefined,
      status: 'success'
    })
  }
}

export const setupPolar = () => polar({
  client: createPolarClient(),
  createCustomerOnSignUp: false, // Org-based
  use: [
    checkout({
      products: [
        {
          productId: runtimeConfig.polarProductIdProMonth,
          slug: 'pro-monthly'
        },
        {
          productId: runtimeConfig.polarProductIdProYear,
          slug: 'pro-yearly'
        }
      ],
      successUrl: '/',
      authenticatedUsersOnly: true
    }),
    portal(),
    usage(),
    webhooks({
      // On Polar Organization Settings: {APP_URL}/api/auth/polar/webhooks
      secret: runtimeConfig.polarWebhookSecret,
      onPayload: async (payload) => {
        // Catch-all for all events
        await addPaymentLog(payload.type || '', payload.data)
      }
    })
  ]
})
