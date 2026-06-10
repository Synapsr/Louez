import { Button, Heading, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateFormatPatterns, getCurrencyFormatter, type EmailLocale } from '../i18n'
import {
  formatEmailDateInStoreTimezone,
  getStoreTimezoneLabel,
} from '../date-time'

interface ReminderPickupAdminEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  storeTimezone?: string | null
  storeCountry?: string | null
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhone?: string | null
  reservationNumber: string
  startDate: Date
  total: number
  dashboardUrl: string
  currency?: string
  locale?: EmailLocale
}

export function ReminderPickupAdminEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  storeTimezone,
  storeCountry,
  customerFirstName,
  customerLastName,
  customerEmail,
  customerPhone,
  reservationNumber,
  startDate,
  total,
  dashboardUrl,
  currency = 'EUR',
  locale = 'fr',
}: ReminderPickupAdminEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.reminderPickupAdmin
  const datePatterns = getDateFormatPatterns(locale)
  const formatCurrency = getCurrencyFormatter(locale, currency)
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry)
  const timezoneLine =
    typeof t.common.timezone === 'string'
      ? t.common.timezone.replace('{timezone}', timezoneLabel)
      : `Timezone: ${timezoneLabel}`

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  return (
    <BaseLayout
      preview={messages.subject.replace('{number}', reservationNumber)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>
        {messages.body.replace('{number}', reservationNumber)}
      </Text>

      <Section style={infoBox}>
        <Text style={infoTitle}>{messages.scheduledPickup}</Text>
        <Text style={infoDate}>
          {formatEmailDateInStoreTimezone(
            startDate,
            locale,
            datePatterns.full,
            storeTimezone,
            storeCountry
          )}
        </Text>
        <Text style={timezoneText}>{timezoneLine}</Text>
      </Section>

      <Section style={detailBox}>
        <Text style={detailRow}>
          <strong>{messages.customer}</strong> {customerFirstName} {customerLastName}
        </Text>
        <Text style={detailRow}>
          <strong>{messages.email}</strong> {customerEmail}
        </Text>
        {customerPhone && (
          <Text style={detailRow}>
            <strong>{messages.phone}</strong> {customerPhone}
          </Text>
        )}
        <Text style={detailRow}>
          <strong>{messages.amount}</strong> {formatCurrency(total)}
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button href={dashboardUrl} style={buttonStyle}>
          {messages.viewReservation}
        </Button>
      </Section>

      <Text style={footerNote}>{messages.connectToManage}</Text>
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
  marginTop: '0',
}

const infoDate = {
  fontSize: '18px',
  fontWeight: 'bold' as const,
  color: '#1e40af',
  margin: '0',
}

const timezoneText = {
  fontSize: '12px',
  color: '#3b82f6',
  margin: '6px 0 0 0',
}

const detailBox = {
  backgroundColor: '#f4f4f5',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
}

const detailRow = {
  fontSize: '14px',
  color: '#1a1a1a',
  margin: '0 0 8px 0',
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

const footerNote = {
  fontSize: '13px',
  color: '#8898aa',
  textAlign: 'center' as const,
}

export default ReminderPickupAdminEmail
