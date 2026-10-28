import { completeExtensionPayment } from "@/lib/reservations/extension-service";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";

import { failMarketplaceBookingAttempt } from "@louez/api/services";
import { type Transaction, db, markReservationIds, markStore, toWholeSeconds } from "@louez/db";
import { payments, reservationActivity, reservations, stores } from "@louez/db";
import type { NotificationSettings, StoreSettings } from "@louez/types";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { notifyPaymentFailed, notifyStripeConnected } from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { tryGenerateInvoiceForPayment } from "@/lib/invoicing/service";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import {
  getStoreBilling,
  parseFeeMetadata,
  recordMarketplaceFee,
  recordReservationFee,
} from "@/lib/pay-as-you-go";
import {
  clawbackReferrerRewardForQualifyingPayment,
  maybeGrantReferrerReward,
} from "@/lib/referral/rewards";
import { fromStripeCents } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";
import { cancelAbandonedCheckout } from "@/lib/reservations/cancel-abandoned-checkout";
import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";

import { env } from "@/env";

import { handleChargeRefunded } from "./charge-refund";
import { recordChargeDispute } from "./charge-writes";
import type { DisputeEventType } from "./dispute-facts";
import { reverseFeeAtSource } from "./fee-reversal";

// ===== TYPE DEFINITIONS =====
// Define explicit type for reservation with relations to ensure proper typing
// Only includes fields we actually use in webhook handlers

type ReservationStore = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  stripeAccountId: string | null;
  discordWebhookUrl: string | null;
  ownerPhone: string | null;
  notificationSettings: NotificationSettings | null;
  settings: StoreSettings | null;
};

type ReservationCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

type ReservationWithRelations = {
  id: string;
  number: string;
  storeId: string;
  customerId: string | null;
  status: string;
  source: string | null;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  depositAmount: string | null;
  depositStatus: string | null;
  store: ReservationStore;
  customer: ReservationCustomer | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }>;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The id of a Stripe reference, expanded or not. */
const stripeRefId = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

// ===== VALIDATION HELPERS =====
// Validates Stripe metadata to prevent manipulation attacks

/**
 * Validates that a reservationId from Stripe metadata is properly formatted
 * @returns true if valid, false otherwise
 */
function isValidReservationId(reservationId: string | undefined): reservationId is string {
  return typeof reservationId === "string" && reservationId.length === 21;
}

/**
 * Validates that the connected account matches the reservation's store
 * Prevents attacks where metadata is manipulated
 */
async function validateConnectedAccountForReservation(
  reservationId: string,
  connectedAccountId: string | undefined,
  eventType: string,
): Promise<{ valid: boolean; reservation?: ReservationWithRelations }> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    log.error({
      stripeWebhook: { event: eventType, issue: "reservation_not_found", reservationId },
    });
    return { valid: false };
  }

  // If we have a connected account, validate it matches the store
  if (connectedAccountId && reservation.store.stripeAccountId !== connectedAccountId) {
    log.error({
      stripeWebhook: {
        event: eventType,
        issue: "connected_account_mismatch",
        expected: reservation.store.stripeAccountId,
        received: connectedAccountId,
        reservationId,
      },
    });
    return { valid: false };
  }

  // Type assertion safe: Drizzle returns matching structure from 'with' clause
  return { valid: true, reservation: reservation as ReservationWithRelations };
}

/**
 * Webhook handler for Stripe Connect events
 * This handles payment events from connected accounts (rental payments and deposit holds)
 */
