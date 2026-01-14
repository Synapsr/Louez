import { Button, Heading, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, type EmailLocale } from '../i18n'
import type { EmailCustomContent } from '@/types/store'

interface ReminderPickupEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  reservationUrl: string
  customContent?: EmailCustomContent
  locale?: EmailLocale
}

export function ReminderPickupEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  startDate,
  reservationUrl,
  customContent,
  locale = 'fr',
}: ReminderPickupEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.reminderPickup
  const tc = t.common
  const dateLocale = getDateLocale(locale)
  const datePatterns = getDateFormatPatterns(locale)

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  // Use custom content or defaults
  const greeting = customContent?.greeting
    ? customContent.greeting.replace('{name}', customerFirstName)
    : tc.greeting.replace('{name}', customerFirstName)

  const customMessage = customContent?.message
    ? customContent.message
        .replace('{number}', reservationNumber)
        .replace('{name}', customerFirstName)
    : null

  const signatureText = customContent?.signature || `${messages.seeTomorrow}\n${tc.team.replace('{storeName}', storeName)}`

  return (
    <BaseLayout
      preview={customContent?.subject || messages.subject}
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

      <Section style={infoBox}>
        <Text style={infoTitle}>{messages.scheduledPickup}</Text>
        <Text style={infoDate}>
          {format(startDate, datePatterns.full, { locale: dateLocale })}
        </Text>
        {storeAddress && (
          <>
            <Text style={infoTitle}>{tc.address}</Text>
            <Text style={infoText}>
              {storeName}
              <br />
              {storeAddress}
            </Text>
          </>
        )}
      </Section>

      <Section style={checklistSection}>
        <Text style={checklistTitle}>{messages.dontForget}</Text>
        <Text style={checklistItem}>• {messages.bringId}</Text>
        <Text style={checklistItem}>• {messages.bringConfirmation}</Text>
      </Section>

      <Section style={ctaSection}>
        <Button href={reservationUrl} style={buttonStyle}>
          {tc.viewReservation}
        </Button>
      </Section>

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

const infoBox = {
  backgroundColor: '#eff6ff',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
}

const infoTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#3b82f6',
  marginBottom: '4px',
  marginTop: '12px',
}

const infoDate = {
  fontSize: '18px',
  fontWeight: 'bold' as const,
  color: '#1e40af',
  margin: '0',
}

const infoText = {
  fontSize: '14px',
  color: '#1e40af',
  margin: '0',
}

const checklistSection = {
  marginTop: '24px',
}

const checklistTitle = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  marginBottom: '8px',
}

const checklistItem = {
  fontSize: '14px',
  color: '#525f7f',
  margin: '0 0 4px 0',
}

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '32px',
}

const button = {
  backgroundColor: '#0066FF',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
}

const signature = {
  fontSize: '14px',
  color: '#525f7f',
  marginTop: '32px',
}

export default ReminderPickupEmail
