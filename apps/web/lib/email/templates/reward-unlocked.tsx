import { Button, Heading, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, type EmailLocale } from '../i18n'

interface RewardUnlockedEmailProps {
  storeName: string
  storeLogoUrl?: string | null
  primaryColor?: string
  referredStoreName: string
  freeReservations: number
  rewardValue: string
  ctaUrl: string
  locale?: EmailLocale
}

export function RewardUnlockedEmail({
  storeName,
  storeLogoUrl,
  primaryColor = '#0066FF',
  referredStoreName,
  freeReservations,
  rewardValue,
  ctaUrl,
  locale = 'fr',
}: RewardUnlockedEmailProps) {
  const messages = getEmailTranslations(locale).rewardUnlocked

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  const body = messages.body
    .replace('{referredStoreName}', referredStoreName)
    .replace('{freeReservations}', String(freeReservations))
    .replace('{rewardValue}', rewardValue)

  return (
    <BaseLayout
      preview={messages.subject}
      storeName={storeName}
      logoUrl={storeLogoUrl}
      primaryColor={primaryColor}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>{messages.greeting}</Text>

      <Text style={paragraph}>{body}</Text>

      <Section style={ctaSection}>
        <Button href={ctaUrl} style={buttonStyle}>
          {messages.cta}
        </Button>
      </Section>

      <Text style={footerNote}>{messages.footer}</Text>
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

export default RewardUnlockedEmail
