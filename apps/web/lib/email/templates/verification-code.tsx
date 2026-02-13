import { Heading, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getEmailTranslations, type EmailLocale } from '../i18n'

interface VerificationCodeEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  code: string
  locale?: EmailLocale
}

export function VerificationCodeEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeEmail,
  storePhone,
  code,
  locale = 'fr',
}: VerificationCodeEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.verificationCode

  return (
    <BaseLayout
      preview={messages.subject.replace('{code}', code)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>
        {messages.body.replace('{storeName}', storeName)}
      </Text>

      <Section style={codeContainer}>
        <Text style={codeText}>{code}</Text>
      </Section>

      <Text style={paragraph}>
        {messages.expiry}
      </Text>
    </BaseLayout>
  )
}

const heading = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1a1a1a',
  marginBottom: '24px',
}

const paragraph = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#525f7f',
}

const codeContainer = {
  backgroundColor: '#f4f4f5',
  borderRadius: '8px',
  padding: '24px',
  textAlign: 'center' as const,
  margin: '24px 0',
}

const codeText = {
  fontSize: '32px',
  fontWeight: 'bold',
  letterSpacing: '4px',
  color: '#1a1a1a',
  margin: '0',
}

export default VerificationCodeEmail
