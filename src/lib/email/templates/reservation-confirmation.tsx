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
import type { EmailCustomContent } from '@/types/store'

interface ReservationItem {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

interface ReservationConfirmationEmailProps {
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
  items: ReservationItem[]
  subtotal: number
  deposit: number
  total: number
  reservationUrl: string
  customContent?: EmailCustomContent
  locale?: EmailLocale
  currency?: string
}

export function ReservationConfirmationEmail({
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
  subtotal,
  deposit,
  total,
  reservationUrl,
  customContent,
  locale = 'fr',
  currency = 'EUR',
}: ReservationConfirmationEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.confirmReservation
  const tc = t.common
  const dateLocale = getDateLocale(locale)
  const datePatterns = getDateFormatPatterns(locale)
  const formatCurrency = getCurrencyFormatter(locale, currency)

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

      {/* Period */}
      <Section style={section}>
        <Text style={sectionTitle}>{tc.period}</Text>
        <Text style={paragraph}>
          {tc.periodFrom.replace('{startDate}', format(startDate, datePatterns.full, { locale: dateLocale }))}
          <br />
          {tc.periodTo.replace('{endDate}', format(endDate, datePatterns.full, { locale: dateLocale }))}
        </Text>
      </Section>

      {/* Pickup Address */}
      {storeAddress && (
        <Section style={section}>
          <Text style={sectionTitle}>{tc.pickupAddress}</Text>
          <Text style={paragraph}>
            {storeName}
            <br />
            {storeAddress}
          </Text>
        </Section>
      )}

      <Hr style={hr} />

      {/* Items */}
      <Section>
        <Text style={sectionTitle}>{messages.summary}</Text>
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
            <Text style={paragraph}>{tc.subtotal}</Text>
          </Column>
          <Column align="right">
            <Text style={paragraph}>{formatCurrency(subtotal)}</Text>
          </Column>
        </Row>
        {deposit > 0 && (
          <Row style={tableRow}>
            <Column>
              <Text style={paragraph}>{tc.deposit}</Text>
            </Column>
            <Column align="right">
              <Text style={paragraph}>{formatCurrency(deposit)}</Text>
            </Column>
          </Row>
        )}
        <Row style={tableRow}>
          <Column>
            <Text style={paragraphBold}>{tc.total}</Text>
          </Column>
          <Column align="right">
            <Text style={paragraphBold}>{formatCurrency(total)}</Text>
          </Column>
        </Row>
      </Section>

      {/* CTA */}
      <Section style={ctaSection}>
        <Button href={reservationUrl} style={buttonStyle}>
          {tc.viewReservation}
        </Button>
      </Section>
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

export default ReservationConfirmationEmail
