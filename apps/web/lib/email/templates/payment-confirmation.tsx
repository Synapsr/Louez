import {
  Button,
  Column,
  Heading,
  Hr,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { format } from 'date-fns'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getDateLocale, getDateFormatPatterns, getCurrencyFormatter, type EmailLocale } from '../i18n'

interface PaymentConfirmationEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  paymentAmount: number
  paymentDate: Date
  paymentMethod?: string | null
  reservationUrl?: string
  locale?: EmailLocale
  currency?: string
}

export function PaymentConfirmationEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  paymentAmount,
  paymentDate,
  paymentMethod,
  reservationUrl,
  locale = 'fr',
  currency = 'EUR',
}: PaymentConfirmationEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.paymentConfirmation
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

      {/* Payment details */}
      <Section style={boxSection}>
        <Text style={sectionTitle}>{messages.paymentDetails}</Text>

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.amount}</Text>
          </Column>
          <Column align="right">
            <Text style={detailValue}>{formatCurrency(paymentAmount)}</Text>
          </Column>
        </Row>

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.date}</Text>
          </Column>
          <Column align="right">
            <Text style={detailValue}>
              {format(paymentDate, datePatterns.dateTime, { locale: dateLocale })}
            </Text>
          </Column>
        </Row>

        {paymentMethod && (
          <Row style={detailRow}>
            <Column>
              <Text style={detailLabel}>{messages.method}</Text>
            </Column>
            <Column align="right">
              <Text style={detailValue}>{paymentMethod}</Text>
            </Column>
          </Row>
        )}

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.reservation}</Text>
          </Column>
          <Column align="right">
            <Text style={detailValue}>#{reservationNumber}</Text>
          </Column>
        </Row>
      </Section>

      <Hr style={hr} />

      <Text style={paragraph}>
        {messages.confirmation}
      </Text>

      {/* CTA */}
      {reservationUrl && (
        <Section style={ctaSection}>
          <Button href={reservationUrl} style={buttonStyle}>
            {tc.viewReservation}
          </Button>
        </Section>
      )}

      <Text style={footerNote}>
        {messages.keepEmail}
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

const boxSection = {
  backgroundColor: '#f8fafc',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
}

const sectionTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#8898aa',
  marginBottom: '16px',
}

const detailRow = {
  marginBottom: '8px',
}

const detailLabel = {
  fontSize: '14px',
  color: '#525f7f',
  margin: '0',
}

const detailValue = {
  fontSize: '14px',
  fontWeight: '600' as const,
  color: '#1a1a1a',
  margin: '0',
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

export default PaymentConfirmationEmail
