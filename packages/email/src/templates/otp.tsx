import {
  Heading,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayoutSimple } from './base-layout-simple'
import type { EmailLocale } from '../types'

const translations: Record<string, { subject: string; title: string; greeting: string; body: string; expiry: string }> = {
  fr: {
    subject: 'Code de connexion',
    title: 'Code de connexion',
    greeting: 'Bonjour,',
    body: 'Voici votre code de connexion à Louez. Ce code est valide pendant 5 minutes.',
    expiry: 'Si vous n\'avez pas demandé ce code, vous pouvez ignorer cet email en toute sécurité.',
  },
  en: {
    subject: 'Sign-in code',
    title: 'Sign-in code',
    greeting: 'Hello,',
    body: 'Here is your sign-in code for Louez. This code is valid for 5 minutes.',
    expiry: 'If you didn\'t request this code, you can safely ignore this email.',
  },
}

interface OTPEmailProps {
  otp: string
  locale?: EmailLocale
}

export function OTPEmail({
  otp,
  locale = 'fr',
}: OTPEmailProps) {
  const t = translations[locale] || translations.fr

  return (
    <BaseLayoutSimple
      preview={t.subject}
      locale={locale}
    >
      <Heading style={heading}>{t.title}</Heading>

      <Text style={paragraph}>{t.greeting}</Text>

      <Text style={paragraph}>{t.body}</Text>

      <Section style={otpSection}>
        <Text style={otpCode}>{otp}</Text>
      </Section>

      <Text style={footerNote}>{t.expiry}</Text>
    </BaseLayoutSimple>
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

const otpSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '32px',
}

const otpCode = {
  fontSize: '32px',
  fontWeight: 'bold' as const,
  fontFamily: 'monospace',
  color: '#1a1a1a',
  backgroundColor: '#f4f4f5',
  padding: '16px 32px',
  borderRadius: '8px',
  letterSpacing: '8px',
  display: 'inline-block',
  margin: 0,
}

const footerNote = {
  fontSize: '13px',
  color: '#8898aa',
  fontStyle: 'italic' as const,
  textAlign: 'center' as const,
  marginTop: '24px',
}

export default OTPEmail
