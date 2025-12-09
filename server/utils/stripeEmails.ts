/**
 * Stripe Email Notifications
 * Handles sending emails for subscription events
 */

import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { findPlanById, findPlanByPriceId, PLANS } from '~~/shared/utils/plans'
import { organization as organizationTable, user as userTable } from '../database/schema'
import { useDB } from './db'
import { resendInstance } from './drivers'
import {
  renderPaymentFailed,
  renderSubscriptionCanceled,
  renderSubscriptionConfirmed,
  renderSubscriptionExpired,
  renderSubscriptionResumed,
  renderTrialExpired,
  renderTrialStarted
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
 * Get subscription details from Better Auth subscription object or Stripe API response
 */
function getSubscriptionInfo(subscription: any): SubscriptionInfo {
  // Handle both DB subscription (plan is string like 'pro-monthly-v2')
  // and Stripe API response (plan.id is price ID like 'price_xxx')
  const planId = typeof subscription.plan === 'string'
    ? subscription.plan
    : subscription.plan?.id || subscription.plan?.name

  // Also check items array for Stripe API response
  const priceId = subscription.priceId
    || subscription.items?.data?.[0]?.price?.id
    || subscription.plan?.id

  const plan = findPlanById(planId) || findPlanByPriceId(priceId)

  const interval = plan?.interval
    || subscription.plan?.interval
    || subscription.items?.data?.[0]?.plan?.interval
  const billingCycle = interval === 'year' ? 'yearly' : 'monthly'

  // Get seats from subscription
  const seats = subscription.seats || subscription.quantity || subscription.items?.data?.[0]?.quantity || 1

  return {
    planName: plan?.key === 'pro' ? 'Pro' : (plan?.label || 'Pro'),
    billingCycle,
    seats,
    amount: plan?.priceNumber ? `$${plan.priceNumber}` : 'See invoice',
    periodEnd: subscription.periodEnd
      ? new Date(subscription.periodEnd)
      : subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null
  }
}

/**
 * Get detailed subscription info from Stripe API
 */
async function getStripeSubscriptionDetails(subscription: any): Promise<{
  seats: number
  amount: string
  periodEnd: Date | null
} | null> {
  try {
    const subId = subscription.stripeSubscriptionId || subscription.id
    if (!subId) {
      console.warn('[Stripe Email] No subscription ID found in:', Object.keys(subscription))
      return null
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[Stripe Email] Fetching subscription details for:', subId)
    }

    const client = createStripeClient()
    const stripeSub = await client.subscriptions.retrieve(subId, {
      expand: ['items.data.price']
    }) as Stripe.Subscription

    if (process.env.NODE_ENV === 'development') {
      console.log('[Stripe Email] Stripe subscription:', {
        id: stripeSub.id,
        status: stripeSub.status,
        current_period_end: stripeSub.current_period_end,
        items: stripeSub.items.data.map(i => ({
          quantity: i.quantity,
          unit_amount: i.price?.unit_amount,
          currency: i.price?.currency
        }))
      })
    }

    const seats = stripeSub.items.data[0]?.quantity || 1
    const unitAmount = stripeSub.items.data[0]?.price?.unit_amount || 0
    const currency = stripeSub.currency || 'usd'

    // Calculate total amount (unit price * seats)
    const totalAmount = unitAmount * seats / 100
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(totalAmount)

    const periodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null

    if (process.env.NODE_ENV === 'development') {
      console.log('[Stripe Email] Calculated:', { seats, amount, periodEnd })
    }

    return {
      seats,
      amount,
      periodEnd
    }
  } catch (e) {
    console.warn('[Stripe Email] Failed to get subscription details:', e)
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
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Stripe Email] Sent "${subject}" to ${to}`)
    }
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
 * Build email data for subscription confirmation/update emails
 */
async function buildSubscriptionEmailData(organizationId: string, subscription: any) {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return null

  const subInfo = getSubscriptionInfo(subscription)

  // Handle both DB subscription and Stripe API response formats
  const seats = subscription.seats || subscription.quantity || subscription.items?.data?.[0]?.quantity || subInfo.seats

  // Get period end from various sources
  const periodEnd = subscription.periodEnd
    ? new Date(subscription.periodEnd)
    : subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : subscription.items?.data?.[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000)
        : null

  // Get price info from plan config
  const priceId = subscription.priceId
    || subscription.plan?.id
    || subscription.items?.data?.[0]?.price?.id
  const planId = typeof subscription.plan === 'string' ? subscription.plan : null

  // Use helper functions that handle -no-trial suffix automatically
  const plan = findPlanById(planId) || findPlanByPriceId(priceId)

  // Pricing: base price (includes 1 seat) + additional seats × seat price
  const basePrice = plan?.priceNumber || 0
  const seatPrice = plan?.seatPriceNumber || 0
  const additionalSeats = Math.max(0, seats - 1)
  const totalAmount = basePrice + (additionalSeats * seatPrice)
  const amount = totalAmount > 0
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(totalAmount)
    : subInfo.amount

  return {
    info,
    subInfo,
    emailData: {
      name: info.owner.name,
      teamName: info.org.name,
      planName: subInfo.planName,
      seats,
      billingCycle: subInfo.billingCycle,
      basePrice: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(basePrice),
      additionalSeats,
      seatPrice: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(seatPrice),
      amount,
      nextBillingDate: periodEnd ? formatDate(periodEnd) : 'See billing portal',
      dashboardUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/dashboard`
    }
  }
}