export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    log.error({
      stripeWebhook: { issue: "signature_verification_failed", error: describeError(err) },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Get connected account ID from event
  const connectedAccountId = event.account;

  try {
    switch (event.type) {
      // Checkout events
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          connectedAccountId,
        );
        break;

      case "checkout.session.expired":
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;

      // Deposit authorization hold events
      case "payment_intent.amount_capturable_updated":
        await handleDepositAuthorized(
          event.data.object as Stripe.PaymentIntent,
          connectedAccountId,
        );
        break;

      case "payment_intent.canceled":
        await handleDepositReleased(event.data.object as Stripe.PaymentIntent, connectedAccountId);
        break;

      case "payment_intent.succeeded":
        await handleDepositCaptured(event.data.object as Stripe.PaymentIntent, connectedAccountId);
        break;

      case "payment_intent.payment_failed":
        await handleDepositFailed(event.data.object as Stripe.PaymentIntent, connectedAccountId);
        break;

      // Refund events
      case "charge.refunded":
        await handleChargeRefunded(event.data.object, connectedAccountId);
        break;

      // Dispute / chargeback. Stripe only sends the events enabled on the Connect
      // webhook endpoint: all five must be on for the billing facts.
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated":
        await handleChargeDispute({
          eventType: event.type,
          dispute: event.data.object,
          eventCreatedAt: new Date(event.created * 1000),
          connectedAccountId,
        });
        break;

      // Account events
      case "account.updated":
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;

      // A connected account disconnected from the platform — stop charging it.
      case "account.application.deauthorized":
        await handleAccountDeauthorized(connectedAccountId);
        break;

      default:
        log.info({ stripeWebhook: { event: event.type, issue: "unhandled_event_type" } });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error({
      stripeWebhook: { event: event.type, issue: "handler_failed", error: describeError(error) },
    });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  connectedAccountId?: string,
) {
  // Only handle payment mode (not subscription)
  if (session.mode !== "payment") return;

  const reservationId = session.metadata?.reservationId;
  if (!reservationId) {
    log.error({
      stripeWebhook: { event: "checkout.session.completed", issue: "missing_reservation_id" },
    });
    return;
  }

  // SECURITY: Validate reservationId format (nanoid 21 chars)
  if (reservationId.length !== 21) {
    log.error({
      stripeWebhook: {
        event: "checkout.session.completed",
        issue: "invalid_reservation_id",
        reservationId,
      },
    });
    return;
  }

  // Check idempotence: if payment already completed for this session, the
  // payment/confirmation work is skipped below — but pay-as-you-go usage is still
  // recorded first, because the storefront success page can complete the payment
  // without doing PAYG metering (it would otherwise leave the at-source commission
  // untracked).
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripeCheckoutSessionId, session.id),
  });

  // Get reservation with store, customer, and items for notifications
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    log.error({
      stripeWebhook: {
        event: "checkout.session.completed",
        issue: "reservation_not_found",
        reservationId,
      },
    });
    return;
  }

  // Validate connected account matches store to prevent metadata manipulation
  if (connectedAccountId && reservation.store.stripeAccountId !== connectedAccountId) {
    log.error({
      stripeWebhook: {
        event: "checkout.session.completed",
        issue: "connected_account_mismatch",
        expected: reservation.store.stripeAccountId,
        received: connectedAccountId,
        reservationId,
        sessionId: session.id,
      },
    });
    return;
  }

  // If reservation is already confirmed (e.g., by success page), skip
  if (reservation.status !== "pending") {
    log.info({
      stripeWebhook: {
        event: "checkout.session.completed",
        issue: "reservation_not_pending",
        reservationId,
        status: reservation.status,
      },
    });
  }

  // Resolve the store's billing mode up front (reused for pay-as-you-go metering).
  const billing = await getStoreBilling(reservation.store.id);
  const isPayAsYouGoStore = billing.billingMode === "pay_as_you_go";

  // Even when the payment was already completed (e.g. by the success page) all stores
  // fall through to retrieve the PaymentIntent and record the platform fees skimmed at
  // source — the success page does not do platform metering. The notification work is
  // skipped further below once those fees are recorded.

  // Get payment intent details and extract customer/payment method
  let paymentIntentId: string | null = null;
  let chargeId: string | null = null;
  // Stripe's time of the charge: a payment's paidAt, so its month is the charge's.
  let chargeCreatedAt: Date | null = null;
  let paymentIntentMetadata: Record<string, string> | null = null;
  let stripeCustomerId: string | null = null;
  let stripePaymentMethodId: string | null = null;
  // Platform fee skimmed from this charge (cents), its id, and the breakdown carried
  // in the PaymentIntent metadata (the pay-as-you-go reservation commission).
  let applicationFeeCollectedCents = 0;
  let applicationFeeId: string | null = null;
  let feeBreakdown = {
    reservationFeeCents: 0,
    marketplaceFeeCents: 0,
    hasBreakdown: false,
  };
  let paymentIntentRetrieveFailed = false;

  if (session.payment_intent && connectedAccountId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        session.payment_intent as string,
        { expand: ["latest_charge"] },
        { stripeAccount: connectedAccountId },
      );
      paymentIntentId = paymentIntent.id;
      stripeCustomerId = paymentIntent.customer as string | null;
      stripePaymentMethodId = paymentIntent.payment_method as string | null;
      applicationFeeCollectedCents = paymentIntent.application_fee_amount ?? 0;
      feeBreakdown = parseFeeMetadata(paymentIntent.metadata);
      paymentIntentMetadata = paymentIntent.metadata;

      const latestCharge = paymentIntent.latest_charge;
      if (latestCharge && typeof latestCharge === "object") {
        chargeId = latestCharge.id;
        chargeCreatedAt = new Date(latestCharge.created * 1000);
        applicationFeeId = (latestCharge.application_fee as string | null) ?? null;
      } else {
        chargeId = (latestCharge as string | null) ?? null;
      }
    } catch (error) {
      log.error({
        stripeWebhook: {
          event: "checkout.session.completed",
          issue: "payment_intent_retrieve_failed",
          reservationId,
          error: describeError(error),
        },
      });
      paymentIntentRetrieveFailed = true;
    }
  }

  // We MUST know the application fee that was collected at source before committing,
  // otherwise platform fees would be dropped (or a PAYG rental misclassified as manual
  // and billed a second time at month-end). If the retrieve failed, abort so Stripe
  // retries the webhook (nothing has been committed yet — the payment is still pending).
  if (session.payment_intent && paymentIntentRetrieveFailed) {
    throw new Error(
      `PaymentIntent retrieve failed for reservation ${reservationId}; aborting so Stripe retries`,
    );
  }

  // If we don't have customer from payment intent, get from session
  if (!stripeCustomerId && session.customer) {
    stripeCustomerId = session.customer as string;
  }

  const currency = session.currency?.toUpperCase() || "EUR";
  const depositAmount = Number(reservation.depositAmount) || 0;

  // Determine deposit status based on whether there's a deposit and card was saved
  let newDepositStatus: "none" | "card_saved" | "pending" = "none";
  if (depositAmount > 0) {
    // If we have both customer and payment method, card is saved
    newDepositStatus = stripeCustomerId && stripePaymentMethodId ? "card_saved" : "pending";
  }

  const paidAt = new Date();

  // Record the pay-as-you-go reservation commission skimmed from this charge BEFORE the
  // payment is marked completed, so a transient failure aborts the webhook (Stripe retries
  // with the payment still pending) instead of silently dropping it. Idempotent per
  // reservation. recordReservationFee itself waives the fee (source='free') when the store
  // still has welcome-allowance credits.
  if (paymentIntentId && isPayAsYouGoStore) {
    // New PaymentIntents carry the exact reservation commission in metadata (recorded
    // verbatim — no recompute drift). For a legacy/missing breakdown with a positive
    // application fee (deploy seam / stripped metadata), the whole application fee was the
    // reservation commission.
    let reservationFeeCents = feeBreakdown.reservationFeeCents;
    if (!feeBreakdown.hasBreakdown && applicationFeeCollectedCents > 0) {
      reservationFeeCents = applicationFeeCollectedCents;
      log.warn({
        payg: {
          event: "fee_breakdown_metadata_missing",
          reservationId,
          paymentIntentId,
          applicationFeeCollectedCents,
        },
      });
    }

    const collectedAtSource = reservationFeeCents > 0;
    await recordReservationFee({
      storeId: reservation.store.id,
      reservationId,
      source: collectedAtSource ? "online" : "manual",
      collectedAmountCents: reservationFeeCents,
      currency,
      paymentId: existingPayment?.id ?? null,
      stripePaymentIntentId: paymentIntentId,
      stripeApplicationFeeId: applicationFeeId,
      at: paidAt,
      billing,
    });
  }

  if (paymentIntentId && reservation.source === "marketplace") {
    const marketplaceCollectedAtSource = feeBreakdown.marketplaceFeeCents >= 100;
    await recordMarketplaceFee({
      storeId: reservation.store.id,
      reservationId,
      source: marketplaceCollectedAtSource ? "online" : "manual",
      collectedAmountCents: feeBreakdown.marketplaceFeeCents,
      currency,
      paymentId: existingPayment?.id ?? null,
      stripePaymentIntentId: paymentIntentId,
      stripeApplicationFeeId: applicationFeeId,
      at: paidAt,
    });
  }

  // Referral Program: a Referred Store's first qualifying online payment unlocks the
  // Referrer Reward. Runs for EVERY online checkout, not only pay-as-you-go referred
  // stores — a referred store may have switched to a subscription before its first sale,
  // and the reward must still fire. Idempotent (one reward per referred store) and safe
  // against the success-page/webhook double-processing. Best-effort: never block payment
  // confirmation on the reward (a transient failure forfeits this one reward; there is no
  // backfill job yet, so a future reconciliation sweep is the proper recovery).
  if (reservation.store.referredByStoreId) {
    try {
      await maybeGrantReferrerReward({
        referredStore: {
          id: reservation.store.id,
          name: reservation.store.name,
          referredByStoreId: reservation.store.referredByStoreId,
          referredByUserId: reservation.store.referredByUserId,
        },
        qualifyingAmountCents: session.amount_total ?? 0,
        currency,
        reservationId,
        paymentId: existingPayment?.id ?? null,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
        at: paidAt,
      });
    } catch (error) {
      log.error({
        referral: {
          event: "referrer_reward_grant_failed",
          reservationId,
          error: describeError(error),
        },
      });
    }
  }

  // Claim → confirm → effects, shared with the customer's return from Stripe
  // (lib/reservations/complete-checkout-payment.ts). Idempotent per session.
  if (session.metadata?.extensionId) {
    await completeExtensionPayment(session, connectedAccountId);
    return;
  }

  const completion = await completeCheckoutPayment({
    source: "webhook",
    reservationId,
    stripe: {
      sessionId: session.id,
      amountTotalCents: session.amount_total || 0,
      currency,
      paymentIntentId,
      chargeId,
      chargeCreatedAt,
      stripeCustomerId,
      stripePaymentMethodId,
      stripeAccountId: connectedAccountId ?? null,
      paymentIntentMetadata,
      sessionMetadata: session.metadata,
    },
    paymentRequestId: session.metadata?.paymentRequestId ?? null,
    analytics: {
      is_pay_as_you_go_store: isPayAsYouGoStore,
      application_fee_collected_cents: applicationFeeCollectedCents,
      reservation_fee_cents: feeBreakdown.reservationFeeCents,
    },
  });

  log.info({
    stripeWebhook: {
      event: "checkout_session_completed",
      reservationId,
      status: completion.status,
      ...(completion.status === "completed" && {
        claimed: completion.claimed,
        reservationConfirmed: completion.reservationConfirmed,
        depositStatus: newDepositStatus,
      }),
    },
  });
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  if (session.metadata?.extensionId) return;

  const reservationId = session.metadata?.reservationId;
  if (!reservationId) return;

  const currency = session.currency?.toUpperCase() || "EUR";
  const amount = fromStripeCents(session.amount_total || 0, currency);

  // Update pending payment to failed/cancelled
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripeCheckoutSessionId, session.id),
  });

  // A row still pending here means nobody replaced this session: the
  // customer simply never paid. A resumed or superseded checkout cancels its
  // row before expiring the session, so those never reach the cancellation.
  const abandoned = existingPayment?.status === "pending";

  await db.transaction(async (tx) => {
    if (existingPayment && existingPayment.status === "pending") {
      await tx
        .update(payments)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, existingPayment.id));
      await markReservationIds(tx, [existingPayment.reservationId]);
    }

    // Log payment expired activity
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "payment_expired",
      description: null,
      metadata: {
        checkoutSessionId: session.id,
        amount,
        currency,
        method: "stripe",
      },
      // Whole seconds, as the status change below stores its `cancelled` row.
      createdAt: toWholeSeconds(new Date()),
    });
  });

  await failMarketplaceBookingAttempt(reservationId, runReservationEffects);

  const reservationCancelled =
    abandoned && session.metadata?.checkoutFlow === "storefront_checkout"
      ? await cancelAbandonedCheckout(
          { reservationId, checkoutSessionId: session.id },
          runReservationEffects,
        )
      : false;

  log.info({
    stripeWebhook: {
      event: "checkout.session.expired",
      reservationId,
      sessionId: session.id,
      reservationCancelled,
    },
  });
}

