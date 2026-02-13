import {
  Button,
  Heading,
  Section,
  Text,
} from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, type EmailLocale } from '../i18n'

interface TeamInvitationEmailProps {
  storeName: string
  storeLogoUrl?: string | null
  primaryColor?: string
  inviterName: string
  invitationUrl: string
  locale?: EmailLocale
}

export function TeamInvitationEmail({
  storeName,
  storeLogoUrl,
  primaryColor = '#0066FF',
  inviterName,
  invitationUrl,
  locale = 'fr',
}: TeamInvitationEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.teamInvitation

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  return (
    <BaseLayout
      preview={messages.subject.replace('{inviterName}', inviterName).replace('{storeName}', storeName)}
      storeName={storeName}
      logoUrl={storeLogoUrl}
      primaryColor={primaryColor}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>{messages.greeting}</Text>

      <Text style={paragraph}>
        <strong>{inviterName}</strong>{' '}
        {messages.body.replace('{inviterName}', '').replace('{storeName}', storeName).trim()}
      </Text>

      <Text style={paragraph}>
        {messages.accessDescription}
      </Text>

      <Section style={ctaSection}>
        <Button href={invitationUrl} style={buttonStyle}>
          {messages.acceptButton}
        </Button>
      </Section>

      <Text style={footerNote}>
        {messages.expiry}
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
  margin: '0 0 16px 0',
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

export default TeamInvitationEmail
