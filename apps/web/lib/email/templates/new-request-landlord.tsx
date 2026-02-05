import { Button, Heading, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, getCurrencyFormatter, type EmailLocale } from '../i18n'

interface NewRequestLandlordEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  total: number
  dashboardUrl: string
  locale?: EmailLocale
  currency?: string
}

export function NewRequestLandlordEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  customerFirstName,
  customerLastName,
  customerEmail,
  reservationNumber,
  startDate,
  endDate,
  total,
  dashboardUrl,
  locale = 'fr',
  currency = 'EUR',
}: NewRequestLandlordEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.newRequestLandlord
  const dateLocale = getDateLocale(locale)
  const datePatterns = getDateFormatPatterns(locale)
  const formatCurrency = getCurrencyFormatter(locale, currency)

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  return (
    <BaseLayout
      preview={messages.subject.replace('{number}', reservationNumber)}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>
        {messages.body.replace('{storeName}', storeName)}
      </Text>

      <Section style={infoBox}>
        <Text style={infoRow}>
          <strong>{messages.customer}</strong> {customerFirstName} {customerLastName}
        </Text>
        <Text style={infoRow}>
          <strong>{messages.email}</strong> {customerEmail}
        </Text>
        <Text style={infoRow}>
          <strong>{messages.period}</strong>{' '}
          {format(startDate, datePatterns.short, { locale: dateLocale })} -{' '}
          {format(endDate, datePatterns.short, { locale: dateLocale })}
        </Text>
        <Text style={infoRow}>
          <strong>{messages.amount}</strong> {formatCurrency(total)}
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button href={dashboardUrl} style={buttonStyle}>
          {messages.viewRequest}
        </Button>
      </Section>

      <Text style={footerNote}>
        {messages.connectToManage}
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
  padding: '20px',
  margin: '24px 0',
}

const infoRow = {
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

export default NewRequestLandlordEmail
