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
  color: '#10b981'
}

interface VerifyEmailProps {
  name: string
  url: string
  appName?: string
}

export function VerifyEmail({
  name,
  url,
  appName
}: VerifyEmailProps) {
  return (
    <BaseEmail
      previewText="Verify your email address"
      heading="Verify your email"
      appName={appName}
      footerText="If you didn't create an account, you can safely ignore this email."
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        Thanks for signing up! Please verify your email address to get started.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={url}>Verify Email</EmailButton>
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

export default VerifyEmail
