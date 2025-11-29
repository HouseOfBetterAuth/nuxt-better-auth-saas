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
export { ResetPassword } from './ResetPassword'
export { SubscriptionCanceled } from './SubscriptionCanceled'
export { SubscriptionConfirmed } from './SubscriptionConfirmed'
export { TeamInvite } from './TeamInvite'
export { TrialExpired } from './TrialExpired'
export { VerifyEmail } from './VerifyEmail'
