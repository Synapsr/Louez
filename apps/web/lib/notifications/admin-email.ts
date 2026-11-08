import { and, eq } from "drizzle-orm";

import { db, storeMembers, stores, users } from "@louez/db";
import type { NotificationEventType } from "@louez/types";

import { env } from "@/env";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import {
  sendNewRequestLandlordEmail,
  sendPaymentAdminEmail,
  sendStatusChangeAdminEmail,
} from "@/lib/email/send";
import type { PaymentAdminEmailKind, StatusChangeAdminEmailKind } from "@/lib/email/templates";

import type { NotificationContext } from "./dispatcher";
import { paymentCurrencyOf, reservationCurrencyOf } from "./util.notification-currency";

/**
 * The store owner's email for an event, sent by dispatchNotification when the
 * store keeps that event's email channel on. Only the events below have an owner
 * template, and a confirmation or a cancellation only when the customer made it;
 * anything else answers "not sent" rather than pretending. The admin reminders
 * send their own emails (dispatchAdminReminder).
 */
type AdminEmailEvent = Extract<
  NotificationEventType,
  | "reservation_new"
  | "reservation_confirmed"
  | "reservation_cancelled"
  | "payment_received"
  | "payment_failed"
  | "payment_disputed"
>;

const ADMIN_EMAIL_EVENTS: readonly AdminEmailEvent[] = [
  "reservation_new",
  "reservation_confirmed",
  "reservation_cancelled",
  "payment_received",
  "payment_failed",
  "payment_disputed",
];

const STATUS_EMAIL_KINDS: Record<
  Extract<AdminEmailEvent, "reservation_confirmed" | "reservation_cancelled">,
  StatusChangeAdminEmailKind
> = {
  reservation_confirmed: "confirmed",
  reservation_cancelled: "cancelled",
};

const PAYMENT_EMAIL_KINDS: Record<
  Exclude<AdminEmailEvent, "reservation_new" | keyof typeof STATUS_EMAIL_KINDS>,
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
  sendStatusChangeAdminEmail: typeof sendStatusChangeAdminEmail;
}

const defaultDeps: AdminEmailDeps = {
  loadStore: loadAdminEmailStore,
  findOwnerEmail,
  sendNewRequestLandlordEmail,
  sendPaymentAdminEmail,
  sendStatusChangeAdminEmail,
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
  const isStatusChange =
    eventType === "reservation_confirmed" || eventType === "reservation_cancelled";
  if (isStatusChange && ctx.actor !== "customer") {
    return { sent: false, error: "Only a change the customer made is emailed" };
  }

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
    } else if (eventType === "reservation_confirmed" || eventType === "reservation_cancelled") {
      await deps.sendStatusChangeAdminEmail({
        to,
        kind: STATUS_EMAIL_KINDS[eventType],
        store,
        customer,
        reservation,
        reservationCurrency: reservationCurrencyOf(ctx),
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
