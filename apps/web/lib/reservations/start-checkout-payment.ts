import { nanoid } from "nanoid";

import { db, payments, reservationActivity } from "@louez/db";

import { log } from "@/lib/evlog";
import { buildFeeMetadata, getStoreBilling, planStripeFees } from "@/lib/pay-as-you-go";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { createCheckoutSession, toStripeCents } from "@/lib/stripe";

import { buildStripeLineItems, getCheckoutChargeAmount } from "./build-stripe-line-items";
import { runAfterResponse } from "./post-creation-effects";
import {
  DELIVERY_TAX_LINE_ID,
  getItemTaxLineId,
  INSURANCE_TAX_LINE_ID,
  type PricedCartLine,
  type ReservationTotals,
} from "./price-cart";

export interface StartCheckoutPaymentInput {
  store: {
    id: string;
    slug: string;
    stripeAccountId: string | null;
    settings: { currency?: string; onlinePaymentDepositPercentage?: number } | null;
  };
  reservation: {
    id: string;
    number: string;
    customerId: string;
    customerEmail: string;
    customerName: string;
  };
  lines: PricedCartLine[];
  totals: ReservationTotals;
  insuranceAmount: number;
  locale: string | undefined;
  /** Where Stripe sends the customer back; the reservation id is appended. */
  returnUrls?: { successPath: string; cancelPath: string };
}

/**
 * Create the Stripe Checkout session for a reservation in payment mode and
 * record the pending payment plus the `payment_initiated` activity in one
 * transaction. A Stripe failure never fails the reservation: the owner can
 * still send a payment link, so the result is simply `null`.
 */
export const startCheckoutPayment = async ({
  store,
  reservation,
  lines,
  totals,
  insuranceAmount,
  locale,
  returnUrls,
}: StartCheckoutPaymentInput): Promise<string | null> => {
  if (!store.stripeAccountId) {
    return null;
  }

  try {
    const currency = store.settings?.currency || "EUR";
    const baseUrl = getStorefrontUrl(store.slug);
    const depositPercentage = store.settings?.onlinePaymentDepositPercentage ?? 100;
    const { isPartialPayment, finalChargeAmount } = getCheckoutChargeAmount({
      total: totals.total,
      depositPercentage,
    });

    const lineItems = buildStripeLineItems({
      reservationNumber: reservation.number,
      isPartialPayment,
      depositPercentage,
      finalChargeAmount,
      displayMode: totals.displayMode,
      discountAmount: totals.discount,
      items: lines.map((line, index) => ({
        name: line.productName,
        quantity: line.quantity,
        subtotal: line.subtotal,
        taxLine: totals.taxByLineId.get(getItemTaxLineId(index)),
      })),
      insuranceAmount,
      insuranceTaxLine: totals.taxByLineId.get(INSURANCE_TAX_LINE_ID),
      deliveryFee: totals.deliveryFee,
      deliveryTaxLine: totals.taxByLineId.get(DELIVERY_TAX_LINE_ID),
      toCents: (amount) => toStripeCents(amount, currency),
    });

    // Skim the platform fee directly from the online payment via a Stripe
    // application fee: the pay-as-you-go reservation commission. Capped below
    // the charge amount; the exact amount is recorded on confirmation
    // (webhook) from metadata.
    const billing = await getStoreBilling(store.id);
    const feePlan = await planStripeFees({
      storeId: store.id,
      reservationId: reservation.id,
      chargeCents: toStripeCents(finalChargeAmount, currency),
      billing,
    });

    // Both landings carry the reservation id: the return route completes the
    // payment and mints a short access token, the cancelled page resumes it.
    const successPath = returnUrls?.successPath ?? "/checkout/return";
    const cancelPath = returnUrls?.cancelPath ?? "/checkout/cancelled";
    const { url, sessionId } = await createCheckoutSession({
      stripeAccountId: store.stripeAccountId,
      reservationId: reservation.id,
      reservationNumber: reservation.number,
      customerEmail: reservation.customerEmail,
      customerName: reservation.customerName,
      lineItems,
      depositAmount: toStripeCents(totals.deposit, currency),
      currency,
      successUrl: `${baseUrl}${successPath}?reservation=${reservation.id}`,
      cancelUrl: `${baseUrl}${cancelPath}?reservation=${reservation.id}`,
      locale,
      applicationFeeAmount: feePlan.applicationFeeCents,
      feeMetadata: buildFeeMetadata(feePlan),
      checkoutFlow: "storefront_checkout",
    });

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(payments).values({
        id: nanoid(),
        reservationId: reservation.id,
        amount: finalChargeAmount.toFixed(2),
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: sessionId,
        currency,
        notes: isPartialPayment ? `Acompte ${depositPercentage}%` : null,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId: reservation.id,
        activityType: "payment_initiated",
        description: null,
        metadata: {
          checkoutSessionId: sessionId,
          amount: finalChargeAmount,
          fullAmount: totals.total,
          depositPercentage,
          isPartialPayment,
          currency,
          method: "stripe",
        },
        createdAt: now,
      });
    });

    // Deferred like the reservation-created event, so the funnel keeps its order.
    runAfterResponse(() =>
      captureProductServerEvent({
        distinctId: reservation.customerId,
        event: productAnalyticsEvents.checkoutPaymentStarted,
        properties: {
          feature: "checkout",
          surface: "storefront",
          store_id: store.id,
          reservation_id: reservation.id,
          customer_id: reservation.customerId,
          source: "storefront_checkout",
          payment_provider: "stripe",
          payment_mode: isPartialPayment ? "partial" : "full",
          deposit_percentage: depositPercentage,
          amount_cents: toAnalyticsAmountCents(finalChargeAmount),
          total_amount_cents: toAnalyticsAmountCents(totals.total),
          application_fee_cents: feePlan.applicationFeeCents,
          reservation_fee_cents: feePlan.reservationFeeCents,
          currency,
        },
      }),
    );

    return url;
  } catch (error) {
    log.error({
      checkout: {
        event: "stripe_session_failed",
        storeId: store.id,
        reservationId: reservation.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};
