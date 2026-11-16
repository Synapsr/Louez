import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
  EffectSendOutcome,
} from "@louez/api/platform/effects";
import { db, reservationItems, reservations } from "@louez/db";
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
// a new reservation.
//
// - A row sends only about its own store, reservation and customer: a
//   payload that names others is abandoned, never sent.
// - A payload is read through its schema: one recipient, ids of the id
//   shape, a plain amount. Anything else is abandoned.
// - An e-mail goes only to the address the write announced, while it is
//   still that customer's: else it is abandoned, nothing minted or sent.
// - Two classes of end, besides success. A message owed that cannot go out
//   (no e-mail service, the recipient changed, a row written wrong) is
//   `abandoned`, which the inbox shows as a message not sent. A message that
//   no longer applies (the reservation's status moved on, the store turned
//   that e-mail off) is `skipped`, the row `cancelled`, and alerts no one.
// - An e-mail keys its `sent` log row on the outbox row, so a run after a
//   lost outcome sends nothing again once it is known to have gone out.
//   A failure of the provider throws, and the row is retried.

type MessageEffectType =
  | "reservation.modifiedEmail"
  | "reservation.quoteEmail"
  | "reservation.confirmationEmail"
  | "reservation.createdPlatformNotification";

type EmailEffectType = Exclude<MessageEffectType, "reservation.createdPlatformNotification">;

/** A row id as the database keeps them (`varchar(21)`, nanoid's alphabet). */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,21}$/);
/** Exactly one address, as a customer's is validated: no list, no name, no line break. */
const address = z.email().max(255);
const instant = z.iso.datetime();
const period = z.object({ startDate: instant, endDate: instant });
/** A reservation's total as its `decimal(10,2)` column holds it, not negative. */
const amount = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/);
const creationEmail = z.object({ storeId: id, reservationId: id, to: address });

const PAYLOADS: { [K in MessageEffectType]: z.ZodType<ApiEffectPayloads[K]> } = {
  "reservation.modifiedEmail": z.object({
    storeId: id,
    reservationId: id,
    to: address,
    previousPeriod: period,
    period,
    userId: id.nullable(),
  }),
  "reservation.quoteEmail": creationEmail,
  "reservation.confirmationEmail": creationEmail,
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

/** The statuses in which each e-mail still says something true. */
const STILL_TRUE: Record<EmailEffectType, ReadonlySet<string>> = {
  "reservation.quoteEmail": new Set(["quote"]),
  "reservation.confirmationEmail": new Set(["confirmed", "ongoing", "completed"]),
  // A booking that ends without happening needs no word of its new dates.
  "reservation.modifiedEmail": new Set(["pending", "quote", "confirmed", "ongoing", "completed"]),
};

/** The store setting that turns each e-mail off; the modification e-mail has none. */
const SETTING: Partial<
  Record<EmailEffectType, "customer_quote_sent" | "customer_reservation_confirmed">
> = {
  "reservation.quoteEmail": "customer_quote_sent",
  "reservation.confirmationEmail": "customer_reservation_confirmed",
};

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

/** The reservation, its store, customer and lines, as a message shows them now. */
async function loadReservation(storeId: string, reservationId: string) {
  return db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    columns: {
      id: true,
      customerId: true,
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
      customer: {
        columns: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      items: {
        columns: { productSnapshot: true, quantity: true, unitPrice: true, totalPrice: true },
        orderBy: [asc(reservationItems.createdAt), asc(reservationItems.id)],
      },
    },
  });
}

type LoadedReservation = NonNullable<Awaited<ReturnType<typeof loadReservation>>>;

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a customer e-mail still goes out, read as it is now: the
 * reservation, its status and the store's setting, then its recipient. Null
 * when it does; otherwise how the row ends.
 */
function emailGate(
  type: EmailEffectType,
  reservation: LoadedReservation | undefined,
  to: string,
  context: EffectSendContext,
): Exclude<EffectSendOutcome, void> | null {
  if (!reservation) return { skipped: "reservation_gone: the reservation is gone" };
  if (!STILL_TRUE[type].has(reservation.status)) {
    return { skipped: `obsolete: the reservation is ${reservation.status} now` };
  }
  const setting = SETTING[type];
  if (setting) {
    const prefs = withCustomerNotificationDefaults(reservation.store.customerNotificationSettings)[
      setting
    ];
    if (!prefs.enabled || !prefs.email) {
      return { skipped: `turned_off: the store turned off ${setting} e-mails` };
    }
  }
  if (
    reservation.customerId !== context.row.customerId ||
    !sameAddress(reservation.customer.email, to)
  ) {
    return {
      abandoned:
        "recipient_changed: the reservation's customer or their address is not the one announced",
    };
  }
  return null;
}

