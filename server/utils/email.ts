/**
 * Email rendering utilities using React Email
 */

import { render } from '@react-email/render'
import { DeleteAccount } from '../../emails/DeleteAccount'
import { PaymentFailed } from '../../emails/PaymentFailed'
import { ResetPassword } from '../../emails/ResetPassword'
import { SubscriptionCanceled } from '../../emails/SubscriptionCanceled'
import { SubscriptionConfirmed } from '../../emails/SubscriptionConfirmed'
import { SubscriptionExpired } from '../../emails/SubscriptionExpired'
import { SubscriptionResumed } from '../../emails/SubscriptionResumed'
import { TeamInvite } from '../../emails/TeamInvite'
import { TrialExpired } from '../../emails/TrialExpired'
import { TrialStarted } from '../../emails/TrialStarted'
import { VerifyEmail } from '../../emails/VerifyEmail'
import { runtimeConfig } from './runtimeConfig'

const getAppName = () => runtimeConfig.public.appName || 'NuxSaaS'

export async function renderVerifyEmail(name: string, url: string): Promise<string> {
  return await render(VerifyEmail({ name, url, appName: getAppName() }))
}

export async function renderResetPassword(name: string, url: string): Promise<string> {
  return await render(ResetPassword({ name, url, appName: getAppName() }))
}

export async function renderDeleteAccount(name: string, url: string): Promise<string> {
  return await render(DeleteAccount({ name, url, appName: getAppName() }))
}

export async function renderTeamInvite(
  inviterName: string,
  teamName: string,
  url: string
): Promise<string> {
  return await render(TeamInvite({ inviterName, teamName, url, appName: getAppName() }))
}

export async function renderSubscriptionConfirmed(options: {
  name: string
  teamName: string
  planName: string
  seats: number
  billingCycle: 'monthly' | 'yearly'
  basePrice: string
  additionalSeats: number
  seatPrice: string
  amount: string
  nextBillingDate: string
  dashboardUrl: string
  changeDescription?: string
}): Promise<string> {
  return await render(SubscriptionConfirmed({ ...options, appName: getAppName() }))
}

export async function renderTrialExpired(options: {
  name: string
  teamName: string
  planName: string
  billingUrl: string
}): Promise<string> {
  return await render(TrialExpired({ ...options, appName: getAppName() }))
}

export async function renderSubscriptionCanceled(options: {
  name: string
  teamName: string
  planName: string
  endDate: string
  billingUrl: string
}): Promise<string> {
  return await render(SubscriptionCanceled({ ...options, appName: getAppName() }))
}

export async function renderTrialStarted(options: {
  name: string
  teamName: string
  planName: string
  trialDays: number
  trialEndDate: string
  dashboardUrl: string
}): Promise<string> {
  return await render(TrialStarted({ ...options, appName: getAppName() }))
}

export async function renderSubscriptionResumed(options: {
  name: string
  teamName: string
  planName: string
  billingCycle: 'monthly' | 'yearly'
  seats: number
  amount: string
  nextBillingDate: string
  dashboardUrl: string
}): Promise<string> {
  return await render(SubscriptionResumed({ ...options, appName: getAppName() }))
}

export async function renderPaymentFailed(options: {
  name: string
  teamName: string
  amount?: string
  billingUrl: string
}): Promise<string> {
  return await render(PaymentFailed({ ...options, appName: getAppName() }))
}

export async function renderSubscriptionExpired(options: {
  name: string
  teamName: string
  planName: string
  membersRemoved: number
  billingUrl: string
}): Promise<string> {
  return await render(SubscriptionExpired({ ...options, appName: getAppName() }))
}
