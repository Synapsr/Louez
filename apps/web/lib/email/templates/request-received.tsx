import { Heading, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, type EmailLocale } from '../i18n'
import type { EmailCustomContent } from '@louez/types'

interface RequestReceivedEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  customContent?: EmailCustomContent
  locale?: EmailLocale
}

export function RequestReceivedEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeEmail,
  storePhone,
  storeAddress,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  customContent,
  locale = 'fr',
}: RequestReceivedEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.requestReceived
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
        {messages.body}
      </Text>

      {/* Custom message from store settings */}
      {customMessage && (
        <Section style={customMessageBox}>
          <Text style={customMessageText}>{customMessage}</Text>
        </Section>
      )}

      <Section style={infoBox}>
        <Text style={infoText}>
          <strong>{tc.reservationNumber.replace('{number}', reservationNumber)}</strong>
        </Text>
        <Text style={infoText}>
          {tc.periodFrom.replace('{startDate}', format(startDate, datePatterns.dateTime, { locale: dateLocale }))} {tc.periodTo.replace('{endDate}', format(endDate, datePatterns.dateTime, { locale: dateLocale })).toLowerCase()}
        </Text>
      </Section>

      <Text style={paragraph}>
        {messages.review}
      </Text>

      <Text style={paragraph}>
        {messages.confirmation}
      </Text>

      <Text style={signature}>
        {messages.seeYouSoon}
        <br />
        {tc.team.replace('{storeName}', storeName)}
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
  backgroundColor: '#f4f4f5',
  borderRadius: '8px',
  padding: '16px',
  margin: '24px 0',
}

const infoText = {
  fontSize: '14px',
  color: '#1a1a1a',
  margin: '0 0 4px 0',
}

const signature = {
  fontSize: '14px',
  color: '#525f7f',
  marginTop: '32px',
}

const customMessageBox = {
  backgroundColor: '#eff6ff',
  borderLeft: '4px solid #3b82f6',
  borderRadius: '4px',
  padding: '12px 16px',
  margin: '16px 0',
}

const customMessageText = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#1e40af',
  margin: '0',
}

export default RequestReceivedEmail
