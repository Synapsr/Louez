import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, reservationActivity, reservations, type stores } from "@louez/db";

import { getLocaleFromCountry } from "@/lib/email/i18n";
import { isEmailDelivered, sendReservationModifiedEmail } from "@/lib/email/send";
import { getStorefrontUrl } from "@/lib/storefront-url";

type StoreRow = typeof stores.$inferSelect;

/** The store as the modification e-mail shows it. */
export type ModificationEmailStore = Pick<
  StoreRow,
  | "id"
  | "name"
  | "slug"
  | "logoUrl"
  | "darkLogoUrl"
  | "email"
  | "phone"
  | "address"
  | "theme"
  | "settings"
  | "emailSettings"
>;

/** The reservation's activity row of the e-mail, as its timeline shows it. */
async function recordActivity(
  reservationId: string,
  userId: string | null,
  to: string,
  outcome: "sent" | "failed",
  id: string = nanoid(),
) {
  await db
    .insert(reservationActivity)
    .values({
      id,
      reservationId,
      userId,
      activityType: "note_updated",
      metadata: { templateId: "reservation_modified", to, customerEmailNotification: outcome },
    })
    // A run that finds the e-mail already sent writes its row once.
    .onDuplicateKeyUpdate({ set: { id } });
}

/**
 * The customer's e-mail that their reservation changed, from the previous
 * period to its dates now, and its activity row. Needs no session: the
 * dashboard's send (reservations/actions.ts) passes its store, and the
 * outbox's (reservation-message-effects.ts) the store of its row.
 *
 * Given a `delivery`, the outbox's: the e-mail's `sent` log row and its
 * activity row take the key, so a run after a lost outcome sends nothing
 * again once the e-mail is known to have gone out, and a failed attempt adds
 * no activity row (the outbox retries it, and its give-up shows in the inbox).
 */
export async function sendReservationModificationEmailForStore({
  store,
  reservationId,
  previousPeriod,
  userId,
  to,
  delivery,
}: {
  store: ModificationEmailStore;
  reservationId: string;
  previousPeriod?: { startDate: Date; endDate: Date };
  /** Who made the change, for the activity row. */
  userId: string | null;
  /** The address to send to; by default the customer's now. */
  to?: string;
  delivery?: { key: string; beforeSend: () => Promise<void> };
}): Promise<
  | { status: "not_found" }
  | { status: "sent"; to: string }
  | { status: "failed"; to: string; error: unknown }
> {
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: { customer: true },
  });
  if (!reservation) return { status: "not_found" };

  const recipient = to ?? reservation.customer.email;
  if (delivery && (await isEmailDelivered(delivery.key))) {
    await recordActivity(reservationId, userId, recipient, "sent", delivery.key);
    return { status: "sent", to: recipient };
  }

  try {
    await delivery?.beforeSend();
    await sendReservationModifiedEmail({
      to: recipient,
      store,
      customer: {
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
        email: reservation.customer.email,
      },
      reservation: {
        id: reservation.id,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
      },
      previousPeriod,
      reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`),
      locale: getLocaleFromCountry(store.settings?.country),
      logId: delivery?.key,
    });
    await recordActivity(reservationId, userId, recipient, "sent", delivery?.key);
    return { status: "sent", to: recipient };
  } catch (error) {
    if (!delivery) await recordActivity(reservationId, userId, recipient, "failed");
    return { status: "failed", to: recipient, error };
  }
}