// ============================================================================
// Deposit Authorization Hold Event Handlers
// ============================================================================

/**
 * Locks the reservation, first in a deposit event's transaction: rows are locked
 * reservation first, then its payments, as the dashboard's deposit writes do.
 * Stripe sends these events for the dashboard's own capture or release, so both
 * run at once for the same PaymentIntent, and the opposite order deadlocks.
 */
async function lockDepositReservation(tx: Transaction, reservationId: string) {
  await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .for("update");
}

/**
 * Handles successful deposit authorization (empreinte created)
 * Triggered when PaymentIntent status becomes requires_capture
 */
async function handleDepositAuthorized(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string,
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== "deposit_hold") return;

  const reservationId = paymentIntent.metadata?.reservationId;

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    log.error({
      stripeWebhook: {
        event: "deposit_authorized",
        issue: "invalid_reservation_id",
        reservationId,
      },
    });
    return;
  }

  // SECURITY: Validate connected account matches store
  const { valid, reservation } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    "deposit_authorized",
  );
  if (!valid) return;

  // Check idempotence
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, paymentIntent.id),
  });

  if (existingPayment) {
    log.info({
      stripeWebhook: {
        event: "deposit_authorized",
        issue: "already_recorded",
        reservationId,
        paymentIntentId: paymentIntent.id,
      },
    });
    return;
  }

  const currency = paymentIntent.currency.toUpperCase();
  const amount = fromStripeCents(paymentIntent.amount, currency);
  const paymentMethodId = stripeRefId(paymentIntent.payment_method);

  // Authorization expires after 7 days
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.transaction(async (tx) => {
    await lockDepositReservation(tx, reservationId);

    // Create payment record for the authorization hold. A hold is not paid and
    // carries no charge id: its capture row does (deposit_capture).
    await tx.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: amount.toFixed(2),
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
      stripePaymentIntentId: paymentIntent.id,
      stripePaymentMethodId: paymentMethodId,
      grossMinor: paymentIntent.amount,
      insuranceShareMinor: 0,
      origin: "deposit",
      stripeAccountId: connectedAccountId ?? reservation?.store.stripeAccountId ?? null,
      authorizationExpiresAt: expiresAt,
      currency,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Update reservation deposit status
    await tx
      .update(reservations)
      .set({
        depositStatus: "authorized",
        depositPaymentIntentId: paymentIntent.id,
        depositAuthorizationExpiresAt: expiresAt,
        stripePaymentMethodId: paymentMethodId,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Log activity
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "deposit_authorized",
      metadata: {
        paymentIntentId: paymentIntent.id,
        amount,
        expiresAt: expiresAt.toISOString(),
      },
      createdAt: new Date(),
    });

    await markReservationIds(tx, [reservationId]);
  });

  log.info({
    stripeWebhook: {
      event: "deposit_authorized",
      reservationId,
      paymentIntentId: paymentIntent.id,
    },
  });
}

