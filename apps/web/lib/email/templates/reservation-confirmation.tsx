import { BaseLayout } from './base-layout'
import {
  CtaButton,
  EmailHeading,
  EmailText,
  InfoCard,
  InfoCardItem,
  ItemsTable,
  resolveCustomContent,
} from './components'
import {
  getEmailTranslations,
  getDateFormatPatterns,
  getCurrencyFormatter,
  type EmailLocale,
} from '../i18n'
import type { EmailCustomContent } from '@louez/types'
import type { ReservationLocationSnapshot } from '@louez/types'
import { formatEmailDateInStoreTimezone, getStoreTimezoneLabel } from '../date-time'

interface ReservationItem {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

interface ReservationConfirmationEmailProps {
  storeName: string
  logoUrl?: string | null
  primaryColor?: string
  storeAddress?: string | null
  pickupLocationSnapshot?: ReservationLocationSnapshot | null
  returnLocationSnapshot?: ReservationLocationSnapshot | null
  storePhone?: string | null
  storeEmail?: string | null
  storeTimezone?: string | null
  storeCountry?: string | null
  customerFirstName: string
  reservationNumber: string
  startDate: Date
  endDate: Date
  items: ReservationItem[]
  subtotal: number
  deposit: number
  total: number
  reservationUrl: string
  contractSignatureUrl?: string
  customContent?: EmailCustomContent
  locale?: EmailLocale
  currency?: string
  // Tax info
  taxEnabled?: boolean
  taxRate?: number | null
  subtotalExclTax?: number | null
  taxAmount?: number | null
}

export function ReservationConfirmationEmail({
  storeName,
  logoUrl,
  primaryColor,
  storeAddress,
  pickupLocationSnapshot,
  returnLocationSnapshot,
  storePhone,
  storeEmail,
  storeTimezone,
  storeCountry,
  customerFirstName,
  reservationNumber,
  startDate,
  endDate,
  items,
  subtotal,
  deposit,
  total,
  reservationUrl,
  contractSignatureUrl,
  customContent,
  locale = 'fr',
  currency = 'EUR',
  taxEnabled = false,
  taxRate,
  subtotalExclTax,
  taxAmount,
}: ReservationConfirmationEmailProps) {
  const t = getEmailTranslations(locale)
  const messages = t.confirmReservation
  const tc = t.common
  const datePatterns = getDateFormatPatterns(locale)
  const formatCurrency = getCurrencyFormatter(locale, currency)
  const timezoneLabel = getStoreTimezoneLabel(startDate, storeTimezone, storeCountry)
  const timezoneLine =
    typeof tc.timezone === 'string'
      ? tc.timezone.replace('{timezone}', timezoneLabel)
      : `Timezone: ${timezoneLabel}`
  const contractSignatureText =
    typeof messages.contractSignature === 'string'
      ? messages.contractSignature
      : t.requestAccepted.contractAvailable
  const contractSignatureLabel =
    typeof messages.signContract === 'string'
      ? messages.signContract
      : t.requestAccepted.viewContract

  const formatDate = (date: Date) =>
    formatEmailDateInStoreTimezone(date, locale, datePatterns.full, storeTimezone, storeCountry)

  const { greeting, message } = resolveCustomContent(
    customContent,
    {
      greeting: tc.greeting,
      signature: `${tc.regards}\n${tc.team.replace('{storeName}', storeName)}`,
    },
    { name: customerFirstName, number: reservationNumber },
  )

  const showTaxRows = taxEnabled && taxAmount != null && taxAmount > 0 && subtotalExclTax != null
  const totals = [
    ...(showTaxRows
      ? [
          { label: tc.subtotalExclTax, amount: subtotalExclTax },
          { label: tc.taxAmount.replace('{rate}', String(taxRate ?? 0)), amount: taxAmount },
          { label: tc.subtotalInclTax, amount: subtotal },
        ]
      : [{ label: tc.subtotal, amount: subtotal }]),
    ...(deposit > 0 ? [{ label: tc.deposit, amount: deposit }] : []),
    { label: tc.totalToPay, amount: total, bold: true },
  ]

  return (
    <BaseLayout
      preview={
        customContent?.subject?.replace('{number}', reservationNumber) ||
        messages.subject.replace('{number}', reservationNumber)
      }
      storeName={storeName}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      storeEmail={storeEmail}
      storePhone={storePhone}
      storeAddress={storeAddress}
      locale={locale}
    >
      <EmailHeading>{messages.title}</EmailHeading>

      <EmailText>{greeting}</EmailText>

      <EmailText>{messages.body.replace('{number}', reservationNumber)}</EmailText>

      {/* Custom message from store settings */}
      {message && <EmailText>{message}</EmailText>}

      <InfoCard
        label={tc.period}
        value={
          <>
            {tc.periodFrom.replace('{startDate}', formatDate(startDate))}
            <br />
            {tc.periodTo.replace('{endDate}', formatDate(endDate))}
          </>
        }
        footnote={timezoneLine}
      >
        {pickupLocationSnapshot && (
          <InfoCardItem
            label={tc.pickupAddress}
            value={
              <>
                {pickupLocationSnapshot.name}
                <br />
                {pickupLocationSnapshot.address}
              </>
            }
          />
        )}
        {returnLocationSnapshot && (
          <InfoCardItem
            label={tc.returnAddress}
            value={
              <>
                {returnLocationSnapshot.name}
                <br />
                {returnLocationSnapshot.address}
              </>
            }
          />
        )}
      </InfoCard>

      <EmailText bold>{messages.summary}</EmailText>

      <ItemsTable items={items} totals={totals} formatCurrency={formatCurrency} />

      <CtaButton href={reservationUrl} label={tc.viewReservation} primaryColor={primaryColor} />

      {contractSignatureUrl && (
        <>
          <EmailText>{contractSignatureText}</EmailText>
          <CtaButton
            href={contractSignatureUrl}
            label={contractSignatureLabel}
            primaryColor={primaryColor}
          />
        </>
      )}
    </BaseLayout>
  )
}

export default ReservationConfirmationEmail
