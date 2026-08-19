"use server";

import { revalidatePath } from "next/cache";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@louez/db";
import { reservationActivity, reservations, stores } from "@louez/db";

import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import {
  recordMarketplaceFee,
  recordReservationFee,
  voidReservationFee,
} from "@/lib/pay-as-you-go";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { createReservationPaymentSessionForCustomer } from "@/lib/reservations/payment-session";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";
import { getStorefrontUrl } from "@/lib/storefront-url";

import { getCustomerSession } from "../../actions";

export async function createReservationPaymentSession(storeSlug: string, reservationId: string) {
  const session = await getCustomerSession(storeSlug);
  if (!session) {
    return { error: "errors.unauthorized" };
  }

  return createReservationPaymentSessionForCustomer(
    storeSlug,
    reservationId,
    session.customerId,
    "account_page",
  );
}

export async function acceptQuote(storeSlug: string, reservationId: string) {
  const session = await getCustomerSession(storeSlug);
  if (!session) {
    return { error: "errors.unauthorized" };
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  });

  if (!store) {
    return { error: "errors.storeNotFound" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
    with: {
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (reservation.status !== "quote") {
    return { error: "errors.invalidStatus" };
  }

  const accepted = await db.transaction(async (tx) => {
    const result = await tx
      .update(reservations)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.storeId, store.id),
          eq(reservations.customerId, session.customerId),
          eq(reservations.status, "quote"),
        ),
      );

    if ((result[0]?.affectedRows ?? 0) === 0) {
      return false;
    }

    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "quote_accepted",
      metadata: { source: "quote_acceptance", actor: "customer" },
      createdAt: new Date(),
    });

    return true;
  });

  if (!accepted) {
    return { error: "errors.invalidStatus" };
  }

  await captureProductServerEvent({
    distinctId: session.customerId,
    event: productAnalyticsEvents.quoteAccepted,
    properties: {
      feature: "customer_account",
      surface: "storefront",
      store_id: store.id,
      reservation_id: reservationId,
      customer_id: session.customerId,
      source: "customer_account",
      reservation_mode: getEffectiveReservationMode(store),
      catalog_line_count: reservation.items.length,
      total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
      deposit_amount_cents: toAnalyticsAmountCents(reservation.depositAmount),
      currency: store.settings?.currency || "EUR",
    },
  });

  let paymentUrl: string | null = null;
  if (getEffectiveReservationMode(store) === "payment") {
    const paymentSession = await createReservationPaymentSessionForCustomer(
      storeSlug,
      reservationId,
      session.customerId,
      "quote_acceptance",
    );
    if (paymentSession.success) {
      paymentUrl = paymentSession.paymentUrl;
    } else if (paymentSession.error !== "errors.alreadyPaid") {
      console.error("Failed to create quote acceptance payment session:", {
        reservationId,
        error: paymentSession.error,
      });
    }
  }

  // Pay-as-you-go: an accepted quote is now a confirmed, billable location. If an
  // online payment session was created, the webhook upgrades this manual pending fee
  // to an online collected fee using the Stripe application-fee metadata.
  try {
    await Promise.all([
      recordReservationFee({
        storeId: store.id,
        reservationId,
        source: "manual",
      }),
      ...(reservation.source === "marketplace"
        ? [
            recordMarketplaceFee({
              storeId: store.id,
              reservationId,
              source: "manual",
            }),
          ]
        : []),
    ]);
  } catch (error) {
    console.error("[payg] Failed to record accepted-quote location:", {
      reservationId,
      error,
    });
  }

  // Notify the store owner
  dispatchNotification("reservation_confirmed", {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    console.error("Failed to dispatch quote accepted notification:", error);
  });

  // Notify the customer with confirmation email
  const reservationUrl = getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}`);

  const emailItems = reservation.items.map((item) => ({
    name: item.productSnapshot?.name || "Product",
    quantity: item.quantity,
    unitPrice: parseFloat(item.unitPrice),
    totalPrice: parseFloat(item.totalPrice),
  }));

  try {
    const contractUrl = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug,
      customerEmail: reservation.customer.email,
      reservationId,
      redirectPath: `/account/reservations/${reservationId}/contract`,
    });
    const termsUrl = store.cgv?.trim() ? getStorefrontUrl(storeSlug, "/terms") : null;

    dispatchCustomerNotification("customer_quote_accepted", {
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
        id: reservation.customer.id,
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
        email: reservation.customer.email,
        phone: reservation.customer.phone,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: parseFloat(reservation.totalAmount),
        subtotalAmount: parseFloat(reservation.subtotalAmount),
        depositAmount: parseFloat(reservation.depositAmount),
      },
      items: emailItems,
      reservationUrl,
      contractUrl,
      termsUrl,
      paymentUrl,
    }).catch((error) => {
      console.error("Failed to dispatch quote accepted customer notification:", error);
    });
  } catch (error) {
    console.error("Failed to dispatch quote accepted customer notification:", error);
  }

  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`);
  return { success: true, paymentUrl };
}

export async function declineQuote(storeSlug: string, reservationId: string) {
  const session = await getCustomerSession(storeSlug);
  if (!session) {
    return { error: "errors.unauthorized" };
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  });

  if (!store) {
    return { error: "errors.storeNotFound" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId),
    ),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (reservation.status !== "quote") {
    return { error: "errors.invalidStatus" };
  }

  // Move to declined
  await db
    .update(reservations)
    .set({ status: "declined", updatedAt: new Date() })
    .where(eq(reservations.id, reservationId));

  // Pay-as-you-go: void the pending reservation fee — the customer declined the quote,
  // so it must not be invoiced at month-end. (No-op if no fee / already collected.)
  try {
    await voidReservationFee(reservationId);
  } catch (error) {
    console.error("[payg] Failed to void declined-quote reservation fee:", {
      reservationId,
      error,
    });
  }

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: "quote_declined",
    metadata: { source: "quote_decline", actor: "customer" },
    createdAt: new Date(),
  });

  await captureProductServerEvent({
    distinctId: session.customerId,
    event: productAnalyticsEvents.quoteDeclined,
    properties: {
      feature: "customer_account",
      surface: "storefront",
      store_id: store.id,
      reservation_id: reservationId,
      customer_id: session.customerId,
      source: "customer_account",
      total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
      currency: store.settings?.currency || "EUR",
    },
  });

  // Notify the store owner
  dispatchNotification("reservation_cancelled", {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    console.error("Failed to dispatch quote declined notification:", error);
  });

  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`);
  return { success: true };
}