/**
 * Handles deposit release (authorization cancelled)
 * Triggered when PaymentIntent is cancelled
 */
async function handleDepositReleased(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string,
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== "deposit_hold") return;

  const reservationId = paymentIntent.metadata?.reservationId;

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    log.error({
      stripeWebhook: { event: "deposit_released", issue: "invalid_reservation_id", reservationId },
    });
    return;
  }

  // SECURITY: Validate connected account matches store
  const { valid } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    "deposit_released",
  );
  if (!valid) return;

  const currency = paymentIntent.currency.toUpperCase();
  const amount = fromStripeCents(paymentIntent.amount, currency);

  await db.transaction(async (tx) => {
    await lockDepositReservation(tx, reservationId);

    // Find and update the deposit hold payment
    const depositPayment = await tx.query.payments.findFirst({
      where: eq(payments.stripePaymentIntentId, paymentIntent.id),
    });

    if (depositPayment) {
      await tx
        .update(payments)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, depositPayment.id));
      await markReservationIds(tx, [depositPayment.reservationId]);
    }

    // Update reservation deposit status
    await tx
      .update(reservations)
      .set({
        depositStatus: "released",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Log activity
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "deposit_released",
      metadata: {
        paymentIntentId: paymentIntent.id,
        amount,
      },
      createdAt: new Date(),
    });
  });

  log.info({
    stripeWebhook: { event: "deposit_released", reservationId, paymentIntentId: paymentIntent.id },
  });
}

