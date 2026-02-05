import { Heading, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, type EmailLocale } from '../i18n'
import type { EmailCustomContent } from '@louez/types'

interface ReminderReturnEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  endDate: Date
  customContent?: EmailCustomContent
  locale?: EmailLocale
}

export function ReminderReturnEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  endDate,
  customContent,
  locale = 'fr',
}: ReminderReturnEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.reminderReturn
  const tc = t.common
  const dateLocale = getDateLocale(locale)
  const datePatterns = getDateFormatPatterns(locale)

  // Use custom content or defaults
  const greeting = customContent?.greeting
    ? customContent.greeting.replace('{name}', customerFirstName)
    : tc.greeting.replace('{name}', customerFirstName)

  const customMessage = customContent?.message
    ? customContent.message
        .replace('{number}', reservationNumber)
        .replace('{name}', customerFirstName)
    : null

  const signatureText = customContent?.signature || `${messages.thanks}\n${tc.team.replace('{storeName}', storeName)}`

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
        <Text style={infoTitle}>{messages.scheduledReturn}</Text>
        <Text style={infoDate}>
          {format(endDate, datePatterns.full, { locale: dateLocale })}
        </Text>
        {storeAddress && (
          <>
            <Text style={infoTitle}>{tc.returnAddress}</Text>
            <Text style={infoText}>
              {storeName}
              <br />
              {storeAddress}
            </Text>
          </>
        )}
      </Section>

      <Text style={paragraph}>
        {messages.returnInfo}
      </Text>

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
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
}

const infoTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#d97706',
  marginBottom: '4px',
  marginTop: '12px',
}

const infoDate = {
  fontSize: '18px',
  fontWeight: 'bold' as const,
  color: '#92400e',
  margin: '0',
}

const infoText = {
  fontSize: '14px',
  color: '#92400e',
  margin: '0',
}

const signature = {
  fontSize: '14px',
  color: '#525f7f',
  marginTop: '32px',
}

export default ReminderReturnEmail
