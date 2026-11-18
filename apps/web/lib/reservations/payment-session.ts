import "server-only";

import { and, eq } from "drizzle-orm";

import { db, reservations, stores } from "@louez/db";
import { validateStripePaymentAmount } from "@louez/utils";

import { env } from "@/env";
import { reservationTotalsMinor } from "@/lib/billing-sync/money";
import { timingSafeEqualStrings } from "@/lib/catalog-auth";
import { log } from "@/lib/evlog";
import { buildFeeMetadata, planApplicationFee } from "@/lib/pay-as-you-go";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { openRentalCheckoutSession } from "@/lib/reservations/rental-session-gate";
import { isRentalPaid } from "@/lib/reservations/util.payment-status";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { TEST_RESERVATION_REFUSED_ERROR } from "@/lib/test-reservations/refusal";
import { createCheckoutSession, toStripeCents } from "@/lib/stripe";
import { paymentInsuranceShareMinor } from "@/lib/stripe/payment-completion";

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
    /**
     * The verified marketplace only: its checkout holds the booking's marketplace
     * attempt, in a transaction on another connection, while it awaits this call.
     */
    callerHoldsMarketplaceAttempt?: boolean;
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
    // A test reservation is never paid through Stripe (lib/test-reservations).
    if (reservation.isTest) {
      return { error: TEST_RESERVATION_REFUSED_ERROR };
    }

    const allowedStatuses = allowPendingReservation
      ? ["pending", "confirmed", "ongoing"]
      : ["confirmed", "ongoing"];
    if (!allowedStatuses.includes(reservation.status)) {
      return { error: "errors.invalidStatus" };
    }

    // The reservation is paid in its own currency, whatever the store's is now, and
    // only a payment in that currency has paid it.
    const currency = reservationCurrency(reservation.currency, store.settings);
    if (isRentalPaid(reservation.payments, currency)) {
      return { error: "errors.alreadyPaid" };
    }

    const chargeAmount =
      isTrustedCaller && options?.chargeAmount !== undefined
        ? options.chargeAmount
        : Number.parseFloat(reservation.totalAmount);
    const chargeCents = toStripeCents(chargeAmount, currency);
    const paymentAmount = validateStripePaymentAmount(chargeAmount, currency);
    if (!paymentAmount.ok) {
      return {
        error: paymentAmount.error,
        errorParams: "params" in paymentAmount ? paymentAmount.params : undefined,
      };
    }

    // The marketplace's checkout holds the booking's attempt while it awaits this
    // call, and its expiry and failure take the reservation's lock, then the
    // attempt: asking for the reservation's lock here, on another connection,
    // would close a wait cycle the database cannot see. For that caller the gate
    // runs the same reads, conditions and conditional writes without the
    // reservation's lock: the attempt its caller holds serialises them against the
    // marketplace's expiry and failure, which take it too. It does not serialise
    // them against a store's cancellation of the booking from the dashboard.
    const callerHoldsMarketplaceAttempt =
      isVerifiedMarketplaceSource && options?.callerHoldsMarketplaceAttempt === true;

    const insuranceShareMinor = paymentInsuranceShareMinor("rental", chargeCents, () =>
      reservationTotalsMinor({
        reservation,
        storeSettings: store.settings,
        items: reservation.items,
      }),
    );

    // The rental's one gate, shared with the payment request: it replaces the
    // rental's open session, and installs this one only on a reservation still
    // payable, as its lock holds it.
    const outcome = await openRentalCheckoutSession({
      storeId: store.id,
      reservationId,
      stripeAccountId,
      callerHoldsMarketplaceAttempt,
      check: async (_tx, locked) => {
        if (!locked || !allowedStatuses.includes(locked.status)) return "errors.invalidStatus";
        if (isRentalPaid(locked.payments, currency)) return "errors.alreadyPaid";
        return null;
      },
      create: async ({ idempotencyKey }) => {
        const feePlan = await planApplicationFee({
          storeId: store.id,
          reservationId,
          kind: "rental",
          chargeMinor: chargeCents,
          currency,
          insuranceShareMinor: insuranceShareMinor ?? 0,
          includeMarketplaceFee: reservation.source === "marketplace",
        });
        const session = await createCheckoutSession({
          stripeAccountId,
          idempotencyKey,
          reservationId,
          reservationNumber: reservation.number,
          customerEmail: reservation.customer.email,
          customerName: `${reservation.customer.firstName} ${reservation.customer.lastName}`,
          lineItems: [
            {
              name: `Reservation #${reservation.number}`,
              quantity: 1,
              unitAmount: chargeCents,
            },
          ],
          depositAmount: toStripeCents(Number.parseFloat(reservation.depositAmount), currency),
          currency,
          applicationFeeAmount: feePlan.applicationFeeCents,
          feeMetadata: buildFeeMetadata(feePlan, {
            insuranceShareMinor: insuranceShareMinor ?? 0,
            paymentKind: "rental",
            reservationId,
            storeId: store.id,
          }),
          successUrl:
            successUrl ??
            getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=success`),
          cancelUrl:
            cancelUrl ??
            getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=cancelled`),
          ...(source === "checkout_resume" ? { checkoutFlow: "storefront_checkout" as const } : {}),
        });
        return { ...session, feePlan };
      },
      attempt: {
        chargeMinor: chargeCents,
        currency,
        origin: "customer_session",
        activity: { source },
      },
    });
    if (!outcome.ok) {
      // An earlier session was paid: the rental is. One that may still be paid,
      // or another payment opened meanwhile: nothing new, the next call asks again.
      return {
        error:
          outcome.refusal === "paid"
            ? "errors.alreadyPaid"
            : outcome.refusal === "busy"
              ? "errors.paymentSessionError"
              : outcome.refusal,
      };
    }
    const { url, sessionId, expiresAt, feePlan } = outcome.session;

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
