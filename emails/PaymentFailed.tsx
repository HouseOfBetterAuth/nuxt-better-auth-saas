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

interface PaymentFailedProps {
  name: string
  teamName: string
  amount?: string
  billingUrl: string
  appName?: string
}

export function PaymentFailed({
  name,
  teamName,
  amount,
  billingUrl,
  appName
}: PaymentFailedProps) {
  return (
    <BaseEmail
      previewText="Action required: Your payment failed"
      heading="Payment Failed"
      appName={appName}
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        We were unable to process a payment
        {amount ? ` of ${amount}` : ''}
        {' '}
        for
        {' '}
        <strong>{teamName}</strong>
        .
      </Text>
      <Section style={alertBox}>
        <Text style={alertText}>
          Your card was declined. Please update your payment method to avoid any interruption to your service.
        </Text>
      </Section>
      <Text style={text}>
        This could happen for several reasons:
      </Text>
      <Text style={{ ...text, paddingLeft: '16px' }}>
        • Your card has expired
        <br />
        • Insufficient funds
        <br />
        • Your bank declined the transaction
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={billingUrl}>Update Payment Method</EmailButton>
      </Section>
      <Text style={mutedText}>
        If you believe this is an error or need assistance, please contact our support team.
      </Text>
    </BaseEmail>
  )
}

export default PaymentFailed
