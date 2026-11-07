import { render } from '@react-email/render'

import {
  composeContractEmail,
  composeCustomMessageEmail,
  composeInstantAccessEmail,
  composeManualPaymentRequestEmail,
  composeReminderPickupEmail,
  composeReminderReturnEmail,
  type ComposeCustomer,
  type ComposeStore,
} from './compose'
import { getLocaleFromCountry } from './i18n'

/**
 * The emails a store owner sends by hand from a reservation. This module is
 * isomorphic — the dashboard preview renders it in the browser and the send
 * action renders it on the server — so what is previewed is by construction
 * what is sent. Anything server-only (db, env, token minting, cid logos) stays
 * with the callers and comes in through the context/options.
 */
export const MANUAL_RESERVATION_EMAIL_TEMPLATE_IDS = [
  'contract',
  'payment_request',
  'reminder_pickup',
  'reminder_return',
  'access_link',
  'custom',
] as const

export type ManualReservationEmailTemplateId =
  (typeof MANUAL_RESERVATION_EMAIL_TEMPLATE_IDS)[number]

export interface ManualReservationEmailPayload {
  templateId: string
  customSubject?: string
  customMessage?: string
}

/**
 * Everything the manual emails need, as plain serializable values so it can
 * cross the network once and feed the client-side preview. Dates travel as ISO
 * strings; the builder normalizes them back.
 */
export interface ManualEmailRenderContext {
  store: ComposeStore
  customer: ComposeCustomer
  reservation: {
    id: string
    number: string
    startDate: string
    endDate: string
    totalAmount: string
    depositAmount: string
    items: { name: string; quantity: number; totalPrice: string }[]
  }
  reservationUrl: string
  /** Absolute logo URL for a browser rendering (never a `cid:` reference). */
  logoUrl: string | null
  /** Precomputed so Stripe account details never cross the network. */
  showPaymentCta: boolean
  /** An unsigned contract turns the contract email and the pickup reminder into a request to sign. */
  contractSigned: boolean
}

export interface BuildManualEmailFromContextOptions {
  /** Real minted URL for a send; falls back to the reservation page (preview). */
  contractUrl?: string
  /** Real minted URL for a send; falls back to the reservation page (preview). */
  accessUrl?: string
  /** Real minted URL for a send; falls back to the reservation page (preview). */
  contractSignatureUrl?: string
  /** `cid:` logo reference for a send; falls back to the context's URL. */
  logoUrl?: string | null
}

export interface BuiltManualReservationEmail {
  to: string
  subject: string
  html: string
  /**
   * `email_logs.templateType` to record once sent. Only the templates that
   * were historically logged carry one; the others stay out of the log.
   */
  logTemplateType?: string
}

export type BuildManualReservationEmailFromContextResult =
  | BuiltManualReservationEmail
  | { error: string }

export async function buildManualReservationEmailFromContext(
  context: ManualEmailRenderContext,
  payload: ManualReservationEmailPayload,
  options: BuildManualEmailFromContextOptions = {},
): Promise<BuildManualReservationEmailFromContextResult> {
  const { store, customer, reservation } = context
  const to = customer.email
  const locale = getLocaleFromCountry(store.settings?.country)
  const logoUrl = options.logoUrl !== undefined ? options.logoUrl : context.logoUrl
  const additionalMessage = payload.customMessage?.trim() || null
  const customSubject = payload.customSubject?.trim() || null
  const contractSignatureUrl = context.contractSigned
    ? undefined
    : (options.contractSignatureUrl ?? context.reservationUrl)

  switch (payload.templateId) {
    case 'contract': {
      const { subject, element } = composeContractEmail({
        store,
        customer,
        reservationNumber: reservation.number,
        contractUrl: options.contractUrl ?? context.reservationUrl,
        contractSignatureUrl,
        additionalMessage,
        customSubject,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element) }
    }

    case 'payment_request': {
      const amount =
        Number.parseFloat(reservation.totalAmount) + Number.parseFloat(reservation.depositAmount)

      const { subject, element } = composeManualPaymentRequestEmail({
        store,
        customer,
        reservationNumber: reservation.number,
        amount,
        reservationUrl: context.reservationUrl,
        additionalMessage,
        customSubject,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element) }
    }

    case 'reminder_pickup': {
      const { subject, element } = composeReminderPickupEmail({
        store,
        customer,
        reservation: {
          number: reservation.number,
          startDate: new Date(reservation.startDate),
        },
        reservationUrl: context.reservationUrl,
        contractSignatureUrl,
        additionalMessage,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element), logTemplateType: 'reminder_pickup' }
    }

    case 'reminder_return': {
      const { subject, element } = composeReminderReturnEmail({
        store,
        customer,
        reservation: {
          number: reservation.number,
          endDate: new Date(reservation.endDate),
        },
        additionalMessage,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element), logTemplateType: 'reminder_return' }
    }

    case 'access_link': {
      const { subject, element } = composeInstantAccessEmail({
        store,
        customer,
        reservation: {
          number: reservation.number,
          startDate: new Date(reservation.startDate),
          endDate: new Date(reservation.endDate),
          totalAmount: Number.parseFloat(reservation.totalAmount),
        },
        items: reservation.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          totalPrice: Number.parseFloat(item.totalPrice),
        })),
        accessUrl: options.accessUrl ?? context.reservationUrl,
        showPaymentCta: context.showPaymentCta,
        additionalMessage,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element), logTemplateType: 'instant_access' }
    }

    case 'custom': {
      if (!additionalMessage) {
        return { error: 'errors.messageRequired' }
      }

      const { subject, element } = composeCustomMessageEmail({
        store,
        customer,
        reservationNumber: reservation.number,
        message: additionalMessage,
        reservationUrl: context.reservationUrl,
        customSubject,
        locale,
        logoUrl,
      })

      return { to, subject, html: await render(element) }
    }

    default:
      return { error: 'errors.invalidEmailTemplate' }
  }
}
