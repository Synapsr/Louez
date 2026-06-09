import { Button, Heading, Section, Text } from '@react-email/components'
import { BaseLayout } from './base-layout'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getEmailTranslations, type EmailLocale } from '../i18n'

export interface DigestEntry {
  number: string
  customerName: string
  timeLabel: string
}

interface ReminderDigestAdminEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  storeEmail?: string | null
  storePhone?: string | null
  dateLabel: string
  pickups: DigestEntry[]
  returns: DigestEntry[]
  dashboardUrl: string
  locale?: EmailLocale
}

export function ReminderDigestAdminEmail({
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeAddress,
  storeEmail,
  storePhone,
  dateLabel,
  pickups,
  returns,
  dashboardUrl,
  locale = 'fr',
}: ReminderDigestAdminEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.reminderDigestAdmin

  const buttonStyle = {
    ...button,
    backgroundColor: primaryColor,
    color: getContrastColorHex(primaryColor),
  }

  return (
    <BaseLayout
      preview={messages.subject.replace('{date}', dateLabel)}
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <Heading style={heading}>{messages.title}</Heading>

      <Text style={paragraph}>
        {messages.body.replace('{storeName}', storeName)}
      </Text>
      <Text style={dateText}>{dateLabel}</Text>

      {pickups.length > 0 && (
        <Section style={pickupBox}>
          <Text style={pickupTitle}>
            {messages.pickupsTitle.replace('{count}', String(pickups.length))}
          </Text>
          {pickups.map((entry) => (
            <Text key={`pickup-${entry.number}`} style={entryRow}>
              <strong>{entry.timeLabel}</strong> · #{entry.number} · {entry.customerName}
            </Text>
          ))}
        </Section>
      )}

      {returns.length > 0 && (
        <Section style={returnBox}>
          <Text style={returnTitle}>
            {messages.returnsTitle.replace('{count}', String(returns.length))}
          </Text>
          {returns.map((entry) => (
            <Text key={`return-${entry.number}`} style={entryRow}>
              <strong>{entry.timeLabel}</strong> · #{entry.number} · {entry.customerName}
            </Text>
          ))}
        </Section>
      )}

      <Section style={ctaSection}>
        <Button href={dashboardUrl} style={buttonStyle}>
          {messages.viewCalendar}
        </Button>
      </Section>

      <Text style={footerNote}>{messages.connectToManage}</Text>
    </BaseLayout>
  )
}

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  marginBottom: '16px',
}

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#525f7f',
  margin: '0 0 4px 0',
}

const dateText = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  margin: '0 0 16px 0',
}

const pickupBox = {
  backgroundColor: '#eff6ff',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '16px 0',
}

const pickupTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#3b82f6',
  margin: '0 0 8px 0',
}

const returnBox = {
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '16px 0',
}

const returnTitle = {
  fontSize: '12px',
  fontWeight: 'bold' as const,
  textTransform: 'uppercase' as const,
  color: '#d97706',
  margin: '0 0 8px 0',
}

const entryRow = {
  fontSize: '14px',
  color: '#1a1a1a',
  margin: '0 0 6px 0',
}

const ctaSection = {
  textAlign: 'center' as const,
  marginTop: '28px',
  marginBottom: '28px',
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
  textAlign: 'center' as const,
}

export default ReminderDigestAdminEmail
