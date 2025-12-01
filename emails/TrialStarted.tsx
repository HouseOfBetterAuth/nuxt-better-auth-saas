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

interface TrialStartedProps {
  name: string
  teamName: string
  planName: string
  trialDays: number
  trialEndDate: string
  dashboardUrl: string
  appName?: string
}

export function TrialStarted({
  name,
  teamName,
  planName,
  trialDays,
  trialEndDate,
  dashboardUrl,
  appName
}: TrialStartedProps) {
  return (
    <BaseEmail
      previewText={`Your ${trialDays}-day free trial has started`}
      heading="Welcome to Your Free Trial! 🎉"
      appName={appName}
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        Great news! Your
        {' '}
        {trialDays}
        -day free trial of
        {' '}
        <strong>{planName}</strong>
        {' '}
        for
        {' '}
        <strong>{teamName}</strong>
        {' '}
        has started.
      </Text>
      <Text style={text}>
        You now have full access to all Pro features. Your trial will end on
        {' '}
        <strong>{trialEndDate}</strong>
        .
      </Text>
      <Text style={text}>
        You will automatically be billed with your card on file when the trial is over.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={dashboardUrl}>Go to Dashboard</EmailButton>
      </Section>
      <Text style={mutedText}>
        No payment required during your trial. You can cancel anytime.
      </Text>
    </BaseEmail>
  )
}

export default TrialStarted