/** The quote's or the confirmation's e-mail, through the customer dispatcher's strict channel. */
async function sendCreationEmail(
  type: "reservation.quoteEmail" | "reservation.confirmationEmail",
  payload: ApiEffectPayloads["reservation.quoteEmail"],
  context: EffectSendContext,
): Promise<EffectSendOutcome> {
  if (await isEmailDelivered(context.effectId)) return undefined;
  if (!isEmailConfigured()) return NO_EMAIL;

  const reservation = await loadReservation(payload.storeId, payload.reservationId);
  const gate = emailGate(type, reservation, payload.to, context);
  if (gate || !reservation) return gate ?? undefined;
  const { store, customer } = reservation;
  const quote = type === "reservation.quoteEmail";

  // The link that signs the customer in: to the quote, or to sign the contract.
  const accessUrl = await ensureReservationInstantAccessUrl({
    id: context.effectId,
    storeId: store.id,
    storeSlug: store.slug,
    customerEmail: payload.to,
    reservationId: reservation.id,
  });
  return sendCustomerNotificationChannel(
    quote ? "customer_quote_sent" : "customer_reservation_confirmed",
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

/** No e-mail service on this instance: the message is owed, and cannot go out. */
const NO_EMAIL = { abandoned: "email_not_configured: no e-mail service is set up" } as const;

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

const datesOf = (dates: { startDate: string; endDate: string }) => ({
  startDate: new Date(dates.startDate),
  endDate: new Date(dates.endDate),
});

export function createReservationMessageEffectSenders(
  overrides: Partial<ReservationMessageEffectDeps> = {},
): Pick<ApiEffectSenders, MessageEffectType> {
  const deps: ReservationMessageEffectDeps = { ...defaultDeps, ...overrides };

  // The payload read through its schema and held to its row's own store,
  // reservation and customer; every provider call under the sender honours
  // its abort (lib/api/effect-signal.ts).
  const reading =
    <K extends MessageEffectType>(
      type: K,
      send: (
        payload: ApiEffectPayloads[K],
        context: EffectSendContext,
      ) => Promise<EffectSendOutcome>,
    ) =>
    (payload: unknown, context: EffectSendContext) =>
      withEffectSignal(context, async (): Promise<EffectSendOutcome> => {
        const read = PAYLOADS[type].safeParse(payload);
        if (!read.success) {
          return {
            abandoned: `invalid_payload: not a ${type} payload: ${z.prettifyError(read.error)}`,
            report: true,
          };
        }
        const { row } = context;
        const toCustomer = type !== "reservation.createdPlatformNotification";
        if (
          read.data.storeId !== row.storeId ||
          read.data.reservationId !== row.reservationId ||
          (toCustomer && !row.customerId)
        ) {
          return {
            abandoned: "row_mismatch: the payload names another store, reservation or customer",
            report: true,
          };
        }
        return send(read.data, context);
      });

  return {
    "reservation.modifiedEmail": reading("reservation.modifiedEmail", async (payload, context) => {
      const reservation = await loadReservation(payload.storeId, payload.reservationId);
      // Sent by an earlier run: the shared send only records its activity row.
      if (!(await isEmailDelivered(context.effectId))) {
        if (!isEmailConfigured()) return NO_EMAIL;
        const gate = emailGate("reservation.modifiedEmail", reservation, payload.to, context);
        if (gate) return gate;
      }
      if (!reservation) return { skipped: "reservation_gone: the reservation is gone" };
      const sent = await sendReservationModificationEmailForStore({
        store: reservation.store,
        reservationId: payload.reservationId,
        previousPeriod: datesOf(payload.previousPeriod),
        period: datesOf(payload.period),
        userId: payload.userId,
        to: payload.to,
        delivery: { key: context.effectId, beforeSend: () => context.assertClaim() },
      });
      if (sent.status === "not_found")
        return { skipped: "reservation_gone: the reservation is gone" };
      if (sent.status === "failed") throw sent.error;
      return undefined;
    }),
    "reservation.quoteEmail": reading("reservation.quoteEmail", (payload, context) =>
      sendCreationEmail("reservation.quoteEmail", payload, context),
    ),
    "reservation.confirmationEmail": reading("reservation.confirmationEmail", (payload, context) =>
      sendCreationEmail("reservation.confirmationEmail", payload, context),
    ),
    "reservation.createdPlatformNotification": reading(
      "reservation.createdPlatformNotification",
      async (payload, context) => {
        const reservation = await loadReservation(payload.storeId, payload.reservationId);
        if (!reservation) return { skipped: "reservation_gone: the reservation is gone" };
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
