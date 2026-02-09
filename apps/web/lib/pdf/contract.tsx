import type { ComponentType, PropsWithChildren } from 'react'
import {
  Document as BaseDocument,
  Page as BasePage,
  Text as BaseText,
  View as BaseView,
  Image as BaseImage,
} from '@react-pdf/renderer'
import { createContractStyles } from './styles'
import { formatStoreDate } from '@/lib/utils/store-date'
import { env } from '@/env'

// Cast react-pdf components to React types for TS/React 19 compatibility.
type PdfComponent = ComponentType<PropsWithChildren<Record<string, unknown>>>
const Document = BaseDocument as unknown as PdfComponent
const Page = BasePage as unknown as PdfComponent
const Text = BaseText as unknown as PdfComponent
const View = BaseView as unknown as PdfComponent
const Image = BaseImage as unknown as PdfComponent

// Types for contract translations
export interface ContractTranslations {
  documentType: string
  documentNumber: string
  reservationNumber: string
  sections: {
    rentalPeriod: string
    rentedEquipment: string
    payments: string
    conditions: string
    signatures: string
    legalMentions: string
  }
  parties: {
    landlord: string
    customer: string
    contact: string
  }
  period: {
    start: string
    end: string
    at: string
  }
  table: {
    designation: string
    qty: string
    unitPrice: string
    total: string
    unitIdentifiers?: string
  }
  totals: {
    subtotalHT: string
    tax: string
    totalTTC: string
    deposit: string
  }
  paymentTypes: {
    rental: string
    deposit: string
    deposit_return: string
    damage: string
  }
  paymentMethods: {
    stripe: string
    cash: string
    card: string
    transfer: string
    check: string
    other: string
  }
  paymentStatus: {
    completed: string
    pending: string
  }
  signature: {
    validated: string
    signed: string
    landlordText: string
    customerText: string
    dateLabel: string
    ipLabel: string
  }
  conditions: {
    condition1: string
    condition2: string
    condition3: string
    termsLink: string
  }
  legal: {
    text1: string
    text2: string
    companyInfo: string
    tvaApplicable: string
    tvaNotApplicable: string
  }
  footer: {
    poweredBy: string
    generatedOn: string
  }
}

export type SupportedLocale = 'fr' | 'en'

interface BillingAddress {
  useSameAsStore: boolean
  address?: string
  city?: string
  postalCode?: string
  country?: string
}

interface Store {
  name: string
  slug: string
  logoUrl?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  siret?: string | null
  tvaNumber?: string | null
  primaryColor?: string
  billingAddress?: BillingAddress | null
}

interface Customer {
  firstName: string
  lastName: string
  email: string
  customerType?: 'individual' | 'business' | null
  companyName?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  postalCode?: string | null
}

interface ReservationItem {
  productSnapshot: {
    name: string
    description?: string | null
  }
  quantity: number
  unitPrice: string
  totalPrice: string
  assignedUnitIdentifiers?: string[]
}

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage'
  method: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  paidAt?: Date | null
  createdAt: Date
}

interface Reservation {
  number: string
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  // Tax fields
  subtotalExclTax?: string | null
  taxAmount?: string | null
  taxRate?: string | null
  signedAt?: Date | null
  signatureIp?: string | null
  createdAt: Date
  customer: Customer
  items: ReservationItem[]
  payments: Payment[]
}

interface ContractDocumentProps {
  reservation: Reservation
  store: Store
  document: {
    number: string
    generatedAt: Date
  }
  locale: SupportedLocale
  translations: ContractTranslations
  currency?: string
  timezone?: string
}