/**
 * Send subscription confirmation email to org owner
 */
export async function sendSubscriptionConfirmedEmail(organizationId: string, subscription: any): Promise<void> {
  const data = await buildSubscriptionEmailData(organizationId, subscription)
  if (!data)
    return

  const html = await renderSubscriptionConfirmed(data.emailData)
  await sendEmail(data.info.owner.email, `Your ${data.subInfo.planName} subscription is confirmed`, html)
}

/**
 * Send subscription updated email to org owner (for seat/plan changes)
 */
export async function sendSubscriptionUpdatedEmail(
  organizationId: string,
  subscription: any,
  previousSeats?: number,
  newSeats?: number,
  previousInterval?: string,
  newInterval?: string
): Promise<void> {
  const data = await buildSubscriptionEmailData(organizationId, subscription)
  if (!data)
    return

  // Build a custom message showing what changed
  let changeDescription = 'Your subscription update has been confirmed.'

  // Check for seat changes
  if (previousSeats !== undefined && newSeats !== undefined && previousSeats !== newSeats) {
    if (newSeats > previousSeats) {
      changeDescription = `You've added ${newSeats - previousSeats} seat${newSeats - previousSeats > 1 ? 's' : ''} (${previousSeats} → ${newSeats} seats).`
    } else {
      changeDescription = `You've removed ${previousSeats - newSeats} seat${previousSeats - newSeats > 1 ? 's' : ''} (${previousSeats} → ${newSeats} seats).`
    }
  }
  // Check for plan interval changes
  else if (previousInterval && newInterval && previousInterval !== newInterval) {
    changeDescription = `You've switched from ${previousInterval} to ${newInterval} billing.`
  }

  // Override the email data with the change description
  const emailData = {
    ...data.emailData,
    changeDescription
  }

  const html = await renderSubscriptionConfirmed(emailData)
  await sendEmail(data.info.owner.email, `Your ${data.subInfo.planName} subscription has been updated`, html)
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

/**
 * Send trial started email to org owner
 */
export async function sendTrialStartedEmail(organizationId: string, subscription: any): Promise<void> {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return

  const subInfo = getSubscriptionInfo(subscription)

  // Calculate trial end date
  const trialEnd = subscription.trialEnd
    ? new Date(subscription.trialEnd)
    : subscription.trialEndDate
      ? new Date(subscription.trialEndDate)
      : null

  // Get trial days from plan config
  const planId = subscription.plan?.id || subscription.plan?.name
  const plan = Object.values(PLANS).find(p => p.id === planId || p.priceId === subscription.priceId)
  const trialDays = plan?.trialDays || 14

  const html = await renderTrialStarted({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    trialDays,
    trialEndDate: trialEnd ? formatDate(trialEnd) : `in ${trialDays} days`,
    dashboardUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/dashboard`
  })

  await sendEmail(info.owner.email, `Your ${trialDays}-day free trial has started`, html)
}

/**
 * Send subscription resumed email to org owner
 */
export async function sendSubscriptionResumedEmail(organizationId: string, subscription: any): Promise<void> {
  const info = await getOrgOwnerInfo(organizationId)
  if (!info)
    return

  const subInfo = getSubscriptionInfo(subscription)

  // Calculate amount based on seats and plan pricing
  const plan = Object.values(PLANS).find(p => p.priceId === subscription.items?.data?.[0]?.price?.id)
  const basePrice = plan?.priceNumber || 0
  const seatPrice = plan?.seatPriceNumber || 0
  const additionalSeats = Math.max(0, subInfo.seats - 1)
  const totalAmount = basePrice + (additionalSeats * seatPrice)
  const amount = totalAmount > 0
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(totalAmount)
    : subInfo.amount

  // Get period end from Stripe subscription or items
  const periodEnd = subInfo.periodEnd
    || (subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null)
    || (subscription.items?.data?.[0]?.current_period_end ? new Date(subscription.items.data[0].current_period_end * 1000) : null)

  const html = await renderSubscriptionResumed({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    billingCycle: subInfo.billingCycle,
    seats: subInfo.seats,
    amount,
    nextBillingDate: periodEnd ? formatDate(periodEnd) : 'your next billing date',
    dashboardUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/dashboard`
  })

  await sendEmail(info.owner.email, `Your ${subInfo.planName} subscription has been resumed`, html)
}

/**
 * Send payment failed email when a payment is declined
 * Triggered by payment_intent.payment_failed webhook
 */
export async function sendPaymentFailedEmail(customerId: string, amount?: number, paymentIntentId?: string) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Email] Sending payment failed email for customer:', customerId, paymentIntentId ? `PI: ${paymentIntentId}` : '')
  }

  // Look up organization by Stripe customer ID
  const db = await useDB()
  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.stripeCustomerId, customerId)
  })

  if (!org) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Email] No organization found for customer:', customerId)
    }
    return
  }

  // Get owner info
  const info = await getOrgOwnerInfo(org.id)
  if (!info) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Email] Could not get owner info for org:', org.id)
    }
    return
  }

  const formattedAmount = amount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'usd' }).format(amount / 100)
    : undefined

  const html = await renderPaymentFailed({
    name: info.owner.name,
    teamName: info.org.name,
    amount: formattedAmount,
    billingUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/billing`
  })

  await sendEmail(info.owner.email, 'Action required: Your payment failed', html)
}

/**
 * Send subscription expired email to org owner
 * Triggered when subscription is deleted (grace period ended)
 */
export async function sendSubscriptionExpiredEmail(organizationId: string, subscription: any, membersRemoved: number): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Email] Sending subscription expired email for org:', organizationId)
  }

  const info = await getOrgOwnerInfo(organizationId)
  if (!info) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Email] Could not get owner info for org:', organizationId)
    }
    return
  }

  const subInfo = getSubscriptionInfo(subscription)

  const html = await renderSubscriptionExpired({
    name: info.owner.name,
    teamName: info.org.name,
    planName: subInfo.planName,
    membersRemoved,
    billingUrl: `${runtimeConfig.public.baseURL}/${info.org.slug}/billing`
  })

  await sendEmail(info.owner.email, `Your ${subInfo.planName} subscription has expired`, html)
}
