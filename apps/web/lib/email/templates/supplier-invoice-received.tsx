import { Section } from '@react-email/components'

import { BaseLayout } from './base-layout'
import { CtaButton, EmailHeading, EmailText, FooterNote, styles } from './components'
import { getCurrencyFormatter, getEmailTranslations, type EmailLocale } from '../i18n'

interface SupplierInvoiceReceivedEmailProps {
  storeName: string
  primaryColor?: string
  sellerName: string
  invoiceNumber: string
  totalInclTax: string
  currency: string
  dashboardUrl: string
  locale?: EmailLocale
}

export function SupplierInvoiceReceivedEmail({
  storeName,
  primaryColor,
  sellerName,
  invoiceNumber,
  totalInclTax,
  currency,
  dashboardUrl,
  locale = 'fr',
}: SupplierInvoiceReceivedEmailProps) {
  const messages = getEmailTranslations(locale).supplierInvoiceReceived
  const formatCurrency = getCurrencyFormatter(locale, currency)

  return (
    <BaseLayout
      preview={messages.subject}
      storeName="Louez.io"
      logoUrl={null}
      primaryColor={primaryColor}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{messages.body.replace('{storeName}', storeName)}</EmailText>

      <Section style={styles.card}>
        <EmailText style={{ margin: '0 0 8px 0' }}>
          <strong>{messages.seller}</strong> {sellerName}
        </EmailText>
        <EmailText style={{ margin: '0 0 8px 0' }}>
          <strong>{messages.number}</strong> {invoiceNumber}
        </EmailText>
        <EmailText style={{ margin: '0' }}>
          <strong>{messages.total}</strong> {formatCurrency(Number(totalInclTax))}
        </EmailText>
      </Section>

      <CtaButton href={dashboardUrl} label={messages.cta} primaryColor={primaryColor} />

      <FooterNote>{messages.footer}</FooterNote>
    </BaseLayout>
  )
}

export default SupplierInvoiceReceivedEmail
