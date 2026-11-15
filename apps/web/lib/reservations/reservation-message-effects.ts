import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
  EffectSendOutcome,
} from "@louez/api/platform/effects";
import { db, reservationItems, reservations, stores } from "@louez/db";
import { isEmailConfigured } from "@louez/email";
import { withCustomerNotificationDefaults } from "@louez/types";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { ensureReservationInstantAccessUrl } from "@/lib/customer-auth/instant-access";
import { sendPlatformReservationCreated } from "@/lib/discord/platform-notifications";
import { isEmailDelivered } from "@/lib/email/send";
import { sendCustomerNotificationChannel } from "@/lib/notifications/customer-dispatcher";
import { sendReservationModificationEmailForStore } from "@/lib/reservations/modification-email";
import { getStorefrontUrl } from "@/lib/storefront-url";

// The senders of the messages a reservation write promises (packages/api
// platform/effects.ts): the customer's e-mail of a date change, of a quote
// and of a booking the store created confirmed, and the platform's notice of
// a new reservation. Each reads its row's payload through its schema (a row
// written wrong is abandoned at once, kept for whoever looks), then the
// reservation, the store and their settings as they are when it goes out;
// the customer's address is the one the write announced. An e-mail keys its
// `sent` log row on the outbox row, so a run after a lost outcome sends
// nothing again once it is known to have gone out. It throws when nothing
// went out (the row is retried) and answers `skipped` when there is nothing
// to send.

type MessageEffectType =
  | "reservation.modifiedEmail"
  | "reservation.quoteEmail"
  | "reservation.confirmationEmail"
  | "reservation.createdPlatformNotification";

const id = z.string().min(1).max(21);
const address = z.string().trim().min(1).max(255);
const instant = z.iso.datetime();
const amount = z.string().regex(/^-?\d+(\.\d+)?$/);
const customerEmail = z.object({ storeId: id, reservationId: id, to: address });

const PAYLOADS: { [K in MessageEffectType]: z.ZodType<ApiEffectPayloads[K]> } = {
  "reservation.modifiedEmail": z.object({
    storeId: id,
    reservationId: id,
    to: address,
    previousPeriod: z.object({ startDate: instant, endDate: instant }),
    userId: z.string().min(1).nullable(),
  }),
  "reservation.quoteEmail": customerEmail,
  "reservation.confirmationEmail": customerEmail,
  "reservation.createdPlatformNotification": z.object({
    channel: z.enum(["discord", "fromhello"]),
    storeId: id,
    reservationId: id,
    totalAmount: amount,
  }),
};

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface ReservationMessageEffectDeps {
  sendPlatformReservationCreated: typeof sendPlatformReservationCreated;
}

const defaultDeps: ReservationMessageEffectDeps = { sendPlatformReservationCreated };

/** The statuses in which a booking the store created confirmed is still one. */
const CONFIRMED = new Set(["confirmed", "ongoing", "completed"]);

/** The store's columns a customer e-mail shows. */
const STORE_COLUMNS = {
  id: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  logoUrl: true,
  darkLogoUrl: true,
  theme: true,
  settings: true,
  emailSettings: true,
  customerNotificationSettings: true,
} as const;

/** The reservation, its store, customer and lines, as a customer e-mail shows them now. */
async function loadReservation(storeId: string, reservationId: string) {
  return db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    columns: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      subtotalAmount: true,
      depositAmount: true,
      taxRate: true,
      subtotalExclTax: true,
      taxAmount: true,
      locale: true,
      currency: true,
    },
    with: {
      store: { columns: STORE_COLUMNS },
      customer: { columns: { id: true, firstName: true, lastName: true, phone: true } },
      items: {
        columns: { productSnapshot: true, quantity: true, unitPrice: true, totalPrice: true },
        orderBy: [asc(reservationItems.createdAt), asc(reservationItems.id)],
      },
    },
  });
}

type LoadedReservation = NonNullable<Awaited<ReturnType<typeof loadReservation>>>;

