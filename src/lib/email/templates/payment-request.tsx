import {
  Button,
  Column,
  Heading,
  Hr,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getCurrencyFormatter, type EmailLocale } from '../i18n'

interface PaymentRequestEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  amount: number
  description: string
  paymentUrl: string
  customMessage?: string
  locale?: EmailLocale
  currency?: string
}

export function PaymentRequestEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  amount,
  description,
  paymentUrl,
  customMessage,
  locale = 'fr',
  currency = 'EUR',
}: PaymentRequestEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.paymentRequest
  const tc = t.common
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
        {messages.body
          .replace('{storeName}', storeName)
          .replace('{amount}', formatCurrency(amount))
          .replace('{number}', reservationNumber)}
      </Text>

      {/* Payment details */}
      <Section style={boxSection}>
        <Text style={sectionTitle}>{messages.paymentDetails}</Text>

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.reservation}</Text>
          </Column>
          <Column align="right">
            <Text style={detailValue}>#{reservationNumber}</Text>
          </Column>
        </Row>

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.description}</Text>
          </Column>
          <Column align="right">
            <Text style={detailValue}>{description}</Text>
          </Column>
        </Row>

        <Hr style={hrInner} />

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{messages.amountDue}</Text>
          </Column>
          <Column align="right">
            <Text style={amountValue}>{formatCurrency(amount)}</Text>
          </Column>
        </Row>
      </Section>

      {/* Custom message from store owner */}
      {customMessage && (
        <>
          <Section style={customMessageSection}>
            <Text style={customMessageText}>{customMessage}</Text>
          </Section>
          <Hr style={hr} />
        </>
      )}

      {/* CTA */}
      <Section style={ctaSection}>
        <Button href={paymentUrl} style={buttonStyle}>
          {messages.payNow.replace('{amount}', formatCurrency(amount))}
        </Button>
      </Section>

      <Text style={fallbackText}>
        {messages.linkFallback}
      </Text>
      <Text style={linkText}>{paymentUrl}</Text>

      <Hr style={hr} />

      <Text style={footerNote}>
        {messages.securePayment}
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

const amountValue = {
  fontSize: '18px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  margin: '0',
}

const hrInner = {
  borderColor: '#e6ebf1',
  margin: '12px 0',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
}

const customMessageSection = {
  backgroundColor: '#fffbeb',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '24px',
  borderLeft: '4px solid #f59e0b',
}

const customMessageText = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#78350f',
  margin: '0',
  fontStyle: 'italic' as const,
}

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '16px',
}

const button = {
  backgroundColor: '#0066FF',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
}

const fallbackText = {
  fontSize: '12px',
  color: '#8898aa',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
}

const linkText = {
  fontSize: '11px',
  color: '#8898aa',
  textAlign: 'center' as const,
  wordBreak: 'break-all' as const,
  margin: '0',
}

const footerNote = {
  fontSize: '13px',
  color: '#8898aa',
  fontStyle: 'italic' as const,
  textAlign: 'center' as const,
}

export default PaymentRequestEmail
