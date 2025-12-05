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

interface DeleteAccountProps {
  name: string
  url: string
  appName?: string
}

export function DeleteAccount({
  name,
  url,
  appName
}: DeleteAccountProps) {
  return (
    <BaseEmail
      previewText="Confirm account deletion"
      heading="Confirm account deletion"
      appName={appName}
      footerText="If you didn't request this, please ignore this email and your account will remain active."
    >
      <Text style={text}>
        Hello
        {' '}
        {name}
        ,
      </Text>
      <Text style={text}>
        You requested to delete your account. This action is
        {' '}
        <strong>permanent and cannot be undone</strong>
        .
      </Text>
      <Text style={text}>
        If you're sure you want to delete your account, click the button below.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={url}>Delete My Account</EmailButton>
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

export default DeleteAccount
