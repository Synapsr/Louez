import type { ReactElement } from 'react'
import type { EmailCustomContent } from '@louez/types'

import {
  getEmailTranslations,
  getEmailTranslator,
  getDateFormatPatterns,
  type EmailLocale,
} from './i18n'
import { formatEmailDateInStoreTimezone } from './date-time'
import { DEFAULT_PRIMARY_COLOR } from './templates/components/theme'
import { ContractEmail } from './templates/contract'
import { CustomMessageEmail } from './templates/custom-message'
import { InstantAccessEmail } from './templates/instant-access'
import { PaymentRequestEmail } from './templates/payment-request'
import { ReminderPickupEmail } from './templates/reminder-pickup'
import { ReminderReturnEmail } from './templates/reminder-return'

/**
 * Subject + element composition for the emails that are also rendered in the
 * browser (dashboard preview). Everything here must stay isomorphic: no env,
 * no db, no transport — the server callers own logo resolution (cid inlining)
 * and URL minting, and hand the results in as plain values.
 */

export interface ComposeStore {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  theme?: { mode?: 'light' | 'dark'; primaryColor?: string } | null
  settings?: { currency?: string; country?: string; timezone?: string } | null
  /** Only the store-configured content overrides matter to composition. */
  emailSettings?: {
    pickupReminderContent?: EmailCustomContent
    returnReminderContent?: EmailCustomContent
  } | null
}

export interface ComposeCustomer {
  firstName: string
  lastName: string
  email: string
}

export interface ComposedEmail {
  subject: string
  element: ReactElement
}

const primaryColorOf = (store: ComposeStore) =>
  store.theme?.primaryColor || DEFAULT_PRIMARY_COLOR

interface ComposeReminderPickupParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservation: { number: string; startDate: Date }
  reservationUrl: string
  /** Set while the customer has not signed the contract: the reminder asks them to. */
  contractSignatureUrl?: string
  additionalMessage?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeReminderPickupEmail({
  store,
  customer,
  reservation,
  reservationUrl,
  contractSignatureUrl,
  additionalMessage,
  locale = 'fr',
  logoUrl,
}: ComposeReminderPickupParams): ComposedEmail {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.pickupReminderContent
  const subject = customContent?.subject || `${t.reminderPickup.subject} - ${store.name}`

  const element = ReminderPickupEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeAddress: store.address,
    storeEmail: store.email,
    storePhone: store.phone,
    storeTimezone: store.settings?.timezone,
    storeCountry: store.settings?.country,
    customerFirstName: customer.firstName,
    reservationNumber: reservation.number,
    startDate: reservation.startDate,
    reservationUrl,
    contractSignatureUrl,
    customContent,
    additionalMessage,
    locale,
  })

  return { subject, element }
}

interface ComposeReminderReturnParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservation: { number: string; endDate: Date }
  additionalMessage?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeReminderReturnEmail({
  store,
  customer,
  reservation,
  additionalMessage,
  locale = 'fr',
  logoUrl,
}: ComposeReminderReturnParams): ComposedEmail {
  const translate = getEmailTranslator(locale)
  const customContent = store.emailSettings?.returnReminderContent
  const formattedEndDate = formatEmailDateInStoreTimezone(
    reservation.endDate,
    locale,
    getDateFormatPatterns(locale).short,
    store.settings?.timezone,
    store.settings?.country,
  )
  const subject =
    customContent?.subject ||
    `${translate('reminderReturn.subject', { date: formattedEndDate })} - ${store.name}`

  const element = ReminderReturnEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeAddress: store.address,
    storeEmail: store.email,
    storePhone: store.phone,
    storeTimezone: store.settings?.timezone,
    storeCountry: store.settings?.country,
    customerFirstName: customer.firstName,
    reservationNumber: reservation.number,
    endDate: reservation.endDate,
    customContent,
    additionalMessage,
    locale,
  })

  return { subject, element }
}

