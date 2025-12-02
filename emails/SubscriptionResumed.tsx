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

interface SubscriptionResumedProps {
  name: string
  teamName: string
  planName: string
  billingCycle: 'monthly' | 'yearly'
  seats: number
  amount: string
  nextBillingDate: string
  dashboardUrl: string
  appName?: string
}

const detailsBox = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0'
}

const detailsTitle = {
  fontSize: '14px',
  fontWeight: '600' as const,
  color: '#111827',
  margin: '0 0 12px'
}

const detailsTable = {
  width: '100%',
  borderCollapse: 'collapse' as const
}

const labelCell = {
  fontSize: '14px',
  color: '#6b7280',
  padding: '6px 0',
  width: '120px'
}

const valueCell = {
  fontSize: '14px',
  color: '#111827',
  fontWeight: '500' as const,
  padding: '6px 0'
}

export function SubscriptionResumed({
  name,
  teamName,
  planName,
  billingCycle,
  seats,
  amount,
  nextBillingDate,
  dashboardUrl,
  appName
}: SubscriptionResumedProps) {
  return (
    <BaseEmail
      previewText={`Your ${planName} subscription has been resumed`}
      heading="Subscription Resumed! 🎉"
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
        <strong>{planName}</strong>
        {' '}
        subscription for
        {' '}
        <strong>{teamName}</strong>
        {' '}
        has been resumed.
      </Text>

      <Section style={detailsBox}>
        <Text style={detailsTitle}>Subscription Details</Text>
        <table style={detailsTable}>
          <tbody>
            <tr>
              <td style={labelCell}>Organization</td>
              <td style={valueCell}>{teamName}</td>
            </tr>
            <tr>
              <td style={labelCell}>Plan</td>
              <td style={valueCell}>
                {planName}
                {' '}
                (
                {billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}
                )
              </td>
            </tr>
            <tr>
              <td style={labelCell}>Seats</td>
              <td style={valueCell}>
                {seats}
                {' '}
                {seats === 1 ? 'seat' : 'seats'}
              </td>
            </tr>
            <tr>
              <td style={labelCell}>Amount</td>
              <td style={valueCell}>{amount}</td>
            </tr>
            <tr>
              <td style={labelCell}>Next billing</td>
              <td style={valueCell}>{nextBillingDate}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={buttonContainer}>
        <EmailButton href={dashboardUrl}>Go to Dashboard</EmailButton>
      </Section>
      <Text style={mutedText}>
        Thank you for staying with us! If you have any questions, we're here to help.
      </Text>
    </BaseEmail>
  )
}

export default SubscriptionResumed
