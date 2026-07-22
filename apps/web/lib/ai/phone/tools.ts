import { tool } from 'ai'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  aiAdvisorConversations,
  db,
  products,
  storeMembers,
  stores,
  users,
} from '@louez/db'

import { createReservation } from '@/app/(storefront)/[slug]/checkout/actions'
import { createAdvisorTools } from '@/lib/ai/advisor/tools'
import { describePhoneQuoteError } from '@/lib/ai/phone/errors'
import { sendPhoneCallbackLandlordEmail } from '@/lib/email/send'
import type { EmailLocale } from '@/lib/email/i18n'
import { log } from '@/lib/evlog'
import { sendSms } from '@/lib/sms/client'
import { env } from '@/env'

export type PhoneToolContext = {
  storeId: string
  storeSlug: string
  storeName: string
  conversationId: string
  /** Caller's number in E.164 (the Twilio `From`). */
  callerPhone: string
  /** Configured receptionist language (e.g. 'fr'). */
  language: string
  /** Whether the receptionist may create pending reservations. */
  canTakeReservations: boolean
  /** Human fallback number (E.164) when a transfer is configured. */
  transferNumber: string | null
}

/** One-sentence SMS recap sent after a phone booking, per language. */
const RECAP_SMS: Record<
  string,
  (v: { store: string; number: string }) => string
> = {
  fr: ({ store, number }) =>
    `${store} : votre demande de réservation ${number} est bien enregistrée. La boutique vous confirmera rapidement.`,
  en: ({ store, number }) =>
    `${store}: your reservation request ${number} has been recorded. The store will confirm shortly.`,
  it: ({ store, number }) =>
    `${store}: la tua richiesta di prenotazione ${number} è stata registrata. Il negozio confermerà a breve.`,
  nl: ({ store, number }) =>
    `${store}: je reserveringsaanvraag ${number} is geregistreerd. De winkel bevestigt binnenkort.`,
  pt: ({ store, number }) =>
    `${store}: o seu pedido de reserva ${number} foi registado. A loja irá confirmar em breve.`,
  de: ({ store, number }) =>
    `${store}: Ihre Reservierungsanfrage ${number} wurde erfasst. Der Shop bestätigt in Kürze.`,
  es: ({ store, number }) =>
    `${store}: tu solicitud de reserva ${number} ha sido registrada. La tienda confirmará en breve.`,
  pl: ({ store, number }) =>
    `${store}: Twoja prośba o rezerwację ${number} została zapisana. Sklep wkrótce potwierdzi.`,
}

function buildRecapSms(
  language: string,
  vars: { store: string; number: string },
): string {
  return (RECAP_SMS[language] ?? RECAP_SMS.en)(vars)
}

/** Deterministic non-deliverable email for callers who don't give one, so a
 * repeat caller (same number) dedupes to the same customer. */
function fallbackEmail(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  return `caller-${digits || 'unknown'}@phone.invalid`
}

const EMAIL_LOCALES = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt'] as const

function emailLocale(language: string): EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(language)
    ? (language as EmailLocale)
    : 'en'
}

/**
 * Email the store owner a callback request when the agent couldn't complete the
 * caller's need (booking blocked, phone bookings off, human unavailable). Sends
 * to the store email, falling back to the owner member. The link points at the
 * dashboard conversation so the owner can read it and — once the recording lands
 * after the call — replay it. Best-effort: the caller is never made to wait.
 */
