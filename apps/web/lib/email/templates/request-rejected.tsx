import { Heading, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getEmailTranslations, type EmailLocale } from '../i18n'
import type { EmailCustomContent } from '@louez/types'

interface RequestRejectedEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  customerFirstName: string
  reservationNumber: string
  reason?: string | null
  customContent?: EmailCustomContent
  locale?: EmailLocale
}

export function RequestRejectedEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeEmail,
  storePhone,
  storeAddress,
  customerFirstName,
  reservationNumber,
  reason,
  customContent,
  locale = 'fr',
}: RequestRejectedEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.requestRejected
  const tc = t.common

  // Use custom content or defaults
  const greeting = customContent?.greeting
    ? customContent.greeting.replace('{name}', customerFirstName)
    : tc.greeting.replace('{name}', customerFirstName)

  const customMessage = customContent?.message
    ? customContent.message
        .replace('{number}', reservationNumber)
        .replace('{name}', customerFirstName)
    : null

  const signatureText = customContent?.signature || `${tc.regards}\n${tc.team.replace('{storeName}', storeName)}`

  return (
    <BaseLayout
      preview={customContent?.subject?.replace('{number}', reservationNumber) || messages.subject.replace('{number}', reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>{greeting}</Text>

      <Text style={paragraph}>
        {messages.body.replace('{number}', reservationNumber)}
      </Text>

      {/* Custom message from store settings */}
      {customMessage && (
        <Text style={paragraph}>{customMessage}</Text>
      )}

      {reason && (
        <Section style={reasonBox}>
          <Text style={reasonText}>{reason}</Text>
        </Section>
      )}

      <Text style={paragraph}>
        {messages.contactForAlternative}
      </Text>

      {/* Contact */}
      {(storeEmail || storePhone) && (
        <Section style={contactSection}>
          <Text style={contactTitle}>{tc.contactUs}</Text>
          {storeEmail && <Text style={contactText}>{storeEmail}</Text>}
          {storePhone && <Text style={contactText}>{storePhone}</Text>}
        </Section>
      )}

      <Text style={{ ...signature, whiteSpace: 'pre-line' }}>
        {signatureText}
      </Text>
    </BaseLayout>
  )
}

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  marginBottom: '24px',
}

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#525f7f',
  margin: '0 0 16px 0',
}

const reasonBox = {
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '16px',
  margin: '24px 0',
  borderLeft: '4px solid #ef4444',
}

const reasonText = {
  fontSize: '14px',
  color: '#991b1b',
  margin: '0',
}

const contactSection = {
  backgroundColor: '#f4f4f5',
  borderRadius: '8px',
  padding: '16px',
  marginTop: '24px',
}

const contactTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#8898aa',
  marginBottom: '8px',
}

const contactText = {
  fontSize: '14px',
  color: '#1a1a1a',
  margin: '0 0 4px 0',
}

const signature = {
  fontSize: '14px',
  color: '#525f7f',
  marginTop: '32px',
}

export default RequestRejectedEmail
