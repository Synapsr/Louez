import { and, eq } from "drizzle-orm";

import { db, storeMembers, stores, users } from "@louez/db";
import type { NotificationEventType } from "@louez/types";

import { env } from "@/env";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendNewRequestLandlordEmail, sendPaymentAdminEmail } from "@/lib/email/send";
import type { PaymentAdminEmailKind } from "@/lib/email/templates";

import type { NotificationContext } from "./dispatcher";
import { paymentCurrencyOf, reservationCurrencyOf } from "./util.notification-currency";

/**
 * The store owner's email for an event, sent by dispatchNotification when the
 * store keeps that event's email channel on. Only the events below have an owner
 * template; any other event answers "not sent" rather than pretending.
 */
type AdminEmailEvent = Extract<
  NotificationEventType,
  "reservation_new" | "payment_received" | "payment_failed" | "payment_disputed"
>;

const ADMIN_EMAIL_EVENTS: readonly AdminEmailEvent[] = [
  "reservation_new",
  "payment_received",
  "payment_failed",
  "payment_disputed",
];

const PAYMENT_EMAIL_KINDS: Record<
  Exclude<AdminEmailEvent, "reservation_new">,
  PaymentAdminEmailKind
> = {
  payment_received: "received",
  payment_failed: "failed",
  payment_disputed: "disputed",
};

export const hasAdminEmail = (eventType: NotificationEventType): eventType is AdminEmailEvent =>
  ADMIN_EMAIL_EVENTS.some((event) => event === eventType);

export interface AdminEmailResult {
  sent: boolean;
  error?: string;
}

export type AdminEmailStore = NonNullable<Awaited<ReturnType<typeof loadAdminEmailStore>>>;

const loadAdminEmailStore = async (storeId: string) => {
  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      email: stores.email,
      logoUrl: stores.logoUrl,
      darkLogoUrl: stores.darkLogoUrl,
      phone: stores.phone,
      address: stores.address,
      theme: stores.theme,
      settings: stores.settings,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return store ?? null;
};

const findOwnerEmail = async (storeId: string): Promise<string | null> => {
  const [owner] = await db
    .select({ email: users.email })
    .from(storeMembers)
    .innerJoin(users, eq(storeMembers.userId, users.id))
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, "owner")))
    .limit(1);
  return owner?.email ?? null;
};

/** What the owner email reads and sends with. A test replaces it. */
export interface AdminEmailDeps {
  loadStore: (storeId: string) => Promise<AdminEmailStore | null>;
  findOwnerEmail: (storeId: string) => Promise<string | null>;
  sendNewRequestLandlordEmail: typeof sendNewRequestLandlordEmail;
  sendPaymentAdminEmail: typeof sendPaymentAdminEmail;
}

const defaultDeps: AdminEmailDeps = {
  loadStore: loadAdminEmailStore,
  findOwnerEmail,
  sendNewRequestLandlordEmail,
  sendPaymentAdminEmail,
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Send the owner's email for an event: to the store's address, or to the owner's
 * account when the store has none, in the store's language. Never throws.
 */
export async function sendAdminEventEmail(
  eventType: NotificationEventType,
  ctx: NotificationContext,
  deps: AdminEmailDeps = defaultDeps,
): Promise<AdminEmailResult> {
  if (!hasAdminEmail(eventType)) return { sent: false, error: "No email for this event" };
  const { reservation, customer } = ctx;
  if (!reservation) return { sent: false, error: "No reservation" };

  try {
    const store = await deps.loadStore(ctx.store.id);
    if (!store) return { sent: false, error: "Store not found" };
    const to = store.email || (await deps.findOwnerEmail(store.id));
    if (!to) return { sent: false, error: "No owner email" };

    const locale = getLocaleFromCountry(store.settings?.country);
    const dashboardUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservation.id}`;

    if (eventType === "reservation_new") {
      if (!customer) return { sent: false, error: "No customer" };
      await deps.sendNewRequestLandlordEmail({
        to,
        store,
        customer,
        reservation,
        dashboardUrl,
        locale,
      });
    } else {
      await deps.sendPaymentAdminEmail({
        to,
        kind: PAYMENT_EMAIL_KINDS[eventType],
        store,
        customer,
        reservation,
        amount: ctx.payment?.amount ?? reservation.totalAmount,
        amountCurrency: paymentCurrencyOf(ctx),
        reservationCurrency: reservationCurrencyOf(ctx),
        dashboardUrl,
        locale,
      });
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, error: describeError(error) };
  }
}
