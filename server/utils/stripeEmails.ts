/**
 * Stripe Email Notifications
 * Handles sending emails for subscription events
 */

import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { PLANS } from '~~/shared/utils/plans'
import { organization as organizationTable, user as userTable } from '../database/schema'
import { useDB } from './db'
import { resendInstance } from './drivers'
import {
  renderSubscriptionCanceled,
  renderSubscriptionConfirmed,
  renderTrialExpired
} from './email'
import { runtimeConfig } from './runtimeConfig'
import { createStripeClient } from './stripe'

// ============================================================================
// Types
// ============================================================================

interface OrgOwnerInfo {
  org: {
    id: string
    name: string
    slug: string
  }
  owner: {
    name: string
    email: string
  }
}

interface SubscriptionInfo {
  planName: string
  billingCycle: 'monthly' | 'yearly'
  seats: number
  amount: string
  periodEnd: Date | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get organization and owner info for sending emails
 */
async function getOrgOwnerInfo(organizationId: string): Promise<OrgOwnerInfo | null> {
  const db = await useDB()

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId),
    with: { members: true }
  })

  if (!org)
    return null

  // Find owner
  const ownerMember = org.members.find(m => m.role === 'owner')
  if (!ownerMember)
    return null

  // Get owner user details
  const ownerUser = await db.query.user.findFirst({
    where: eq(userTable.id, ownerMember.userId)
  })
  if (!ownerUser)
    return null

  return {
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug
    },
    owner: {
      name: ownerUser.name || ownerUser.email.split('@')[0],
      email: ownerUser.email
    }
  }
}

/**
 * Get subscription details from Better Auth subscription object
 */
function getSubscriptionInfo(subscription: any): SubscriptionInfo {
  const planId = subscription.plan?.id || subscription.plan?.name
  const plan = Object.values(PLANS).find(p => p.id === planId || p.priceId === subscription.priceId)

  return {
    planName: plan?.label || planId || 'Pro',
    billingCycle: planId?.includes('yearly') || plan?.interval === 'year' ? 'yearly' : 'monthly',
    seats: 1,
    amount: plan?.priceNumber ? `$${plan.priceNumber}` : 'See invoice',
    periodEnd: subscription.periodEnd ? new Date(subscription.periodEnd) : null
  }
}

/**
 * Get detailed subscription info from Stripe API
 */
async function getStripeSubscriptionDetails(subscription: any): Promise<{
  seats: number
  amount: string
  periodEnd: Date
} | null> {
  try {
    const client = createStripeClient()
    const stripeSub = await client.subscriptions.retrieve(
      subscription.stripeSubscriptionId || subscription.id
    ) as Stripe.Subscription

    const seats = stripeSub.items.data[0]?.quantity || 1
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: stripeSub.currency
    }).format((stripeSub.items.data[0]?.price?.unit_amount || 0) * seats / 100)

    return {
      seats,
      amount,
      periodEnd: new Date(stripeSub.current_period_end * 1000)
    }
  } catch (e) {
    console.warn('[Stripe] Failed to get subscription details:', e)
    return null
  }
}

/**
 * Format date for display in emails
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

/**
 * Send an email using Resend
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!resendInstance)
    return false

  try {
    await resendInstance.emails.send({
      from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
      to,
      subject,
      html
    })
    console.log(`[Stripe Email] Sent "${subject}" to ${to}`)
    return true
  } catch (e) {
    console.error(`[Stripe Email] Failed to send "${subject}":`, e)
    return false
  }
}

// ============================================================================
// Email Sending Functions
// ============================================================================

/**
 * Send subscription confirmation email to org owner
 */
export async function sendSubscriptionConfirmedEmail(organizationId: string, subscription: any): Promise<void> {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return

  const subInfo = getSubscriptionInfo(subscription)
  const stripeDetails = await getStripeSubscriptionDetails(subscription)

  const html = await renderSubscriptionConfirmed({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    seats: stripeDetails?.seats || subInfo.seats,
    billingCycle: subInfo.billingCycle,
    amount: stripeDetails?.amount || subInfo.amount,
    nextBillingDate: stripeDetails?.periodEnd ? formatDate(stripeDetails.periodEnd) : 'See billing portal',
    dashboardUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/dashboard`
  })

  await sendEmail(info.owner.email, `Your ${subInfo.planName} subscription is confirmed`, html)
}

/**
 * Send trial expired email to org owner
 */
export async function sendTrialExpiredEmail(organizationId: string, subscription: any): Promise<void> {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return

  const subInfo = getSubscriptionInfo(subscription)

  const html = await renderTrialExpired({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    billingUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/billing`
  })

  await sendEmail(info.owner.email, `Your ${subInfo.planName} trial has expired`, html)
}

/**
 * Send subscription canceled email to org owner
 */
export async function sendSubscriptionCanceledEmail(organizationId: string, subscription: any): Promise<void> {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return

  const subInfo = getSubscriptionInfo(subscription)
  const stripeDetails = await getStripeSubscriptionDetails(subscription)

  const endDate = stripeDetails?.periodEnd || subInfo.periodEnd

  const html = await renderSubscriptionCanceled({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    endDate: endDate ? formatDate(endDate) : 'the end of your billing period',
    billingUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/billing`
  })

  await sendEmail(info.owner.email, `Your ${subInfo.planName} subscription has been canceled`, html)
}
