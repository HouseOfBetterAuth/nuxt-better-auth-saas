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

interface TeamInviteProps {
  inviterName: string
  teamName: string
  url: string
  appName?: string
}

export function TeamInvite({
  inviterName,
  teamName,
  url,
  appName
}: TeamInviteProps) {
  return (
    <BaseEmail
      previewText={`You're invited to join ${teamName}`}
      heading={`You're invited to join ${teamName}`}
      appName={appName}
      footerText="If you don't want to join this team, you can safely ignore this email."
    >
      <Text style={text}>Hello,</Text>
      <Text style={text}>
        <strong>{inviterName}</strong>
        {' '}
        has invited you to join
        {' '}
        <strong>{teamName}</strong>
        .
      </Text>
      <Text style={text}>
        Click the button below to accept the invitation and join the team.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={url}>Accept Invitation</EmailButton>
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

export default TeamInvite
