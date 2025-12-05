import { Link, Section, Text } from '@react-email/components'
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

const linkText = {
  fontSize: '13px',
  color: '#6b7280',
  wordBreak: 'break-all' as const
}

const link = {
  color: '#f59e0b'
}

interface ResetPasswordProps {
  name: string
  url: string
  appName?: string
}

export function ResetPassword({
  name,
  url,
  appName
}: ResetPasswordProps) {
  return (
    <BaseEmail
      previewText="Reset your password"
      heading="Reset your password"
      appName={appName}
      footerText="If you didn't request a password reset, you can safely ignore this email. This link will expire in 1 hour."
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        We received a request to reset your password. Click the button below to choose a new password.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={url}>Reset Password</EmailButton>
      </Section>
      <Text style={linkText}>
        Or copy this link:
        {' '}
        <Link href={url} style={link}>
          {url}
        </Link>
      </Text>
    </BaseEmail>
  )
}

export default ResetPassword
