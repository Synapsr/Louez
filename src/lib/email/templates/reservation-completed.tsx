import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, getCurrencyFormatter, type EmailLocale } from '../i18n'

interface ReservationCompletedEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  depositAmount?: number | null
  depositReturned?: boolean
  storefrontUrl?: string
  locale?: EmailLocale
  currency?: string
}

export function ReservationCompletedEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  depositAmount,
  depositReturned = false,
  storefrontUrl,
  locale = 'fr',
  currency = 'EUR',
}: ReservationCompletedEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.reservationCompleted
  const tc = t.common
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
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>{tc.greeting.replace('{name}', customerFirstName)}</Text>

      <Text style={paragraph}>
        {messages.body.replace('{number}', reservationNumber)}
      </Text>

      {/* Rental period recap */}
      <Section style={section}>
        <Text style={sectionTitle}>{messages.rentalPeriod}</Text>
        <Text style={paragraph}>
          {tc.periodFrom.replace('{startDate}', format(startDate, datePatterns.full, { locale: dateLocale }))}
          <br />
          {tc.periodTo.replace('{endDate}', format(endDate, datePatterns.full, { locale: dateLocale }))}
        </Text>
      </Section>

      {/* Deposit info if applicable */}
      {depositAmount && depositAmount > 0 && (
        <Section style={section}>
          <Text style={sectionTitle}>{tc.deposit}</Text>
          <Text style={paragraph}>
            {depositReturned
              ? messages.depositReturned.replace('{amount}', formatCurrency(depositAmount))
              : messages.depositPending.replace('{amount}', formatCurrency(depositAmount))}
          </Text>
        </Section>
      )}

      <Hr style={hr} />

      <Text style={paragraph}>
        {messages.thankYouMessage}
      </Text>

      {/* CTA to storefront */}
      {storefrontUrl && (
        <Section style={ctaSection}>
          <Button href={storefrontUrl} style={buttonStyle}>
            {messages.rentAgain}
          </Button>
        </Section>
      )}

      <Text style={footerNote}>
        {messages.seeYouSoon}
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

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
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
  fontStyle: 'italic' as const,
  textAlign: 'center' as const,
}

export default ReservationCompletedEmail
