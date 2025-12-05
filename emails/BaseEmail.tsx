import type { ReactNode } from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text
} from '@react-email/components'

// Styles
const main = {
  backgroundColor: '#f9fafb',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
}

const container = {
  maxWidth: '480px',
  margin: '0 auto',
  padding: '40px 20px'
}

const header = {
  backgroundColor: '#ffffff',
  borderRadius: '12px 12px 0 0',
  borderBottom: '1px solid #e5e7eb',
  padding: '32px 32px 24px',
  textAlign: 'center' as const
}

const logo = {
  margin: '0',
  fontSize: '24px',
  fontWeight: '600',
  color: '#111827'
}

const content = {
  backgroundColor: '#ffffff',
  padding: '32px',
  borderRadius: '0 0 12px 12px'
}

const h1 = {
  margin: '0 0 16px',
  fontSize: '20px',
  fontWeight: '600',
  color: '#111827'
}

const button = {
  display: 'inline-block',
  padding: '12px 32px',
  backgroundColor: '#f59e0b',
  color: '#ffffff',
  textDecoration: 'none',
  fontWeight: '500',
  fontSize: '15px',
  borderRadius: '8px',
  textAlign: 'center' as const
}

const mutedText = {
  marginTop: '24px',
  fontSize: '13px',
  color: '#6b7280'
}

const hr = {
  borderColor: '#e5e7eb',
  margin: '0'
}

const footer = {
  padding: '24px 32px',
  textAlign: 'center' as const
}

const footerCopy = {
  margin: '0',
  fontSize: '13px',
  color: '#6b7280'
}

interface BaseEmailProps {
  previewText: string
  heading: string
  children: ReactNode
  footerText?: string
  appName?: string
}

export function BaseEmail({
  previewText,
  heading,
  children,
  footerText,
  appName
}: BaseEmailProps) {
  const currentYear = new Date().getFullYear()

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={logo}>{appName}</Heading>
          </Section>

          {/* Content */}
          <Section style={content}>
            <Heading style={h1}>{heading}</Heading>
            {children}
            {footerText && (
              <Text style={mutedText}>{footerText}</Text>
            )}
          </Section>

          {/* Footer */}
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerCopy}>
              ©
              {' '}
              {currentYear}
              {' '}
              {appName}
              . All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Shared button component
export function EmailButton({
  href,
  children
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Link href={href} style={button}>
      {children}
    </Link>
  )
}

export default BaseEmail
