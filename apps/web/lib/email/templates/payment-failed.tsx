import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, getCurrencyFormatter, type EmailLocale } from '../i18n'

interface PaymentFailedEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  paymentAmount: number
  errorMessage?: string | null
  paymentUrl?: string
  locale?: EmailLocale
  currency?: string
}

export function PaymentFailedEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  paymentAmount,
  errorMessage,
  paymentUrl,
  locale = 'fr',
  currency = 'EUR',
}: PaymentFailedEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.paymentFailed
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
          .replace('{number}', reservationNumber)
          .replace('{amount}', formatCurrency(paymentAmount))}
      </Text>

      {/* Error info if provided */}
      {errorMessage && (
        <Section style={errorSection}>
          <Text style={errorText}>{errorMessage}</Text>
        </Section>
      )}

      <Hr style={hr} />

      <Text style={paragraph}>
        {messages.whatToDo}
      </Text>

      <Section style={listSection}>
        <Text style={listItem}>• {messages.tip1}</Text>
        <Text style={listItem}>• {messages.tip2}</Text>
        <Text style={listItem}>• {messages.tip3}</Text>
      </Section>

      {/* CTA */}
      {paymentUrl && (
        <Section style={ctaSection}>
          <Button href={paymentUrl} style={buttonStyle}>
            {messages.retryPayment}
          </Button>
        </Section>
      )}

      <Text style={footerNote}>
        {messages.contactSupport}
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

const errorSection = {
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '16px',
  marginTop: '16px',
  marginBottom: '16px',
}

const errorText = {
  fontSize: '14px',
  color: '#dc2626',
  margin: '0',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
}

const listSection = {
  marginBottom: '24px',
}

const listItem = {
  fontSize: '14px',
  lineHeight: '28px',
  color: '#525f7f',
  margin: '0',
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

export default PaymentFailedEmail
