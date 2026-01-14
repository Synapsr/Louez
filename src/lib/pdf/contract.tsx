import {
  Document,
  Page,
  Text,
  View,
  Image,
} from '@react-pdf/renderer'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { createContractStyles } from './styles'

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
  }
  totals: {
    subtotalHT: string
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
}

interface Customer {
  firstName: string
  lastName: string
  email: string
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
}

// Get date-fns locale from our locale code
function getDateLocale(locale: SupportedLocale) {
  return locale === 'fr' ? fr : enUS
}

// Currency formatting based on locale and currency
function formatCurrencyValue(amount: number | string, locale: SupportedLocale, currency: string = 'EUR'): string {
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
  }).format(num).replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ')
}

// Date formatting functions with locale support
function formatFullDate(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'EEEE d MMMM yyyy', { locale: dateLocale })
}

function formatTime(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'HH:mm', { locale: dateLocale })
}

function formatDateTimePrecise(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  const atWord = locale === 'fr' ? 'à' : 'at'
  return format(date, `d MMMM yyyy '${atWord}' HH:mm:ss`, { locale: dateLocale })
}

function formatShortDate(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'd MMM yyyy', { locale: dateLocale })
}

function formatDateOnly(date: Date, locale: SupportedLocale): string {
  const dateLocale = getDateLocale(locale)
  return format(date, 'd MMMM yyyy', { locale: dateLocale })
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
}: ContractDocumentProps) {
  const primaryColor = store.primaryColor || '#0066FF'
  const styles = createContractStyles(primaryColor)

  // Create a currency formatter for this document
  const formatCurrency = (amount: number | string) => formatCurrencyValue(amount, locale, currency)

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
                {capitalize(formatDateOnly(doc.generatedAt, locale))}
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
            {store.address && <Text style={styles.partyInfo}>{store.address}</Text>}
            {store.phone && <Text style={styles.partyInfo}>{store.phone}</Text>}
            {store.email && <Text style={styles.partyInfo}>{store.email}</Text>}
            {store.siret && <Text style={styles.partyLegal}>SIRET : {store.siret}</Text>}
            {store.tvaNumber && <Text style={styles.partyLegal}>N° TVA : {store.tvaNumber}</Text>}
          </View>

          {/* Customer */}
          <View style={styles.partyCard}>
            <Text style={styles.partyLabel}>{t.parties.customer}</Text>
            <Text style={styles.partyName}>
              {reservation.customer.firstName} {reservation.customer.lastName}
            </Text>
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
                  {capitalize(formatFullDate(reservation.startDate, locale))}
                </Text>
                <Text style={styles.periodTime}>
                  {t.period.at} {formatTime(reservation.startDate, locale)}
                </Text>
              </View>
            </View>
            <View style={styles.periodCard}>
              <View style={styles.periodContent}>
                <Text style={styles.periodLabel}>{t.period.end}</Text>
                <Text style={styles.periodDate}>
                  {capitalize(formatFullDate(reservation.endDate, locale))}
                </Text>
                <Text style={styles.periodTime}>
                  {t.period.at} {formatTime(reservation.endDate, locale)}
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
              <Text style={[styles.tableHeaderCell, styles.tableCellQty]}>
                {t.table.qty}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableCellPrice]}>
                {t.table.unitPrice}
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableCellTotal]}>
                {t.table.total}
              </Text>
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
                <Text style={[styles.tableCell, styles.tableCellName]}>
                  {item.productSnapshot.name}
                </Text>
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
                  {formatCurrency(reservation.subtotalAmount)}
                </Text>
              </View>
              <View style={[styles.totalRow, styles.totalRowMain]}>
                <Text style={styles.totalLabelMain}>{t.totals.totalTTC}</Text>
                <Text style={styles.totalValueMain}>
                  {formatCurrency(reservation.totalAmount)}
                </Text>
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
                      ? formatShortDate(payment.paidAt, locale)
                      : formatShortDate(payment.createdAt, locale)}
                  </Text>
                  <Text
                    style={[
                      styles.paymentStatus,
                      payment.status === 'completed' ? styles.paymentStatusCompleted : styles.paymentStatusPending,
                    ]}
                  >
                    {payment.status === 'completed' ? t.paymentStatus.completed : t.paymentStatus.pending}
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
                {t.conditions.termsLink.replace('{slug}', store.slug)}
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
                <Text style={styles.signatureText}>
                  {t.signature.landlordText}
                </Text>
                <View style={styles.signatureDateRow}>
                  <Text style={styles.signatureDateLabel}>{t.signature.dateLabel}</Text>
                  <Text style={styles.signatureDate}>
                    {formatDateTimePrecise(doc.generatedAt, locale)}
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
                <Text style={styles.signatureText}>
                  {t.signature.customerText}
                </Text>
                <View style={styles.signatureDateRow}>
                  <Text style={styles.signatureDateLabel}>{t.signature.dateLabel}</Text>
                  <Text style={styles.signatureDate}>
                    {formatDateTimePrecise(reservation.signedAt || reservation.createdAt, locale)}
                  </Text>
                </View>
                {reservation.signatureIp && (
                  <Text style={styles.signatureIp}>{t.signature.ipLabel} {reservation.signatureIp}</Text>
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
              {t.footer.generatedOn.replace('{date}', formatDateOnly(doc.generatedAt, locale))}
            </Text>
          </View>
        </View>

        {/* Page Number */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber}/${totalPages}` : ''
          }
          fixed
        />
      </Page>
    </Document>
  )
}
