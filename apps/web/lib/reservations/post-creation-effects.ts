import { after } from "next/server";

import { and, eq } from "drizzle-orm";

import { db, storeMembers, users } from "@louez/db";
import type { stores } from "@louez/db";

import { env } from "@/env";
import { notifyNewReservation } from "@/lib/discord/platform-notifications";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendNewRequestLandlordEmail } from "@/lib/email/send";
import { log } from "@/lib/evlog";
import { markReservationForCalendarSync } from "@/lib/integrations/calendar/sync";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";

import type { ResolvedDelivery } from "./resolve-delivery";
import type { ReservationTotals } from "./price-cart";

type StoreRow = typeof stores.$inferSelect;

export interface CreatedReservationSummary {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
  customerNotes: string | null;
}

export interface CreatedReservationCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface PostCreationEffectsInput {
  store: StoreRow;
  reservation: CreatedReservationSummary & { lineCount: number; totalQuantity: number };
  customer: CreatedReservationCustomer;
  totals: ReservationTotals;
  delivery: ResolvedDelivery;
  insurance: { amount: number; optIn: boolean };
  promoCodeUsed: boolean;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Run a side effect after the response when a request scope exists (server
 * action, route handler), otherwise inline. Failures are logged, never thrown.
 */
export const runAfterResponse = (task: () => Promise<void>): void => {
  const guarded = () =>
    task().catch((error: unknown) => {
      log.error("reservation", `deferred effect failed: ${describeError(error)}`);
    });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
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

/**
 * What happens once the reservation row exists, whatever the mode: the
 * funnel event (deferred past the response), the calendar sync and the
 * platform's internal Discord ping.
 */
export const runPostCreationEffects = async ({
  store,
  reservation,
  customer,
  totals,
  delivery,
  insurance,
  promoCodeUsed,
}: PostCreationEffectsInput): Promise<void> => {
  const currency = store.settings?.currency || "EUR";

  runAfterResponse(() =>
    captureProductServerEvent({
      distinctId: customer.id,
      event: productAnalyticsEvents.checkoutReservationCreated,
      properties: {
        feature: "checkout",
        surface: "storefront",
        store_id: store.id,
        reservation_id: reservation.id,
        customer_id: customer.id,
        source: "storefront_checkout",
        reservation_status: "pending",
        reservation_mode: store.settings?.reservationMode ?? null,
        catalog_line_count: reservation.lineCount,
        total_quantity: reservation.totalQuantity,
        has_delivery: delivery.hasAnyDelivery,
        has_outbound_delivery: delivery.hasOutboundDelivery,
        has_return_delivery: delivery.hasReturnDelivery,
        has_tulip_insurance: insurance.amount > 0,
        tulip_insurance_opt_in: insurance.optIn,
        promo_code_used: promoCodeUsed,
        payment_ready: Boolean(store.stripeAccountId && store.stripeChargesEnabled),
        subtotal_amount_cents: toAnalyticsAmountCents(totals.subtotal),
        discount_amount_cents: toAnalyticsAmountCents(totals.discount),
        delivery_fee_cents: toAnalyticsAmountCents(totals.deliveryFee),
        deposit_amount_cents: toAnalyticsAmountCents(totals.deposit),
        total_amount_cents: toAnalyticsAmountCents(totals.total),
        currency,
      },
    }),
  );

  try {
    await markReservationForCalendarSync(store.id, reservation.id);
  } catch (error) {
    log.error({
      calendar: {
        event: "reservation_sync_enqueue_failed",
        storeId: store.id,
        reservationId: reservation.id,
        error: describeError(error),
      },
    });
  }

  notifyNewReservation(
    { id: store.id, name: store.name, slug: store.slug },
    {
      number: reservation.number,
      customerName: `${customer.firstName} ${customer.lastName}`,
      totalAmount: totals.total,
      currency: store.settings?.currency,
    },
  ).catch(() => {});
};

/**
 * "Request received" notifications: customer (email/SMS), landlord email and
 * admin channels. Only meaningful when the reservation IS a request the owner
 * must review, that is in request mode or when a payment-mode checkout could
 * not start its Stripe session. In payment mode the webhook notifies on
 * payment instead, so an abandoned Stripe session no longer emails anyone.
 */
export const notifyRequestReceived = async ({
  store,
  reservation,
  customer,
  totals,
}: {
  store: StoreRow;
  reservation: CreatedReservationSummary;
  customer: CreatedReservationCustomer;
  totals: ReservationTotals;
}): Promise<void> => {
  const reservationSummary = {
    id: reservation.id,
    number: reservation.number,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    totalAmount: totals.total,
  };

  dispatchCustomerNotification("customer_request_received", {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      address: store.address,
      phone: store.phone,
      theme: store.theme,
      settings: store.settings,
      emailSettings: store.emailSettings,
      customerNotificationSettings: store.customerNotificationSettings,
    },
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    },
    reservation: {
      ...reservationSummary,
      subtotalAmount: totals.subtotal,
      depositAmount: totals.deposit,
      taxEnabled: totals.taxEnabled,
      taxRate: totals.taxRate,
      subtotalExclTax: totals.subtotalExclTax,
      taxAmount: totals.taxAmount,
    },
  }).catch((error: unknown) => {
    log.error("reservation", `customer request notification failed: ${describeError(error)}`);
  });

  // Landlord "new request" email, always in the store's language.
  const landlordEmail = store.email || (await findOwnerEmail(store.id));
  if (landlordEmail) {
    sendNewRequestLandlordEmail({
      to: landlordEmail,
      store: {
        id: store.id,
        name: store.name,
        logoUrl: store.logoUrl,
        darkLogoUrl: store.darkLogoUrl,
        email: store.email,
        phone: store.phone,
        address: store.address,
        theme: store.theme,
        settings: store.settings,
      },
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      },
      reservation: {
        ...reservationSummary,
        customerNotes: reservation.customerNotes,
      },
      dashboardUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservation.id}`,
      locale: getLocaleFromCountry(store.settings?.country),
    }).catch((error: unknown) => {
      log.error("reservation", `landlord request email failed: ${describeError(error)}`);
    });
  }

  dispatchNotification("reservation_new", {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: reservationSummary,
    customer: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    },
  }).catch((error: unknown) => {
    log.error("reservation", `new reservation notification failed: ${describeError(error)}`);
  });
};