/**
 * Handles deposit capture (partial or full)
 * Triggered when PaymentIntent succeeds after capture
 */
async function handleDepositCaptured(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string,
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== "deposit_hold") return;

  const reservationId = paymentIntent.metadata?.reservationId;

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    log.error({
      stripeWebhook: { event: "deposit_captured", issue: "invalid_reservation_id", reservationId },
    });
    return;
  }

  // SECURITY: Validate connected account matches store
  const { valid, reservation } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    "deposit_captured",
  );
  if (!valid) return;

  const currency = paymentIntent.currency.toUpperCase();
  const capturedAmount = fromStripeCents(paymentIntent.amount_received, currency);
  const originalAmount = fromStripeCents(paymentIntent.amount, currency);
  const stripeAccountId = connectedAccountId ?? reservation?.store.stripeAccountId ?? null;
  // A capture is paid when captured: the charge itself dates from the authorization.
  const paidAt = new Date();

  const capturePaymentId = await db.transaction(async (tx) => {
    // Locked before the first read below, so that read sees a capture the
    // dashboard committed while this event waited.
    await lockDepositReservation(tx, reservationId);

    // Find and update the deposit hold payment. The capture row shares its
    // PaymentIntent, so match the type.
    const depositPayment = await tx.query.payments.findFirst({
      where: and(
        eq(payments.stripePaymentIntentId, paymentIntent.id),
        eq(payments.type, "deposit_hold"),
      ),
    });

    if (depositPayment) {
      await tx
        .update(payments)
        .set({
          status: "completed",
          capturedAmount: capturedAmount.toFixed(2),
          paidAt,
          // Holds recorded before the billing facts existed get them now.
          grossMinor: sql`COALESCE(${payments.grossMinor}, ${paymentIntent.amount})`,
          insuranceShareMinor: sql`COALESCE(${payments.insuranceShareMinor}, 0)`,
          origin: sql`COALESCE(${payments.origin}, 'deposit')`,
          stripeAccountId: sql`COALESCE(${payments.stripeAccountId}, ${stripeAccountId})`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, depositPayment.id));
    }

    // Create a deposit_capture payment record. Guard against duplicates: the dashboard
    // capture action inserts this row synchronously, and Stripe may re-deliver
    // payment_intent.succeeded — only insert when no deposit_capture row exists yet for
    // this PaymentIntent.
    let captureId: string | null = null;
    if (capturedAmount > 0) {
      const existingCapture = await tx.query.payments.findFirst({
        where: and(
          eq(payments.stripePaymentIntentId, paymentIntent.id),
          eq(payments.type, "deposit_capture"),
        ),
      });
      captureId = existingCapture?.id ?? nanoid();
      if (!existingCapture) {
        await tx.insert(payments).values({
          id: captureId,
          reservationId,
          amount: capturedAmount.toFixed(2),
          type: "deposit_capture",
          method: "stripe",
          status: "completed",
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: stripeRefId(paymentIntent.latest_charge),
          grossMinor: paymentIntent.amount_received,
          insuranceShareMinor: 0,
          origin: "deposit",
          stripeAccountId,
          currency,
          paidAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Update reservation deposit status
    await tx
      .update(reservations)
      .set({
        depositStatus: "captured",
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Log activity
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "deposit_captured",
      metadata: {
        paymentIntentId: paymentIntent.id,
        capturedAmount,
        originalAmount,
        reason: paymentIntent.metadata?.captureReason || null,
      },
      createdAt: new Date(),
    });

    await markReservationIds(tx, [reservationId]);
    return captureId;
  });

  if (capturePaymentId) {
    await tryGenerateInvoiceForPayment(capturePaymentId, "stripe_deposit_captured_webhook");
  }

  log.info({
    stripeWebhook: {
      event: "deposit_captured",
      reservationId,
      paymentIntentId: paymentIntent.id,
      capturedAmount,
      currency,
    },
  });
}

/**
 * Handles payment failure
 * Triggered when card is declined or payment fails
 */
async function handleDepositFailed(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string,
) {
  const reservationId = paymentIntent.metadata?.reservationId;

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    log.error({
      stripeWebhook: { event: "payment_failed", issue: "invalid_reservation_id", reservationId },
    });
    return;
  }

  // SECURITY: Validate connected account matches store
  const { valid, reservation } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    "payment_failed",
  );
  if (!valid || !reservation) return;

  const currency = paymentIntent.currency.toUpperCase();
  const amount = fromStripeCents(paymentIntent.amount, currency);
  const errorMessage = paymentIntent.last_payment_error?.message || "Unknown error";
  const errorCode = paymentIntent.last_payment_error?.code || null;
  const declineCode = paymentIntent.last_payment_error?.decline_code || null;
  const isDepositHold = paymentIntent.metadata?.type === "deposit_hold";

  if (isDepositHold) {
    // Handle deposit authorization failure. No payment changes, so no billing mark:
    // the deposit status is not part of the reservation snapshot.
    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({
          depositStatus: "failed",
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, reservationId));

      // Log deposit failed activity
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: "deposit_failed",
        metadata: {
          paymentIntentId: paymentIntent.id,
          amount,
          error: errorMessage,
          errorCode,
          declineCode,
        },
        createdAt: new Date(),
      });
    });

    log.info({
      stripeWebhook: {
        event: "payment_failed",
        kind: "deposit_hold",
        reservationId,
        paymentIntentId: paymentIntent.id,
        errorCode,
        declineCode,
      },
    });
  } else {
    // Handle rental payment failure
    // If this payment was already completed, ignore stale failed events
    // (e.g. first attempt failed but customer retried successfully).
    const existingPayment = await db.query.payments.findFirst({
      where: eq(payments.stripePaymentIntentId, paymentIntent.id),
    });

    if (existingPayment?.status === "completed") {
      log.info({
        stripeWebhook: {
          event: "payment_failed",
          issue: "stale_event_for_completed_payment",
          reservationId,
          paymentIntentId: paymentIntent.id,
        },
      });
      return;
    }

    await db.transaction(async (tx) => {
      if (existingPayment && existingPayment.status !== "failed") {
        await tx
          .update(payments)
          .set({
            status: "failed",
            updatedAt: new Date(),
          })
          .where(eq(payments.id, existingPayment.id));
        await markReservationIds(tx, [existingPayment.reservationId]);
      }

      // Log payment failed activity
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: "payment_failed",
        metadata: {
          paymentIntentId: paymentIntent.id,
          amount,
          currency,
          method: "stripe",
          error: errorMessage,
          errorCode,
          declineCode,
        },
        createdAt: new Date(),
      });
    });

    if (reservation.source === "marketplace") {
      await failMarketplaceBookingAttempt(reservationId, runReservationEffects);
    }

    log.info({
      stripeWebhook: {
        event: "payment_failed",
        kind: "rental",
        reservationId,
        paymentIntentId: paymentIntent.id,
        errorCode,
        declineCode,
      },
    });
  }

  // Dispatch admin notification for payment failure
  if (reservation) {
    dispatchNotification("payment_failed", {
      store: {
        id: reservation.store.id,
        name: reservation.store.name,
        email: reservation.store.email,
        discordWebhookUrl: reservation.store.discordWebhookUrl,
        ownerPhone: reservation.store.ownerPhone,
        notificationSettings: reservation.store.notificationSettings,
        settings: reservation.store.settings,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
      },
      customer: reservation.customer
        ? {
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone,
          }
        : undefined,
      payment: {
        amount,
      },
    }).catch((error: unknown) => {
      log.error({
        stripeWebhook: {
          event: "payment_failed",
          issue: "notification_dispatch_failed",
          reservationId,
          error: describeError(error),
        },
      });
    });

    // Platform admin notification
    notifyPaymentFailed(
      {
        id: reservation.store.id,
        name: reservation.store.name,
        slug: reservation.store.slug,
      },
      reservation.number,
    ).catch(() => {});
  }
}

