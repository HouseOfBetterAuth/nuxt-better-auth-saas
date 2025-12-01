import { Section, Text } from '@react-email/components'
import { BaseEmail, EmailButton } from './BaseEmail'

const text = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#111827',
  margin: '0 0 16px'
}

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '24px 0'
}

const mutedText = {
  fontSize: '13px',
  color: '#6b7280'
}

const alertBox = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0'
}

const alertText = {
  fontSize: '14px',
  color: '#991b1b',
  margin: '0'
}

interface SubscriptionExpiredProps {
  name: string
  teamName: string
  planName: string
  membersRemoved: number
  billingUrl: string
  appName?: string
}

export function SubscriptionExpired({
  name,
  teamName,
  planName,
  membersRemoved,
  billingUrl,
  appName
}: SubscriptionExpiredProps) {
  return (
    <BaseEmail
      previewText={`Your ${planName} subscription has expired`}
      heading="Subscription Expired"
      appName={appName}
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        Your
        {' '}
        <strong>{planName}</strong>
        {' '}
        subscription for
        {' '}
        <strong>{teamName}</strong>
        {' '}
        has expired and your organization has been downgraded to the free plan.
      </Text>

      {membersRemoved > 0 && (
        <Section style={alertBox}>
          <Text style={alertText}>
            <strong>{membersRemoved}</strong>
            {' '}
            team member
            {membersRemoved > 1 ? 's have' : ' has'}
            {' '}
            been removed from your organization. You will need to re-invite them if you reactivate your subscription.
          </Text>
        </Section>
      )}

      <Text style={text}>
        Your organization data from the Pro plan will be retained for
        {' '}
        <strong>90 days</strong>
        . After that, it will be permanently deleted.
      </Text>

      <Text style={text}>
        You can reactivate your subscription at any time to regain access to Pro features and your organization data.
      </Text>

      <Section style={buttonContainer}>
        <EmailButton href={billingUrl}>Reactivate Subscription</EmailButton>
      </Section>

      <Text style={mutedText}>
        If you have any questions or need assistance, please contact our support team.
      </Text>
    </BaseEmail>
  )
}

export default SubscriptionExpired
