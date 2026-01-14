import {
  Button,
  Heading,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayoutSimple } from './base-layout-simple'
import type { EmailLocale } from '../i18n'

const translations = {
  fr: {
    subject: 'Connexion à votre compte Louez',
    title: 'Connexion à votre compte',
    greeting: 'Bonjour,',
    body: 'Cliquez sur le bouton ci-dessous pour vous connecter à votre compte Louez. Ce lien est valide pendant 24 heures.',
    button: 'Se connecter',
    expiry: 'Si vous n\'avez pas demandé cette connexion, vous pouvez ignorer cet email en toute sécurité.',
    alternative: 'Ou copiez et collez ce lien dans votre navigateur :',
  },
  en: {
    subject: 'Sign in to your Louez account',
    title: 'Sign in to your account',
    greeting: 'Hello,',
    body: 'Click the button below to sign in to your Louez account. This link is valid for 24 hours.',
    button: 'Sign in',
    expiry: 'If you didn\'t request this sign-in, you can safely ignore this email.',
    alternative: 'Or copy and paste this link in your browser:',
  },
}

interface MagicLinkEmailProps {
  url: string
  locale?: EmailLocale
}

export function MagicLinkEmail({
  url,
  locale = 'fr',
}: MagicLinkEmailProps) {
  const t = translations[locale] || translations.fr

  return (
    <BaseLayoutSimple
      preview={t.subject}
      locale={locale}
    >
      <Heading style={heading}>{t.title}</Heading>

      <Text style={paragraph}>{t.greeting}</Text>

      <Text style={paragraph}>{t.body}</Text>

      <Section style={ctaSection}>
        <Button href={url} style={button}>
          {t.button}
        </Button>
      </Section>

      <Text style={footerNote}>{t.expiry}</Text>

      <Text style={linkSection}>{t.alternative}</Text>
      <Text style={urlText}>{url}</Text>
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

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '32px',
  marginBottom: '32px',
}

const button = {
  backgroundColor: '#1f54dd',
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
  marginTop: '24px',
}

const linkSection = {
  fontSize: '12px',
  color: '#8898aa',
  marginTop: '24px',
  marginBottom: '8px',
}

const urlText = {
  fontSize: '11px',
  color: '#525f7f',
  wordBreak: 'break-all' as const,
  backgroundColor: '#f4f4f5',
  padding: '12px',
  borderRadius: '4px',
}

export default MagicLinkEmail
