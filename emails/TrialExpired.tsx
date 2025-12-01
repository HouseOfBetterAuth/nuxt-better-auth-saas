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

interface TrialExpiredProps {
  name: string
  teamName: string
  planName: string
  billingUrl: string
  appName?: string
}

export function TrialExpired({
  name,
  teamName,
  planName,
  billingUrl,
  appName
}: TrialExpiredProps) {
  return (
    <BaseEmail
      previewText={`Your ${planName} trial has expired`}
      heading="Your trial has expired"
      appName={appName}
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        Your free trial of
        {' '}
        <strong>{planName}</strong>
        {' '}
        for
        {' '}
        <strong>{teamName}</strong>
        {' '}
        has expired.
      </Text>
      <Text style={text}>
        We couldn't process your payment. To continue using all Pro features, please update your payment method. Otherwise, your team will be downgraded to the free plan.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={billingUrl}>Update Payment Method</EmailButton>
      </Section>
      <Text style={mutedText}>
        If you have any questions or need help, our support team is here to assist you.
      </Text>
    </BaseEmail>
  )
}

export default TrialExpired
