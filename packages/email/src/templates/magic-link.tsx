import {
  Button,
  Heading,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayoutSimple } from './base-layout-simple'
import type { EmailLocale } from '../types'

const translations: Record<string, { subject: string; title: string; greeting: string; body: string; button: string; expiry: string; alternative: string }> = {
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
  de: {
    subject: 'Anmeldung bei Ihrem Louez-Konto',
    title: 'Anmeldung bei Ihrem Konto',
    greeting: 'Hallo,',
    body: 'Klicken Sie auf die Schaltfläche unten, um sich bei Ihrem Louez-Konto anzumelden. Dieser Link ist 24 Stunden gültig.',
    button: 'Anmelden',
    expiry: 'Wenn Sie diese Anmeldung nicht angefordert haben, können Sie diese E-Mail ignorieren.',
    alternative: 'Oder kopieren Sie diesen Link in Ihren Browser:',
  },
  es: {
    subject: 'Iniciar sesion en su cuenta Louez',
    title: 'Iniciar sesion en su cuenta',
    greeting: 'Hola,',
    body: 'Haga clic en el boton de abajo para iniciar sesion en su cuenta Louez. Este enlace es valido durante 24 horas.',
    button: 'Iniciar sesion',
    expiry: 'Si no solicito este inicio de sesion, puede ignorar este correo.',
    alternative: 'O copie y pegue este enlace en su navegador:',
  },
  it: {
    subject: 'Accedi al tuo account Louez',
    title: 'Accedi al tuo account',
    greeting: 'Ciao,',
    body: 'Clicca il pulsante qui sotto per accedere al tuo account Louez. Questo link è valido per 24 ore.',
    button: 'Accedi',
    expiry: 'Se non hai richiesto questo accesso, puoi ignorare questa email.',
    alternative: 'Oppure copia e incolla questo link nel tuo browser:',
  },
  nl: {
    subject: 'Inloggen op uw Louez-account',
    title: 'Inloggen op uw account',
    greeting: 'Hallo,',
    body: 'Klik op de onderstaande knop om in te loggen op uw Louez-account. Deze link is 24 uur geldig.',
    button: 'Inloggen',
    expiry: 'Als u deze aanmelding niet heeft aangevraagd, kunt u deze e-mail negeren.',
    alternative: 'Of kopieer en plak deze link in uw browser:',
  },
  pl: {
    subject: 'Zaloguj sie do konta Louez',
    title: 'Zaloguj sie do konta',
    greeting: 'Czesc,',
    body: 'Kliknij ponizszy przycisk, aby zalogowac sie do konta Louez. Ten link jest wazny przez 24 godziny.',
    button: 'Zaloguj sie',
    expiry: 'Jesli nie prosiles o to logowanie, mozesz zignorowac ten e-mail.',
    alternative: 'Lub skopiuj i wklej ten link do przegladarki:',
  },
  pt: {
    subject: 'Entrar na sua conta Louez',
    title: 'Entrar na sua conta',
    greeting: 'Ola,',
    body: 'Clique no botao abaixo para entrar na sua conta Louez. Este link é valido por 24 horas.',
    button: 'Entrar',
    expiry: 'Se voce nao solicitou este login, pode ignorar este email.',
    alternative: 'Ou copie e cole este link no seu navegador:',
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
