/**
 * React Email Templates
 *
 * Usage in server handlers:
 * import { render } from '@react-email/render'
 * import { VerifyEmail } from '~/emails'
 *
 * const html = await render(VerifyEmail({ name: 'Joe', url: '...' }))
 */

export { BaseEmail, EmailButton } from './BaseEmail'
export { DeleteAccount } from './DeleteAccount'
export { PaymentFailed } from './PaymentFailed'
export { ResetPassword } from './ResetPassword'
export { SubscriptionCanceled } from './SubscriptionCanceled'
export { SubscriptionConfirmed } from './SubscriptionConfirmed'
export { SubscriptionExpired } from './SubscriptionExpired'
export { SubscriptionResumed } from './SubscriptionResumed'
export { TeamInvite } from './TeamInvite'
export { TrialExpired } from './TrialExpired'
export { TrialStarted } from './TrialStarted'
export { VerifyEmail } from './VerifyEmail'