async function handleAccountUpdated(account: Stripe.Account) {
  // Find store by connected account ID
  const store = await db.query.stores.findFirst({
    where: eq(stores.stripeAccountId, account.id),
  });

  if (!store) {
    log.info({
      stripeWebhook: { event: "account.updated", issue: "store_not_found", accountId: account.id },
    });
    return;
  }

  // Update store with latest status
  const chargesEnabled = account.charges_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;

  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        stripeChargesEnabled: chargesEnabled,
        stripeOnboardingComplete: chargesEnabled && detailsSubmitted,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));
    await markStore(tx, store.id);
  });

  // Platform admin notification (only on first successful onboarding)
  if (chargesEnabled && detailsSubmitted && !store.stripeOnboardingComplete) {
    notifyStripeConnected({
      id: store.id,
      name: store.name,
      slug: store.slug,
    }).catch(() => {});
  }

  log.info({
    stripeWebhook: {
      event: "account.updated",
      storeId: store.id,
      chargesEnabled,
      detailsSubmitted,
    },
  });
}

/** The dispute events that change the money the store keeps (fees.md §9). */
const FEE_REVERSAL_DISPUTE_EVENTS: ReadonlySet<DisputeEventType> = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.closed",
]);

/**
 * Every `charge.dispute.*` event updates the dispute's billing facts. The fee refund at
 * source runs first, reading the charge's disputes from Stripe; a reinstatement
 * restores no fee. The referral clawback runs on creation.
 */
