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

interface DepositAuthorizationRequestEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  customerFirstName: string
  reservationNumber: string
  depositAmount: number
  authorizationUrl: string
  customMessage?: string
  locale?: EmailLocale
  currency?: string
}

export function DepositAuthorizationRequestEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  customerFirstName,
  reservationNumber,
  depositAmount,
  authorizationUrl,
  customMessage,
  locale = 'fr',
  currency = 'EUR',
}: DepositAuthorizationRequestEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.depositAuthorizationRequest
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
          .replace('{amount}', formatCurrency(depositAmount))
          .replace('{number}', reservationNumber)}
      </Text>

      {/* Info box explaining deposit authorization */}
      <Section style={infoBox}>
        <Text style={infoTitle}>{messages.howItWorks}</Text>
        <Text style={infoText}>1. {messages.step1}</Text>
        <Text style={infoText}>2. {messages.step2}</Text>
        <Text style={infoText}>3. {messages.step3}</Text>
        <Text style={infoText}>4. {messages.step4}</Text>
      </Section>

      {/* Deposit details */}
      <Section style={boxSection}>
        <Text style={sectionTitle}>{tc.summary}</Text>

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{tc.reservationNumber.replace('{number}', reservationNumber)}</Text>
          </Column>
        </Row>

        <Hr style={hrInner} />

        <Row style={detailRow}>
          <Column>
            <Text style={detailLabel}>{tc.deposit}</Text>
          </Column>
          <Column align="right">
            <Text style={amountValue}>{formatCurrency(depositAmount)}</Text>
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
        <Button href={authorizationUrl} style={buttonStyle}>
          {messages.authorizeNow}
        </Button>
      </Section>

      <Text style={fallbackText}>
        {messages.linkFallback}
      </Text>
      <Text style={linkText}>{authorizationUrl}</Text>

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

const infoBox = {
  backgroundColor: '#eff6ff',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '24px',
  borderLeft: '4px solid #3b82f6',
}

const infoTitle = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#1e40af',
  margin: '0 0 8px 0',
}

const infoText = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#1e40af',
  margin: '0',
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

export default DepositAuthorizationRequestEmail