async function notifyOwnerOfCallback(
  ctx: PhoneToolContext,
  params: { message: string; callbackNumber: string },
): Promise<void> {
  const [storeRow] = await db
    .select({ email: stores.email })
    .from(stores)
    .where(eq(stores.id, ctx.storeId))
    .limit(1)

  let to = storeRow?.email ?? null
  if (!to) {
    const owner = await db
      .select({ email: users.email })
      .from(storeMembers)
      .innerJoin(users, eq(storeMembers.userId, users.id))
      .where(
        and(
          eq(storeMembers.storeId, ctx.storeId),
          eq(storeMembers.role, 'owner'),
        ),
      )
      .limit(1)
    to = owner[0]?.email ?? null
  }
  if (!to) return

  const conversationUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/ai-advisor?conversation=${ctx.conversationId}`
  await sendPhoneCallbackLandlordEmail({
    to,
    storeId: ctx.storeId,
    storeName: ctx.storeName,
    callerPhone: params.callbackNumber,
    message: params.message,
    conversationUrl,
    locale: emailLocale(ctx.language),
  })
}

type PhoneItemInput = {
  productId: string
  quantity: number
  startDate: string
  endDate: string
}

/**
 * Resolve requested items to the reservation-item shape createReservation
 * expects (with a product snapshot). Prices here are only best-effort inputs —
 * createReservation recomputes the authoritative amounts server-side. Shared by
 * quote_reservation and create_reservation_hold so both see the same items.
 */
async function buildPhoneReservationItems(
  storeId: string,
  items: PhoneItemInput[],
) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      images: products.images,
      price: products.price,
      deposit: products.deposit,
    })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.status, 'active'),
        inArray(products.id, productIds),
      ),
    )
  const productById = new Map(rows.map((row) => [row.id, row]))

  let subtotalAmount = 0
  let depositAmount = 0
  const reservationItems: Array<{
    productId: string
    quantity: number
    startDate: string
    endDate: string
    unitPrice: number
    depositPerUnit: number
    productSnapshot: { name: string; description: string | null; images: string[] }
  }> = []
  for (const item of items) {
    const product = productById.get(item.productId)
    if (!product) return { error: 'One or more products were not found.' as const }
    const unitPrice = Number(product.price) || 0
    const depositPerUnit = Number(product.deposit) || 0
    subtotalAmount += unitPrice * item.quantity
    depositAmount += depositPerUnit * item.quantity
    reservationItems.push({
      productId: item.productId,
      quantity: item.quantity,
      startDate: item.startDate,
      endDate: item.endDate,
      unitPrice,
      depositPerUnit,
      productSnapshot: {
        name: product.name,
        description: product.description ?? null,
        images: product.images ?? [],
      },
    })
  }
  return { reservationItems, subtotalAmount, depositAmount }
}

/**
 * Tools for the AI phone receptionist. Reuses the advisor's READ tools verbatim
 * (catalog, availability, store info, qualification) and adds voice-specific
 * write/control tools. There is no browser, so the advisor's cart/card tools
 * (add_to_cart, recommend_products) are intentionally omitted; a reservation is
 * created server-side and confirmed by SMS instead.
 *
 * Control tools (end_call, transfer_to_human) have NO execute: the model's call
 * signals intent to the route, which renders the matching TwiML (hang up / dial).
 */
export function createPhoneTools(ctx: PhoneToolContext) {
  const advisorTools = createAdvisorTools({
    storeId: ctx.storeId,
    storeSlug: ctx.storeSlug,
    conversationId: ctx.conversationId,
    cart: null,
  })

  // get_store_info is intentionally omitted: the store's hours, contact and
  // catalog are injected into the system prompt as a single source of truth, so
  // the model can't re-fetch and contradict itself on opening hours mid-call.
  const { list_products, get_product, check_availability, record_qualification } =
    advisorTools

  const create_reservation_hold = tool({
    description:
      'Register a PENDING reservation for the caller. Use ONLY after the product(s), exact rental dates, and the caller name are confirmed and check_availability passed. The store owner reviews and confirms it. On success the caller is texted a recap automatically.',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            productId: z.string().describe('The product ID'),
            quantity: z.number().int().min(1).max(999),
            startDate: z.string().describe('Rental start (ISO 8601 datetime)'),
            endDate: z.string().describe('Rental end (ISO 8601 datetime)'),
          }),
        )
        .min(1)
        .max(20),
      customer: z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phone: z
          .string()
          .max(32)
          .optional()
          .describe('Caller phone in international format; defaults to the calling number'),
        email: z
          .string()
          .email()
          .max(255)
          .optional()
          .describe('Only if the caller spells it out clearly'),
      }),
    }),
    execute: async ({ items, customer }) => {
      const built = await buildPhoneReservationItems(ctx.storeId, items)
      if ('error' in built) {
        return {
          ok: false,
          reason: describePhoneQuoteError('productNotFound', undefined, ctx.language),
        }
      }
      const { reservationItems, subtotalAmount, depositAmount } = built

      const phone = customer.phone?.trim() || ctx.callerPhone
      const email = customer.email?.trim() || fallbackEmail(phone)

      const result = await createReservation({
        storeId: ctx.storeId,
        customer: {
          email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone,
        },
        items: reservationItems,
        // Amounts are recomputed authoritatively server-side; these best-effort
        // values only feed mismatch logging (skipped for the phone source).
        subtotalAmount,
        depositAmount,
        totalAmount: subtotalAmount,
        locale: ctx.language === 'en' ? 'en' : 'fr',
        // A phone booking is always a pending REQUEST — never an online payment.
        source: 'phone',
      })

      if (
        !result ||
        'error' in result ||
        !('reservationId' in result) ||
        !result.reservationNumber
      ) {
        return {
          ok: false,
          reason: describePhoneQuoteError(
            result && 'error' in result ? result.error : undefined,
            result && 'errorParams' in result ? result.errorParams : undefined,
            ctx.language,
          ),
        }
      }

      // Link the phone conversation to the reservation (first link wins), so the
      // owner sees the transcript from the reservation. Done directly rather than
      // via createReservation's advisor gate, which targets the web checkout.
      await db
        .update(aiAdvisorConversations)
        .set({ reservationId: result.reservationId, updatedAt: new Date() })
        .where(
          and(
            eq(aiAdvisorConversations.id, ctx.conversationId),
            isNull(aiAdvisorConversations.reservationId),
          ),
        )

      // Best-effort SMS recap (never blocks the call).
      try {
        await sendSms({
          to: phone,
          message: buildRecapSms(ctx.language, {
            store: ctx.storeName,
            number: result.reservationNumber,
          }),
          isCommercial: false,
        })
      } catch (error) {
        log.error(
          'phone',
          `recap SMS failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }

      return {
        ok: true,
        booked: true,
        reservationNumber: result.reservationNumber,
        smsSent: Boolean(phone),
      }
    },
  })

  const quote_reservation = tool({
    description:
      'For the requested products and dates, this is the single source of truth: it returns { ok: true, total, deposit, currency } with the exact server-computed price, OR { ok: false, reason } when those dates cannot be booked (outside opening hours, below the minimum or above the maximum rental duration, not enough notice, or out of stock). It already checks availability, so you do NOT need check_availability during a booking. Call it before create_reservation_hold. If ok is false, tell the caller the reason plainly and propose one valid alternative — never invent a price, an opening-hour limit, or a reason it did not give you.',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            productId: z.string().describe('The product ID'),
            quantity: z.number().int().min(1).max(999),
            startDate: z.string().describe('Rental start (ISO 8601 datetime)'),
            endDate: z.string().describe('Rental end (ISO 8601 datetime)'),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ items }) => {
      const built = await buildPhoneReservationItems(ctx.storeId, items)
      if ('error' in built) {
        return {
          ok: false,
          reason: describePhoneQuoteError('productNotFound', undefined, ctx.language),
        }
      }

      const result = await createReservation({
        storeId: ctx.storeId,
        // Unused by the quote path (it returns before customer creation).
        customer: { email: '', firstName: '', lastName: '' },
        items: built.reservationItems,
        subtotalAmount: 0,
        depositAmount: 0,
        totalAmount: 0,
        locale: ctx.language === 'en' ? 'en' : 'fr',
        source: 'phone',
        quoteOnly: true,
      })

      // A quote runs the exact same validations as a real booking (opening
      // hours, advance notice, min/max duration, per-item stock). On failure we
      // hand the model a spoken reason it can relay — never a raw error key.
      if (!result || !('quote' in result) || !result.quote) {
        return {
          ok: false,
          reason: describePhoneQuoteError(
            result && 'error' in result ? result.error : undefined,
            result && 'errorParams' in result ? result.errorParams : undefined,
            ctx.language,
          ),
        }
      }
      const { subtotal, deposit, total, currency } = result.quote
      return { ok: true, subtotal, deposit, total, currency }
    },
  })

  const take_message = tool({
    description:
      "Hand the caller off to the store owner when you can't complete their request yourself — a booking that can't be made for a given reason, phone bookings being off, or a caller who wants a human who isn't available. The owner is emailed the message and will call the caller back, and it is also saved on the call record. Use this instead of looping when a booking keeps failing.",
    inputSchema: z.object({
      message: z
        .string()
        .max(1000)
        .describe(
          'What to pass to the owner, in the caller language: what the caller wants and — if a booking failed — the exact reason it could not be made.',
        ),
      callbackNumber: z
        .string()
        .max(32)
        .optional()
        .describe('Preferred callback number if different from the calling number'),
    }),
    execute: async ({ message, callbackNumber }) => {
      const payload = {
        message,
        callbackNumber: callbackNumber || ctx.callerPhone,
      }
      const result = await db
        .update(aiAdvisorConversations)
        .set({
          collectedData: sql`JSON_MERGE_PATCH(COALESCE(${aiAdvisorConversations.collectedData}, '{}'), ${JSON.stringify(payload)})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiAdvisorConversations.id, ctx.conversationId),
            eq(aiAdvisorConversations.storeId, ctx.storeId),
          ),
        )
      if (result[0].affectedRows === 0) {
        return { error: 'Conversation not found' }
      }

      // Email the owner so they can call the caller back — best-effort, never
      // blocks or fails the call.
      try {
        await notifyOwnerOfCallback(ctx, payload)
      } catch (error) {
        log.error(
          'phone',
          `owner callback email failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      return { saved: true }
    },
  })

  // Control tools: no `execute`. The route detects the call and renders TwiML.
  const end_call = tool({
    description:
      'End the call after a short goodbye. Call it once the caller is done or says goodbye.',
    inputSchema: z.object({}),
  })

  const transfer_to_human = tool({
    description:
      'Transfer the call to a human at the store. Use only when the caller explicitly asks for a person.',
    inputSchema: z.object({}),
  })

  return {
    list_products,
    get_product,
    check_availability,
    record_qualification,
    take_message,
    end_call,
    ...(ctx.canTakeReservations
      ? { quote_reservation, create_reservation_hold }
      : {}),
    ...(ctx.transferNumber ? { transfer_to_human } : {}),
  }
}
