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
import {
  getEmailTranslations,
  getDateLocale,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from '../i18n'

interface InstantAccessItem {
  name: string
  quantity: number
  totalPrice: number
}

interface InstantAccessEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storePhone?: string | null
  storeEmail?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  items: InstantAccessItem[]
  totalAmount: number
  accessUrl: string
  showPaymentCta: boolean
  locale?: EmailLocale
  currency?: string
}

export function InstantAccessEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storePhone,
  storeEmail,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  items,
  totalAmount,
  accessUrl,
  showPaymentCta,
  locale = 'fr',
  currency = 'EUR',
}: InstantAccessEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.instantAccess
  const tc = t.common
  const dateLocale = getDateLocale(locale)
  const datePatterns = getDateFormatPatterns(locale)
  const formatCurrency = getCurrencyFormatter(locale, currency)

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  const greeting = tc.greeting.replace('{name}', customerFirstName)

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

      <Text style={paragraph}>{greeting}</Text>

      <Text style={paragraph}>
        {messages.body.replace('{number}', reservationNumber)}
      </Text>

      {/* Period */}
      <Section style={section}>
        <Text style={sectionTitle}>{tc.period}</Text>
        <Text style={paragraph}>
          {tc.periodFrom.replace(
            '{startDate}',
            format(startDate, datePatterns.full, { locale: dateLocale })
          )}
          <br />
          {tc.periodTo.replace(
            '{endDate}',
            format(endDate, datePatterns.full, { locale: dateLocale })
          )}
        </Text>
      </Section>

      <Hr style={hr} />

      {/* Items */}
      <Section>
        <Text style={sectionTitle}>{tc.summary}</Text>
        {items.map((item, index) => (
          <Row key={index} style={tableRow}>
            <Column>
              <Text style={paragraph}>
                {item.name} x {item.quantity}
              </Text>
            </Column>
            <Column align="right">
              <Text style={paragraph}>{formatCurrency(item.totalPrice)}</Text>
            </Column>
          </Row>
        ))}
        <Hr style={hr} />
        <Row style={tableRow}>
          <Column>
            <Text style={paragraphBold}>{tc.total}</Text>
          </Column>
          <Column align="right">
            <Text style={paragraphBold}>{formatCurrency(totalAmount)}</Text>
          </Column>
        </Row>
      </Section>

      {/* Payment notice if unpaid */}
      {showPaymentCta && (
        <Section style={paymentNotice}>
          <Text style={paymentNoticeText}>{messages.paymentPending}</Text>
        </Section>
      )}

      {/* CTA Button */}
      <Section style={ctaSection}>
        <Button href={accessUrl} style={buttonStyle}>
          {showPaymentCta ? messages.viewAndPay : tc.viewReservation}
        </Button>
      </Section>

      <Text style={footerNote}>{messages.linkValid}</Text>
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

const paragraphBold = {
  ...paragraph,
  fontWeight: 'bold' as const,
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

const tableRow = {
  marginBottom: '8px',
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

const paymentNotice = {
  backgroundColor: '#FEF3CD',
  borderRadius: '6px',
  padding: '12px 16px',
  marginTop: '16px',
}

const paymentNoticeText = {
  fontSize: '13px',
  color: '#856404',
  margin: '0',
  textAlign: 'center' as const,
}

const footerNote = {
  fontSize: '12px',
  color: '#8898aa',
  textAlign: 'center' as const,
  marginTop: '24px',
}

export default InstantAccessEmail