// Currency formatting based on locale and currency
function formatCurrencyValue(
  amount: number | string,
  locale: SupportedLocale,
  currency: string = 'EUR'
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount

  // Map currency to best locale for formatting
  const currencyLocaleMap: Record<string, string> = {
    EUR: locale === 'fr' ? 'fr-FR' : 'en-IE',
    USD: 'en-US',
    GBP: 'en-GB',
    CHF: 'de-CH',
    CAD: 'en-CA',
    AUD: 'en-AU',
  }

  const formatLocale = currencyLocaleMap[currency] || (locale === 'fr' ? 'fr-FR' : 'en-US')

  return new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency: currency,
  })
    .format(num)
    .replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ')
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function ContractDocument({
  reservation,
  store,
  document: doc,
  locale,
  translations: t,
  currency = 'EUR',
  timezone,
}: ContractDocumentProps) {
  const primaryColor = store.primaryColor || '#0066FF'
  const styles = createContractStyles(primaryColor)

  // Create a currency formatter for this document
  const formatCurrency = (amount: number | string) => formatCurrencyValue(amount, locale, currency)

  // Date formatting helpers using store timezone
  const formatFullDate = (date: Date) => formatStoreDate(date, timezone, 'FULL_DATE', locale)
  const formatTime = (date: Date) => formatStoreDate(date, timezone, 'TIME_ONLY', locale)
  const formatDateTimePrecise = (date: Date) => formatStoreDate(date, timezone, 'PRECISE_DATETIME', locale)
  const formatShortDate = (date: Date) => formatStoreDate(date, timezone, 'SHORT_DATE', locale)
  const formatDateOnly = (date: Date) => formatStoreDate(date, timezone, 'MEDIUM_DATE', locale)

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Colored accent bar */}
        <View style={styles.headerBar} fixed />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            {store.logoUrl ? (
              <Image src={store.logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.storeName}>{store.name}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <View style={styles.documentTypeContainer}>
              <Text style={styles.documentType}>{t.documentType}</Text>
            </View>
            <View style={styles.documentInfo}>
              <Text style={styles.documentNumber}>
                {t.documentNumber.replace('{number}', doc.number)}
              </Text>
              <Text style={styles.documentDate}>
                {t.reservationNumber.replace('{number}', reservation.number)}
              </Text>
              <Text style={styles.documentDate}>
                {capitalize(formatDateOnly(doc.generatedAt))}
              </Text>
            </View>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.partiesContainer} wrap={false}>
          {/* Landlord */}
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>{t.parties.landlord}</Text>
            <Text style={styles.partyName}>{store.name}</Text>
            {/* Use billing address if different, otherwise use store address */}
            {store.billingAddress && !store.billingAddress.useSameAsStore ? (
              <>
                {store.billingAddress.address && (
                  <Text style={styles.partyInfo}>{store.billingAddress.address}</Text>
                )}
                {(store.billingAddress.postalCode || store.billingAddress.city) && (
                  <Text style={styles.partyInfo}>
                    {store.billingAddress.postalCode} {store.billingAddress.city}
                  </Text>
                )}
              </>
            ) : (
              store.address && <Text style={styles.partyInfo}>{store.address}</Text>
            )}
            {store.phone && <Text style={styles.partyInfo}>{store.phone}</Text>}
            {store.email && <Text style={styles.partyInfo}>{store.email}</Text>}
            {store.siret && <Text style={styles.partyLegal}>SIRET : {store.siret}</Text>}
            {store.tvaNumber && <Text style={styles.partyLegal}>N° TVA : {store.tvaNumber}</Text>}
          </View>

          {/* Customer */}
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>{t.parties.customer}</Text>
            {reservation.customer.customerType === 'business' &&
            reservation.customer.companyName ? (
              <>
                <Text style={styles.partyName}>{reservation.customer.companyName}</Text>
                <Text style={styles.partyInfo}>
                  {t.parties.contact}: {reservation.customer.firstName}{' '}
                  {reservation.customer.lastName}
                </Text>
              </>
            ) : (
              <Text style={styles.partyName}>
                {reservation.customer.firstName} {reservation.customer.lastName}
              </Text>
            )}
            <Text style={styles.partyInfo}>{reservation.customer.email}</Text>
            {reservation.customer.phone && (
              <Text style={styles.partyInfo}>{reservation.customer.phone}</Text>
            )}
            {reservation.customer.address && (
              <Text style={styles.partyInfo}>{reservation.customer.address}</Text>
            )}
            {reservation.customer.city && reservation.customer.postalCode && (
              <Text style={styles.partyInfo}>
                {reservation.customer.postalCode} {reservation.customer.city}
              </Text>
            )}
          </View>
        </View>

        {/* Rental Period */}
        <View style={styles.periodSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.rentalPeriod}</Text>
          <View style={styles.periodContainer}>
            <View style={styles.periodCard}>
              <View style={styles.periodContent}>
                <Text style={styles.periodLabel}>{t.period.start}</Text>
                <Text style={styles.periodDate}>
                  {capitalize(formatFullDate(reservation.startDate))}
                </Text>
                <Text style={styles.periodTime}>
                  {t.period.at} {formatTime(reservation.startDate)}
                </Text>
              </View>
            </View>
            <View style={styles.periodCard}>
              <View style={styles.periodContent}>
                <Text style={styles.periodLabel}>{t.period.end}</Text>
                <Text style={styles.periodDate}>
                  {capitalize(formatFullDate(reservation.endDate))}
                </Text>
                <Text style={styles.periodTime}>
                  {t.period.at} {formatTime(reservation.endDate)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Equipment Table */}
        <View style={styles.tableSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.rentedEquipment}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, styles.tableCellName]}>
                {t.table.designation}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableCellQty]}>{t.table.qty}</Text>
              <Text style={[styles.tableHeaderCell, styles.tableCellPrice]}>
                {t.table.unitPrice}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableCellTotal]}>{t.table.total}</Text>
            </View>
            {reservation.items.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.tableRow,
                  index % 2 === 1 ? styles.tableRowAlt : {},
                  index === reservation.items.length - 1 ? styles.tableRowLast : {},
                ]}
              >
                <View style={[styles.tableCell, styles.tableCellName]}>
                  <Text>{item.productSnapshot.name}</Text>
                  {item.assignedUnitIdentifiers && item.assignedUnitIdentifiers.length > 0 && (
                    <Text style={styles.unitIdentifiers}>
                      {t.table.unitIdentifiers
                        ? t.table.unitIdentifiers.replace(
                            '{identifiers}',
                            item.assignedUnitIdentifiers.join(', ')
                          )
                        : `Identifiers: ${item.assignedUnitIdentifiers.join(', ')}`}
                    </Text>
                  )}
                </View>
                <Text style={[styles.tableCell, styles.tableCellQty]}>{item.quantity}</Text>
                <Text style={[styles.tableCell, styles.tableCellPrice]}>
                  {formatCurrency(item.unitPrice)}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellTotal]}>
                  {formatCurrency(item.totalPrice)}
                </Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={styles.totalsContainer}>
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t.totals.subtotalHT}</Text>
                <Text style={styles.totalValue}>
                  {formatCurrency(reservation.subtotalExclTax || reservation.subtotalAmount)}
                </Text>
              </View>
              {/* Tax line - only show if tax amount is present and > 0 */}
              {reservation.taxAmount && parseFloat(reservation.taxAmount) > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    {t.totals.tax.replace('{rate}', reservation.taxRate || '0')}
                  </Text>
                  <Text style={styles.totalValue}>{formatCurrency(reservation.taxAmount)}</Text>
                </View>
              )}
              <View style={[styles.totalRow, styles.totalRowMain]}>
                <Text style={styles.totalLabelMain}>{t.totals.totalTTC}</Text>
                <Text style={styles.totalValueMain}>{formatCurrency(reservation.totalAmount)}</Text>
              </View>
              {parseFloat(reservation.depositAmount) > 0 && (
                <View style={[styles.totalRow, styles.depositRow, styles.totalRowLast]}>
                  <Text style={styles.depositLabel}>{t.totals.deposit}</Text>
                  <Text style={styles.depositValue}>
                    {formatCurrency(reservation.depositAmount)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Payments Section */}
        {reservation.payments.length > 0 && (
          <View style={styles.paymentsSection} wrap={false}>
            <Text style={styles.sectionTitle}>{t.sections.payments}</Text>
            <View style={styles.paymentsList}>
              {reservation.payments.map((payment, index) => (
                <View
                  key={payment.id}
                  style={[
                    styles.paymentRow,
                    index === reservation.payments.length - 1 ? styles.paymentRowLast : {},
                  ]}
                >
                  <View style={styles.paymentDetails}>
                    <Text style={styles.paymentType}>
                      {t.paymentTypes[payment.type] || payment.type}
                    </Text>
                    <Text style={styles.paymentMethod}>
                      {t.paymentMethods[payment.method] || payment.method}
                    </Text>
                  </View>
                  <Text style={styles.paymentDate}>
                    {payment.paidAt
                      ? formatShortDate(payment.paidAt)
                      : formatShortDate(payment.createdAt)}
                  </Text>
                  <Text
                    style={[
                      styles.paymentStatus,
                      payment.status === 'completed'
                        ? styles.paymentStatusCompleted
                        : styles.paymentStatusPending,
                    ]}
                  >
                    {payment.status === 'completed'
                      ? t.paymentStatus.completed
                      : t.paymentStatus.pending}
                  </Text>
                  <Text
                    style={[
                      styles.paymentAmount,
                      payment.status !== 'completed' ? styles.paymentAmountPending : {},
                    ]}
                  >
                    {payment.type === 'deposit_return' ? '-' : ''}
                    {formatCurrency(payment.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Conditions */}
        <View style={styles.conditionsSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.conditions}</Text>
          <View style={styles.conditionsList}>
            <View style={styles.conditionItem}>
              <View style={styles.conditionBullet} />
              <Text style={styles.conditionText}>{t.conditions.condition1}</Text>
            </View>
            <View style={styles.conditionItem}>
              <View style={styles.conditionBullet} />
              <Text style={styles.conditionText}>{t.conditions.condition2}</Text>
            </View>
            <View style={styles.conditionItem}>
              <View style={styles.conditionBullet} />
              <Text style={styles.conditionText}>{t.conditions.condition3}</Text>
            </View>
            <View style={styles.conditionItem}>
              <View style={styles.conditionBullet} />
              <Text style={styles.conditionText}>
                {t.conditions.termsLink
                  .replace('{slug}', store.slug)
                  .replace('{domain}', env.NEXT_PUBLIC_APP_DOMAIN)}
              </Text>
            </View>
          </View>
        </View>

        {/* Signatures */}
        <View style={styles.signaturesSection} wrap={false}>
          <Text style={styles.sectionTitle}>{t.sections.signatures}</Text>
          <View style={styles.signaturesContainer}>
            {/* Landlord Signature */}
            <View style={styles.signatureBox}>
              <View style={styles.signatureHeader}>
                <Text style={styles.signatureTitle}>{t.parties.landlord}</Text>
                <Text style={styles.signatureStatusText}>{t.signature.validated}</Text>
              </View>
              <View style={styles.signatureContent}>
                <Text style={styles.signatureText}>{t.signature.landlordText}</Text>
                <View style={styles.signatureDateRow}>
                  <Text style={styles.signatureDateLabel}>{t.signature.dateLabel}</Text>
                  <Text style={styles.signatureDate}>
                    {formatDateTimePrecise(doc.generatedAt)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Customer Signature */}
            <View style={styles.signatureBox}>
              <View style={styles.signatureHeader}>
                <Text style={styles.signatureTitle}>{t.parties.customer}</Text>
                <Text style={styles.signatureStatusText}>{t.signature.signed}</Text>
              </View>
              <View style={styles.signatureContent}>
                <Text style={styles.signatureText}>{t.signature.customerText}</Text>
                <View style={styles.signatureDateRow}>
                  <Text style={styles.signatureDateLabel}>{t.signature.dateLabel}</Text>
                  <Text style={styles.signatureDate}>
                    {formatDateTimePrecise(reservation.signedAt || reservation.createdAt)}
                  </Text>
                </View>
                {reservation.signatureIp && (
                  <Text style={styles.signatureIp}>
                    {t.signature.ipLabel} {reservation.signatureIp}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Legal Mentions */}
        <View style={styles.legalSection} wrap={false}>
          <Text style={styles.legalTitle}>{t.sections.legalMentions}</Text>
          <Text style={styles.legalText}>{t.legal.text1}</Text>
          <Text style={styles.legalText}>{t.legal.text2}</Text>
          {store.siret && (
            <Text style={styles.legalText}>
              {t.legal.companyInfo.replace('{name}', store.name).replace('{siret}', store.siret)}
              {store.tvaNumber
                ? ` - ${t.legal.tvaApplicable.replace('{tva}', store.tvaNumber)}`
                : ` - ${t.legal.tvaNotApplicable}`}
            </Text>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <View style={styles.footerContent}>
            <Text style={styles.footerLeft}>
              {store.name} {store.address ? `• ${store.address}` : ''}
            </Text>
            <Text style={styles.footerCenter}>{t.footer.poweredBy}</Text>
            <Text style={styles.footerRight}>
              {t.footer.generatedOn.replace('{date}', formatDateOnly(doc.generatedAt))}
            </Text>
          </View>
        </View>

        {/* Page Number */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            totalPages > 1 ? `Page ${pageNumber}/${totalPages}` : ''
          }
          fixed
        />
      </Page>
    </Document>
  )
}