async function handleChargeDispute(input: {
  eventType: DisputeEventType;
  dispute: Stripe.Dispute;
  eventCreatedAt: Date;
  connectedAccountId: string | undefined;
}) {
  const { eventType, dispute, connectedAccountId } = input;
  const chargeId = stripeRefId(dispute.charge);
  const paymentIntentId = stripeRefId(dispute.payment_intent);
  if (chargeId && connectedAccountId && FEE_REVERSAL_DISPUTE_EVENTS.has(eventType)) {
    await reverseFeeAtSource({ chargeId, accountId: connectedAccountId });
  }
  if (eventType === "charge.dispute.created" && paymentIntentId) {
    // Referral Program: a disputed qualifying payment claws back the Referrer Reward
    // (within the clawback window). Best-effort; never block dispute processing.
    await clawbackReferrerRewardForQualifyingPayment({
      stripePaymentIntentId: paymentIntentId,
    }).catch((error) => {
      log.error({
        referral: {
          event: "reward_clawback_failed",
          trigger: "dispute",
          disputeId: dispute.id,
          error: describeError(error),
        },
      });
    });
  }

  const result = await recordChargeDispute({
    dispute,
    eventType,
    eventCreatedAt: input.eventCreatedAt,
    accountId: connectedAccountId,
  });
  log.info({
    stripeWebhook: {
      event: eventType,
      disputeId: dispute.id,
      disputeStatus: dispute.status,
      ...(result.recorded
        ? { paymentId: result.paymentId, reservationId: result.reservationId }
        : { issue: result.reason }),
    },
  });
}

/**
 * A connected account disconnected the platform integration. Disable charges so no new
 * payment is attempted against an account we can no longer act on (we keep the stored
 * account id for audit; a re-onboard updates it via account.updated).
 */
async function handleAccountDeauthorized(connectedAccountId?: string) {
  if (!connectedAccountId) {
    log.warn({
      stripeWebhook: { event: "account.application.deauthorized", issue: "missing_account_id" },
    });
    return;
  }
  const store = await db.query.stores.findFirst({
    where: eq(stores.stripeAccountId, connectedAccountId),
  });
  if (!store) {
    log.info({
      stripeWebhook: {
        event: "account.application.deauthorized",
        issue: "store_not_found",
        accountId: connectedAccountId,
      },
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        stripeChargesEnabled: false,
        stripeOnboardingComplete: false,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));
    await markStore(tx, store.id);
  });
  log.warn({
    stripeWebhook: {
      event: "account.application.deauthorized",
      storeId: store.id,
      accountId: connectedAccountId,
    },
  });
}
