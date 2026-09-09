import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, payments, reservationActivity, reservations, stores } from "@louez/db";

import { env } from "@/env";
import { timingSafeEqualStrings } from "@/lib/catalog-auth";
import { log } from "@/lib/evlog";
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
  source: "account_page" | "quote_acceptance" | "marketplace" | "checkout_resume",
  options?: {
    allowPendingReservation?: boolean;
    successUrl?: string;
    cancelUrl?: string;
    marketplaceSecret?: string;
    /** Trusted callers only: charge this instead of the reservation total (partial deposits). */
    chargeAmount?: number;
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

    // The checkout cancelled page resumes a pending online checkout server-side;
    // it is as trusted as the marketplace secret.
    const isTrustedCaller = isVerifiedMarketplaceSource || source === "checkout_resume";
    const allowPendingReservation = isTrustedCaller && options?.allowPendingReservation === true;
    const successUrl = isTrustedCaller ? options?.successUrl : undefined;
    const cancelUrl = isTrustedCaller ? options?.cancelUrl : undefined;

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
    const chargeAmount =
      isTrustedCaller && options?.chargeAmount !== undefined
        ? options.chargeAmount
        : Number.parseFloat(reservation.totalAmount);
    const chargeCents = toStripeCents(chargeAmount, currency);
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
      includeMarketplaceFee: reservation.source === "marketplace",
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

    // The pending payment and its activity land together or not at all.
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(payments).values({
        id: nanoid(),
        reservationId,
        amount: chargeAmount.toFixed(2),
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: sessionId,
        currency,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: "payment_initiated",
        metadata: { checkoutSessionId: sessionId, source },
        createdAt: now,
      });
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
        amount_cents: toAnalyticsAmountCents(chargeAmount),
        total_amount_cents: toAnalyticsAmountCents(reservation.totalAmount),
        deposit_amount_cents: toAnalyticsAmountCents(reservation.depositAmount),
        application_fee_cents: feePlan.applicationFeeCents,
        reservation_fee_cents: feePlan.reservationFeeCents,
        marketplace_fee_cents: feePlan.marketplaceFeeCents,
        currency,
      },
    });

    return { success: true, paymentUrl: url, sessionId, expiresAt };
  } catch (error) {
    log.error({
      checkout: {
        event: "payment_session_failed",
        reservationId,
        source,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { error: "errors.paymentSessionError" };
  }
}