interface ComposeInstantAccessParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservation: {
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  items: { name: string; quantity: number; totalPrice: number }[]
  accessUrl: string
  showPaymentCta: boolean
  additionalMessage?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeInstantAccessEmail({
  store,
  customer,
  reservation,
  items,
  accessUrl,
  showPaymentCta,
  additionalMessage,
  locale = 'fr',
  logoUrl,
}: ComposeInstantAccessParams): ComposedEmail {
  const t = getEmailTranslations(locale)
  const subject = `${t.instantAccess.subject.replace('{number}', reservation.number)} - ${store.name}`

  const element = InstantAccessEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeAddress: store.address,
    storePhone: store.phone,
    storeEmail: store.email,
    storeTimezone: store.settings?.timezone,
    storeCountry: store.settings?.country,
    customerFirstName: customer.firstName,
    reservationNumber: reservation.number,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    items,
    totalAmount: reservation.totalAmount,
    accessUrl,
    showPaymentCta,
    additionalMessage,
    locale,
    currency: store.settings?.currency || 'EUR',
  })

  return { subject, element }
}

interface ComposeContractParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservationNumber: string
  contractUrl: string
  /** Set while the customer has not signed the contract: the email asks them to sign it. */
  contractSignatureUrl?: string
  additionalMessage?: string | null
  customSubject?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeContractEmail({
  store,
  customer,
  reservationNumber,
  contractUrl,
  contractSignatureUrl,
  additionalMessage,
  customSubject,
  locale = 'fr',
  logoUrl,
}: ComposeContractParams): ComposedEmail {
  const t = getEmailTranslations(locale)
  const subject =
    customSubject || `${t.contract.subject.replace('{number}', reservationNumber)} - ${store.name}`

  const element = ContractEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeEmail: store.email,
    storePhone: store.phone,
    storeAddress: store.address,
    customerFirstName: customer.firstName,
    reservationNumber,
    contractUrl,
    contractSignatureUrl,
    additionalMessage,
    locale,
  })

  return { subject, element }
}

interface ComposeManualPaymentRequestParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservationNumber: string
  amount: number
  reservationUrl: string
  additionalMessage?: string | null
  customSubject?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeManualPaymentRequestEmail({
  store,
  customer,
  reservationNumber,
  amount,
  reservationUrl,
  additionalMessage,
  customSubject,
  locale = 'fr',
  logoUrl,
}: ComposeManualPaymentRequestParams): ComposedEmail {
  const t = getEmailTranslations(locale)
  const subject =
    customSubject ||
    `${t.paymentRequest.subject.replace('{number}', reservationNumber)} - ${store.name}`

  const element = PaymentRequestEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeAddress: store.address,
    storeEmail: store.email,
    storePhone: store.phone,
    customerFirstName: customer.firstName,
    reservationNumber,
    amount,
    variant: 'manual',
    paymentUrl: reservationUrl,
    customMessage: additionalMessage,
    locale,
    currency: store.settings?.currency || 'EUR',
  })

  return { subject, element }
}

interface ComposeCustomMessageParams {
  store: ComposeStore
  customer: ComposeCustomer
  reservationNumber: string
  message: string
  reservationUrl: string
  customSubject?: string | null
  locale?: EmailLocale
  logoUrl: string | null
}

export function composeCustomMessageEmail({
  store,
  customer,
  reservationNumber,
  message,
  reservationUrl,
  customSubject,
  locale = 'fr',
  logoUrl,
}: ComposeCustomMessageParams): ComposedEmail {
  const t = getEmailTranslations(locale)
  const subject =
    customSubject ||
    `${t.customMessage.subject.replace('{number}', reservationNumber)} - ${store.name}`

  const element = CustomMessageEmail({
    storeName: store.name,
    logoUrl,
    primaryColor: primaryColorOf(store),
    storeEmail: store.email,
    storePhone: store.phone,
    storeAddress: store.address,
    customerFirstName: customer.firstName,
    reservationNumber,
    message,
    reservationUrl,
    locale,
  })

  return { subject, element }
}
