import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  db,
  markReservation,
  payments,
  reservationActivity,
  reservations,
  runReservationOnlyChange,
  stores,
  type Transaction,
} from "@louez/db";
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
import {
  checkoutSessionAccount,
  isSessionCreationRow,
} from "@/lib/reservations/checkout-session-account";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { hasRentalPaymentInProgress, isRentalPaid } from "@/lib/reservations/util.payment-status";
import { getStorefrontUrl } from "@/lib/storefront-url";
import {
  CHECKOUT_SESSION_LIFETIME_SECONDS,
  createCheckoutSession,
  toStripeCents,
} from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";
import { paymentInsuranceShareMinor } from "@/lib/stripe/payment-completion";

/**
 * Added to a session's lifetime before its row is taken as too old to be paid.
 * The session's expiry is set by this server's clock and enforced by Stripe's;
 * another server of the app may have written the row, and an older row's time
 * is the database's. Five minutes covers a drift between those clocks well past
 * what time synchronisation leaves, and costs at most a few more Stripe calls.
 */
const SESSION_CLOCK_MARGIN_MS = 5 * 60 * 1000;

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

    // The reservation as its lock holds it: the status and the payments each
    // write below decides on, read again under that lock.
    const scope = { reservationId, storeId: store.id };
    const readPayable = async (
      tx: Transaction,
    ): Promise<
      { refusal: string } | { refusal: null; payments: (typeof payments.$inferSelect)[] }
    > => {
      const [locked] = await tx
        .select({ status: reservations.status })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)));
      if (!locked || !allowedStatuses.includes(locked.status)) {
        return { refusal: "errors.invalidStatus" };
      }
      const rows = await tx
        .select()
        .from(payments)
        .where(eq(payments.reservationId, reservationId));
      if (isRentalPaid(rows, currency)) return { refusal: "errors.alreadyPaid" };
      return { refusal: null, payments: rows };
    };
    /** Expires a session this call created and will not hand out: it is open, or gone. */
    const expireSession = async (sessionId: string) => {
      try {
        await getStripe().checkout.sessions.expire(sessionId, { stripeAccount: stripeAccountId });
      } catch {
        // Session may already be expired or completed.
      }
    };
    /**
     * Whether an earlier session of the rental can no longer be paid
     * ("expired"), was paid ("complete"), or neither is known ("unknown"), on
     * the account it lives on.
     * Stripe expires only an open session, one whose payment has not started; an
     * expire that fails leaves the session expired already, complete, or not
     * reached: its retrieve says which.
     */
    const settleEarlierSession = async ({
      sessionId,
      account,
    }: {
      sessionId: string;
      account: string;
    }): Promise<"expired" | "complete" | "unknown"> => {
      try {
        await getStripe().checkout.sessions.expire(sessionId, { stripeAccount: account });
        return "expired";
      } catch {
        // Not open any more, or Stripe not reached: read it.
      }
      try {
        const session = await getStripe().checkout.sessions.retrieve(sessionId, {
          stripeAccount: account,
        });
        if (session.status === "complete" || session.payment_status === "paid") return "complete";
        return session.status === "expired" ? "expired" : "unknown";
      } catch {
        return "unknown";
      }
    };

    // The rental's open payments are cancelled before their sessions are expired
    // at Stripe: an expiry of a session replaced here finds its row no longer
    // pending and cancels nothing. With them, every rental session of the
    // reservation that could still be paid is settled at Stripe below: a row
    // cancelled earlier (by an earlier call that could not settle its session,
    // or by an expiry) whose session is younger than a session's lifetime.
    const replaced = await runReservationOnlyChange(scope, async (tx) => {
      const payable = await readPayable(tx);
      if (payable.refusal !== null) return { refusal: payable.refusal, sessions: [] };
      const open = payable.payments.filter(
        (payment) => payment.type === "rental" && payment.status === "pending",
      );
      // A row is written by this server's clock after its session is created, as
      // here: its age, read on the same clock, is at most its session's. A row
      // older than the lifetime and the margin names a session Stripe has
      // expired, and is not read there.
      const payableSince = new Date(
        Date.now() - CHECKOUT_SESSION_LIFETIME_SECONDS * 1000 - SESSION_CLOCK_MARGIN_MS,
      );
      const recent = payable.payments.filter(
        (payment) =>
          payment.type === "rental" &&
          payment.status === "cancelled" &&
          payment.createdAt > payableSince,
      );
      for (const payment of open) {
        await tx
          .update(payments)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      }
      if (open.length > 0) await markReservation(tx, reservation);
      return {
        refusal: null,
        // Each session on the account its row records, the one it was created on;
        // a row that records none, on the store's.
        sessions: [...open, ...recent].flatMap((payment) =>
          payment.stripeCheckoutSessionId
            ? [
                {
                  sessionId: payment.stripeCheckoutSessionId,
                  account: checkoutSessionAccount({
                    recordedAccountId: isSessionCreationRow(payment)
                      ? payment.stripeAccountId
                      : null,
                    storeAccountId: stripeAccountId,
                  }),
                },
              ]
            : [],
        ),
      };
    });
    if (replaced.refusal !== null) return { error: replaced.refusal };
    // No second session for a rental whose earlier session was paid, or may
    // have been: its completion, when delivered, completes its cancelled row
    // and confirms the reservation.
    const settled: string[] = [];
    for (const session of replaced.sessions) settled.push(await settleEarlierSession(session));
    if (settled.includes("complete")) return { error: "errors.alreadyPaid" };
    if (settled.includes("unknown")) return { error: "errors.paymentSessionError" };

    const lineItems = [
      {
        name: `Reservation #${reservation.number}`,
        quantity: 1,
        unitAmount: chargeCents,
      },
    ];

    const insuranceShareMinor = paymentInsuranceShareMinor("rental", chargeCents, () =>
      reservationTotalsMinor({
        reservation,
        storeSettings: store.settings,
        items: reservation.items,
      }),
    );
    const feePlan = await planApplicationFee({
      storeId: store.id,
      reservationId,
      kind: "rental",
      chargeMinor: chargeCents,
      currency,
      insuranceShareMinor: insuranceShareMinor ?? 0,
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

    // The pending payment and its activity land together, and only on a
    // reservation still payable, with no other open or paid rental payment;
    // otherwise the session just created is expired and nothing is written.
    const now = new Date();
    let refusal: string | null;
    try {
      refusal = await runReservationOnlyChange(scope, async (tx) => {
        const payable = await readPayable(tx);
        if (payable.refusal !== null) return payable.refusal;
        // Another payment of the rental started meanwhile: this one is not installed.
        if (hasRentalPaymentInProgress(payable.payments)) return "errors.paymentSessionError";
        await tx.insert(payments).values({
          id: nanoid(),
          reservationId,
          amount: chargeAmount.toFixed(2),
          type: "rental",
          method: "stripe",
          status: "pending",
          stripeCheckoutSessionId: sessionId,
          // The account the session was created on: its lifecycle is read on it.
          stripeAccountId,
          origin: "customer_session",
          currency,
          createdAt: now,
          updatedAt: now,
        });
        await markReservation(tx, reservation);

        await tx.insert(reservationActivity).values({
          id: nanoid(),
          reservationId,
          activityType: "payment_initiated",
          metadata: { checkoutSessionId: sessionId, source },
          createdAt: now,
        });
        return null;
      });
    } catch (error) {
      await expireSession(sessionId);
      throw error;
    }
    if (refusal) {
      await expireSession(sessionId);
      return { error: refusal };
    }

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
