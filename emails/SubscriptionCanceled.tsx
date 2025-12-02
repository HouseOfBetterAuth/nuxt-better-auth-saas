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

interface SubscriptionCanceledProps {
  name: string
  teamName: string
  planName: string
  endDate: string
  billingUrl: string
  appName?: string
}

export function SubscriptionCanceled({
  name,
  teamName,
  planName,
  endDate,
  billingUrl,
  appName
}: SubscriptionCanceledProps) {
  return (
    <BaseEmail
      previewText={`Your ${planName} subscription has been canceled`}
      heading="Subscription Canceled"
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
        has been canceled.
      </Text>
      <Text style={text}>
        You'll continue to have access to all features until
        {' '}
        <strong>{endDate}</strong>
        .
        After that, your team will be downgraded to the free plan.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={billingUrl}>Resubscribe</EmailButton>
      </Section>
      <Text style={mutedText}>
        Changed your mind? You can resubscribe anytime before your access ends.
      </Text>
    </BaseEmail>
  )
}

export default SubscriptionCanceled
