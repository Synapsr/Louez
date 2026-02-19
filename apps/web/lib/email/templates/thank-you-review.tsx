import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateFormatPatterns, type EmailLocale } from '../i18n'
import {
  formatEmailDateInStoreTimezone,
  getStoreTimezoneLabel,
} from '../date-time'

interface ThankYouReviewEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  storeTimezone?: string | null
  storeCountry?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  reviewUrl: string
  locale?: EmailLocale
}

export function ThankYouReviewEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  reviewUrl,
  locale = 'fr',
}: ThankYouReviewEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.thankYouReview
  const tc = t.common
  const datePatterns = getDateFormatPatterns(locale)
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry)
  const timezoneLine =
    typeof tc.timezone === 'string'
      ? tc.timezone.replace('{timezone}', timezoneLabel)
      : `Timezone: ${timezoneLabel}`

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  const greeting = tc.greeting.replace('{name}', customerFirstName)

  return (
    <BaseLayout
      preview={messages.subject}
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

      {/* Reservation Summary */}
      <Section style={section}>
        <Text style={sectionTitle}>{tc.summary}</Text>
        <Text style={paragraph}>
          {tc.reservationNumber.replace('{number}', reservationNumber)}
          <br />
          {tc.periodFrom.replace(
            '{startDate}',
            formatEmailDateInStoreTimezone(
              startDate,
              locale,
              datePatterns.short,
              storeTimezone,
              storeCountry
            )
          )}
          {' - '}
          {formatEmailDateInStoreTimezone(
            endDate,
            locale,
            datePatterns.short,
            storeTimezone,
            storeCountry
          )}
        </Text>
        <Text style={timezoneText}>{timezoneLine}</Text>
      </Section>

      <Hr style={hr} />

      {/* Review CTA */}
      <Section style={ctaSection}>
        <Button href={reviewUrl} style={buttonStyle}>
          {messages.cta}
        </Button>
      </Section>

      <Text style={footerNote}>
        {messages.disclaimer}
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
  margin: '0 0 10px 0',
}

const section = {
  marginBottom: '24px',
}

const sectionTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#8898aa',
  marginBottom: '8px',
}

const timezoneText = {
  fontSize: '12px',
  lineHeight: '18px',
  color: '#8898aa',
  margin: '4px 0 0 0',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
}

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '32px',
  padding: '24px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
}

const ctaText = {
  fontSize: '15px',
  color: '#1a1a1a',
  marginBottom: '16px',
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

const footerNote = {
  fontSize: '13px',
  color: '#8898aa',
  fontStyle: 'italic' as const,
  textAlign: 'center' as const,
}

export default ThankYouReviewEmail
