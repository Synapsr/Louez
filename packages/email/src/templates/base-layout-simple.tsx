import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Link,
} from '@react-email/components'
import type { EmailLocale } from '../types'

const translations: Record<string, { sentBy: string; ignoreIfNotYou: string; poweredBy: string }> = {
  fr: {
    sentBy: 'Cet email a été envoyé par Louez',
    ignoreIfNotYou: 'Si vous n\'êtes pas à l\'origine de cette action, veuillez ignorer cet email.',
    poweredBy: 'Propulsé par',
  },
  en: {
    sentBy: 'This email was sent by Louez',
    ignoreIfNotYou: 'If you didn\'t initiate this action, please ignore this email.',
    poweredBy: 'Powered by',
  },
  de: {
    sentBy: 'Diese E-Mail wurde von Louez gesendet',
    ignoreIfNotYou: 'Wenn Sie diese Aktion nicht initiiert haben, ignorieren Sie bitte diese E-Mail.',
    poweredBy: 'Bereitgestellt von',
  },
  es: {
    sentBy: 'Este correo fue enviado por Louez',
    ignoreIfNotYou: 'Si no inicio esta accion, ignore este correo.',
    poweredBy: 'Desarrollado por',
  },
  it: {
    sentBy: 'Questa email è stata inviata da Louez',
    ignoreIfNotYou: 'Se non hai avviato questa azione, ignora questa email.',
    poweredBy: 'Powered by',
  },
  nl: {
    sentBy: 'Deze e-mail is verzonden door Louez',
    ignoreIfNotYou: 'Als u deze actie niet heeft gestart, negeer deze e-mail dan.',
    poweredBy: 'Powered by',
  },
  pl: {
    sentBy: 'Ten e-mail zostal wyslany przez Louez',
    ignoreIfNotYou: 'Jesli nie zainicjowales tej akcji, zignoruj ten e-mail.',
    poweredBy: 'Powered by',
  },
  pt: {
    sentBy: 'Este email foi enviado por Louez',
    ignoreIfNotYou: 'Se voce nao iniciou esta acao, ignore este email.',
    poweredBy: 'Powered by',
  },
}

interface BaseLayoutSimpleProps {
  preview: string
  locale?: EmailLocale
  children: React.ReactNode
}

export function BaseLayoutSimple({
  preview,
  locale = 'fr',
  children,
}: BaseLayoutSimpleProps) {
  const t = translations[locale] || translations.fr

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Louez branding */}
          <Section style={header}>
            <Text style={logoText}>Louez</Text>
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={hr} />

            <Text style={footerText}>{t.sentBy}</Text>
            <Text style={footerText}>{t.ignoreIfNotYou}</Text>

            {/* Powered by */}
            <Text style={poweredBy}>
              {t.poweredBy}{' '}
              <Link href="https://louez.io" style={poweredByLink}>
                Louez.io
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  marginTop: '40px',
  marginBottom: '40px',
  maxWidth: '600px',
  borderRadius: '8px',
  overflow: 'hidden' as const,
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
}

const header = {
  padding: '32px 48px',
  backgroundColor: '#fafafa',
  textAlign: 'center' as const,
  borderBottom: '3px solid #1f54dd',
}

const logoText = {
  fontSize: '28px',
  fontWeight: 'bold' as const,
  margin: '0',
  textAlign: 'center' as const,
  color: '#1f54dd',
}

const content = {
  padding: '40px 48px',
}

const footer = {
  padding: '32px 48px',
  backgroundColor: '#fafafa',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '0 0 24px 0',
}

const footerText = {
  fontSize: '12px',
  color: '#8898aa',
  margin: '0 0 4px 0',
  textAlign: 'center' as const,
}

const poweredBy = {
  fontSize: '11px',
  color: '#8898aa',
  margin: '16px 0 0 0',
  textAlign: 'center' as const,
}

const poweredByLink = {
  color: '#1f54dd',
  textDecoration: 'none' as const,
  fontWeight: 'bold' as const,
}