/** The quote's or the confirmation's e-mail, through the customer dispatcher's strict channel. */
async function sendCreationEmail(
  event: "customer_quote_sent" | "customer_reservation_confirmed",
  payload: ApiEffectPayloads["reservation.quoteEmail"],
  context: EffectSendContext,
): Promise<EffectSendOutcome> {
  if (await isEmailDelivered(context.effectId)) return undefined;
  if (!isEmailConfigured()) return { skipped: "email_not_configured" };

  const reservation = await loadReservation(payload.storeId, payload.reservationId);
  if (!reservation) return { skipped: "the reservation is gone" };
  const quote = event === "customer_quote_sent";
  if (quote ? reservation.status !== "quote" : !CONFIRMED.has(reservation.status)) {
    return { skipped: `the reservation is ${reservation.status} now` };
  }
  const { store, customer } = reservation;
  const prefs = withCustomerNotificationDefaults(store.customerNotificationSettings)[event];
  if (!prefs.enabled || !prefs.email) return { skipped: `the store turned off ${event} e-mails` };

  // The link that signs the customer in: to the quote, or to sign the contract.
  const accessUrl = await ensureReservationInstantAccessUrl({
    id: context.effectId,
    storeId: store.id,
    storeSlug: store.slug,
    customerEmail: payload.to,
    reservationId: reservation.id,
  });
  return sendCustomerNotificationChannel(
    event,
    {
      store,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: payload.to,
        phone: customer.phone,
      },
      reservation: reservationContext(reservation),
      items: reservation.items.map((item) => ({
        name: item.productSnapshot?.name || "Product",
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
      })),
      ...(quote
        ? { reservationUrl: accessUrl }
        : {
            reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservation.id}`),
            contractSignatureUrl: accessUrl,
          }),
    },
    "email",
    () => context.assertClaim(),
    context.effectId,
  );
}

const reservationContext = (reservation: LoadedReservation) => ({
  id: reservation.id,
  number: reservation.number,
  startDate: reservation.startDate,
  endDate: reservation.endDate,
  totalAmount: parseFloat(reservation.totalAmount),
  subtotalAmount: parseFloat(reservation.subtotalAmount),
  depositAmount: parseFloat(reservation.depositAmount),
  taxEnabled: !!reservation.taxRate,
  taxRate: reservation.taxRate ? parseFloat(reservation.taxRate) : null,
  subtotalExclTax: reservation.subtotalExclTax ? parseFloat(reservation.subtotalExclTax) : null,
  taxAmount: reservation.taxAmount ? parseFloat(reservation.taxAmount) : null,
  locale: reservation.locale,
  currency: reservation.currency,
});

export function createReservationMessageEffectSenders(
  overrides: Partial<ReservationMessageEffectDeps> = {},
): Pick<ApiEffectSenders, MessageEffectType> {
  const deps: ReservationMessageEffectDeps = { ...defaultDeps, ...overrides };

  // The payload read through its schema; every provider call under the
  // sender honours its abort (lib/api/effect-signal.ts).
  const reading =
    <K extends MessageEffectType>(
      type: K,
      send: (
        payload: ApiEffectPayloads[K],
        context: EffectSendContext,
      ) => Promise<EffectSendOutcome>,
    ) =>
    (payload: unknown, context: EffectSendContext) =>
      withEffectSignal(context, async () => {
        const read = PAYLOADS[type].safeParse(payload);
        if (!read.success) {
          return { abandoned: `not a ${type} payload: ${z.prettifyError(read.error)}` };
        }
        return send(read.data, context);
      });

  return {
    "reservation.modifiedEmail": reading("reservation.modifiedEmail", async (payload, context) => {
      if (!isEmailConfigured()) return { skipped: "email_not_configured" };
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, payload.storeId),
        columns: STORE_COLUMNS,
      });
      if (!store) return { skipped: "the store is gone" };
      const sent = await sendReservationModificationEmailForStore({
        store,
        reservationId: payload.reservationId,
        previousPeriod: {
          startDate: new Date(payload.previousPeriod.startDate),
          endDate: new Date(payload.previousPeriod.endDate),
        },
        userId: payload.userId,
        to: payload.to,
        delivery: { key: context.effectId, beforeSend: () => context.assertClaim() },
      });
      if (sent.status === "not_found") return { skipped: "the reservation is gone" };
      if (sent.status === "failed") throw sent.error;
      return undefined;
    }),
    "reservation.quoteEmail": reading("reservation.quoteEmail", (payload, context) =>
      sendCreationEmail("customer_quote_sent", payload, context),
    ),
    "reservation.confirmationEmail": reading("reservation.confirmationEmail", (payload, context) =>
      sendCreationEmail("customer_reservation_confirmed", payload, context),
    ),
    "reservation.createdPlatformNotification": reading(
      "reservation.createdPlatformNotification",
      async (payload, context) => {
        const reservation = await loadReservation(payload.storeId, payload.reservationId);
        if (!reservation) return { skipped: "the reservation is gone" };
        const { store, customer } = reservation;
        return deps.sendPlatformReservationCreated(
          payload.channel,
          { id: store.id, name: store.name, slug: store.slug },
          {
            number: reservation.number,
            customerName: `${customer.firstName} ${customer.lastName}`,
            totalAmount: parseFloat(payload.totalAmount),
            currency: reservation.currency ?? store.settings?.currency,
          },
          () => context.assertClaim(),
        );
      },
    ),
  };
}
