import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
  Hr,
  Link,
} from '@react-email/components'
import { getEmailTranslations, type EmailLocale } from '../i18n'

interface BaseLayoutProps {
  preview: string
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeEmail?: string | null
  storePhone?: string | null
  storeAddress?: string | null
  locale?: EmailLocale
  children: React.ReactNode
}

export function BaseLayout({
  preview,
  storeName,
  logoUrl,
  primaryColor = '#0066FF',
  storeEmail,
  storePhone,
  storeAddress,
  locale = 'fr',
  children,
}: BaseLayoutProps) {
  const t = getEmailTranslations(locale)
  const baseLayout = t.baseLayout

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with primary color accent */}
          <Section
            style={{
              ...header,
              borderBottom: `3px solid ${primaryColor}`,
            }}
          >
            {logoUrl ? (
              <Img
                src={logoUrl}
                alt={storeName}
                height={48}
                style={{ display: 'block', margin: '0 auto' }}
              />
            ) : (
              <Text style={{ ...logoText, color: primaryColor }}>{storeName}</Text>
            )}
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={hr} />

            {/* Store info */}
            <Text style={footerStoreName}>{storeName}</Text>

            {(storeAddress || storeEmail || storePhone) && (
              <div style={footerContactContainer}>
                {storeAddress && (
                  <Text style={footerContactText}>{storeAddress}</Text>
                )}
                {storeEmail && (
                  <Text style={footerContactText}>
                    <Link href={`mailto:${storeEmail}`} style={footerLink}>
                      {storeEmail}
                    </Link>
                  </Text>
                )}
                {storePhone && (
                  <Text style={footerContactText}>
                    <Link href={`tel:${storePhone}`} style={footerLink}>
                      {storePhone}
                    </Link>
                  </Text>
                )}
              </div>
            )}

            <Hr style={hrLight} />

            <Text style={footerText}>
              {baseLayout.sentBy.replace('{storeName}', storeName)}
            </Text>
            <Text style={footerText}>
              {baseLayout.ignoreIfNotYou}
            </Text>

            {/* Powered by */}
            <Text style={poweredBy}>
              {baseLayout.poweredBy}{' '}
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
}

const logoText = {
  fontSize: '28px',
  fontWeight: 'bold' as const,
  margin: '0',
  textAlign: 'center' as const,
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

const hrLight = {
  borderColor: '#e6ebf1',
  margin: '24px 0',
}

const footerStoreName = {
  fontSize: '16px',
  fontWeight: 'bold' as const,
  color: '#1a1a1a',
  margin: '0 0 8px 0',
  textAlign: 'center' as const,
}

const footerContactContainer = {
  textAlign: 'center' as const,
  marginBottom: '16px',
}

const footerContactText = {
  fontSize: '13px',
  color: '#525f7f',
  margin: '0 0 4px 0',
  textAlign: 'center' as const,
}

const footerLink = {
  color: '#525f7f',
  textDecoration: 'none' as const,
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
  color: '#0066FF',
  textDecoration: 'none' as const,
  fontWeight: 'bold' as const,
}
