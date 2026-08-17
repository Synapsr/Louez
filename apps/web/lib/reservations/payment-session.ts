import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, payments, reservationActivity, reservations, stores } from "@louez/db";

import { env } from "@/env";
import { timingSafeEqualStrings } from "@/lib/catalog-auth";
import { buildFeeMetadata, getStoreBilling, planStripeFees } from "@/lib/pay-as-you-go";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { createCheckoutSession, toStripeCents } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";

export async function createReservationPaymentSessionForCustomer(
  storeSlug: string,
  reservationId: string,
  customerId: string,
  source: "account_page" | "quote_acceptance" | "marketplace",
  options?: {
    allowPendingReservation?: boolean;
    successUrl?: string;
    cancelUrl?: string;
    marketplaceSecret?: string;
  },
) {
  try {
    let isVerifiedMarketplaceSource = false;
    if (source === "marketplace") {
      if (
        !env.MARKETPLACE_CATALOG_SECRET ||
        !options?.marketplaceSecret ||
        !(await timingSafeEqualStrings(env.MARKETPLACE_CATALOG_SECRET, options.marketplaceSecret))
      ) {
        return { error: "errors.invalidData" };
      }
      isVerifiedMarketplaceSource = true;
    }

    const allowPendingReservation =
      isVerifiedMarketplaceSource && options?.allowPendingReservation === true;
    const successUrl = isVerifiedMarketplaceSource ? options?.successUrl : undefined;
    const cancelUrl = isVerifiedMarketplaceSource ? options?.cancelUrl : undefined;

    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, storeSlug),
    });

    if (!store) {
      return { error: "errors.storeNotFound" };
    }

    const stripeAccountId = store.stripeAccountId;
    if (!stripeAccountId || !store.stripeChargesEnabled) {
      return { error: "errors.paymentNotAvailable" };
    }

    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
        eq(reservations.customerId, customerId),
      ),
      with: {
        customer: true,
        items: true,
        payments: true,
      },
    });

    if (!reservation) {
      return { error: "errors.reservationNotFound" };
    }

    const allowedStatuses = allowPendingReservation
      ? ["pending", "confirmed", "ongoing"]
      : ["confirmed", "ongoing"];
    if (!allowedStatuses.includes(reservation.status)) {
      return { error: "errors.invalidStatus" };
    }

    const isPaid = reservation.payments.some(
      (payment) => payment.type === "rental" && payment.status === "completed",
    );
    if (isPaid) {
      return { error: "errors.alreadyPaid" };
    }

    const currency = store.settings?.currency || "EUR";
    const chargeCents = toStripeCents(Number.parseFloat(reservation.totalAmount), currency);
    if (chargeCents <= 0) {
      return { success: true, paymentUrl: null };
    }

    const pendingPayments = reservation.payments.filter(
      (payment) => payment.type === "rental" && payment.status === "pending",
    );
    for (const pending of pendingPayments) {
      if (pending.stripeCheckoutSessionId) {
        try {
          await getStripe().checkout.sessions.expire(pending.stripeCheckoutSessionId, {
            stripeAccount: stripeAccountId,
          });
        } catch {
          // Session may already be expired or completed.
        }
      }
      await db
        .update(payments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(payments.id, pending.id));
    }

    const lineItems = [
      {
        name: `Reservation #${reservation.number}`,
        quantity: 1,
        unitAmount: chargeCents,
      },
    ];

    const billing = await getStoreBilling(store.id);
    const feePlan = await planStripeFees({
      storeId: store.id,
      reservationId,
      chargeCents,
      billing,
    });

    const { url, sessionId, expiresAt } = await createCheckoutSession({
      stripeAccountId,
      reservationId,
      reservationNumber: reservation.number,
      customerEmail: reservation.customer.email,
      customerName: `${reservation.customer.firstName} ${reservation.customer.lastName}`,
      lineItems,
      depositAmount: toStripeCents(Number.parseFloat(reservation.depositAmount), currency),
      currency,
      applicationFeeAmount: feePlan.applicationFeeCents,
      feeMetadata: buildFeeMetadata(feePlan),
      successUrl:
        successUrl ??
        getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=success`),
      cancelUrl:
        cancelUrl ??
        getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=cancelled`),
    });

    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: reservation.totalAmount,
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: sessionId,
      currency,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "payment_initiated",
      metadata: { checkoutSessionId: sessionId, source },
      createdAt: new Date(),
    });

    await captureProductServerEvent({
      distinctId: customerId,
      event: productAnalyticsEvents.checkoutPaymentStarted,
      properties: {
        feature: "customer_account",
        surface: "storefront",
        store_id: store.id,
        reservation_id: reservationId,
        customer_id: customerId,
        source,
        payment_provider: "stripe",
        payment_mode: "full",
        amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
        total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
        deposit_amount_cents: toAnalyticsAmountCents(reservation.depositAmount),
        application_fee_cents: feePlan.applicationFeeCents,
        reservation_fee_cents: feePlan.reservationFeeCents,
        currency,
      },
    });

    return { success: true, paymentUrl: url, sessionId, expiresAt };
  } catch (error) {
    console.error("Error creating payment session:", error);
    return { error: "errors.paymentSessionError" };
  }
}
