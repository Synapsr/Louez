import {
  checkExistingReservationInventory,
  ReservationInventoryError,
} from "@louez/api/services/reservation-inventory";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { validateReservationContract, confirmMarketplaceBookingAttempt } from "@louez/api/services";
import {
  ConsumableStockError,
  changeReservationStatus,
  consumeReservationStock,
  db,
  runReservationChangeByStatus,
  runReservationOnlyChange,
  toWholeSeconds,
  type ReservationBillingEffect,
  type Transaction,
} from "@louez/db";
import { paymentRequests, payments, reservationActivity, reservations, stores } from "@louez/db";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { readFeeMetadata } from "@/lib/billing-sync/fee-metadata";
import { reservationTotalsMinor } from "@/lib/billing-sync/money";
import {
  notifyPaymentReceived,
  notifyReservationConfirmed,
} from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { markReservationForCalendarSync } from "@/lib/integrations/calendar/sync";
import { tryPrepareInitialInvoiceEmailDelivery } from "@/lib/invoicing/delivery";
import { tryGenerateInvoiceForPayment } from "@/lib/invoicing/service";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { fromStripeCents, getCheckoutSession } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";
import {
  claimCompletedCheckoutPayment,
  paymentInsuranceShareMinor,
} from "@/lib/stripe/payment-completion";
import { evaluateReservationRules } from "@louez/utils";

import { paidConfirmationKeepsDeposit } from "./util.paid-confirmation-deposit";

export type CheckoutPaymentCompletionSource = "webhook" | "return";

type DepositStatus = "none" | "card_saved" | "pending";

/** What the Stripe Checkout session and its PaymentIntent tell us. */
export interface CheckoutPaymentStripeDetails {
  sessionId: string;
  amountTotalCents: number;
  /** Upper-case ISO currency. */
  currency: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  /** The charge's `created` time, when the PaymentIntent was read with its charge. */
  chargeCreatedAt: Date | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  /** The connected account the session was created on. */
  stripeAccountId: string | null;
  /** The PaymentIntent's metadata: older sessions put the fee keys only there. */
  paymentIntentMetadata: Record<string, string> | null;
  sessionMetadata: Record<string, string> | null;
}

export type CompleteCheckoutPaymentInput =
  | {
      /** Customer landing back from Stripe: the session is fetched and checked here. */
      source: "return";
      storeId: string;
      reservationId: string;
      stripeCheckoutSessionId: string;
    }
  | {
      /** `checkout.session.completed`: the webhook already holds the session and PI. */
      source: "webhook";
      reservationId: string;
      stripe: CheckoutPaymentStripeDetails;
      /** Session created from a dashboard payment request, completed with the payment. */
      paymentRequestId?: string | null;
      /** Webhook-only analytics facts (platform fees, PAYG). */
      analytics?: Record<string, unknown>;
    };

export type CompleteCheckoutPaymentResult =
  | { status: "completed"; claimed: boolean; reservationConfirmed: boolean }
  | { status: "not_paid" }
  | { status: "not_found" }
  | { status: "payment_unavailable" };

type ReservationRow = NonNullable<Awaited<ReturnType<typeof loadReservationForCompletion>>>;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const loadReservationForCompletion = async (reservationId: string) =>
  db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: { store: true, customer: true, items: true },
  });

/**
 * The insurance share of a session created before fee metadata v4 carried it: a custom
 * payment request has none, everything else is rental money (billing fees.md §4).
 */
const insuranceShareAtClaim = async (
  reservation: ReservationRow,
  grossMinor: number,
  paymentRequestId: string | null,
): Promise<number | null> => {
  const request = paymentRequestId
    ? await db.query.paymentRequests.findFirst({
        where: and(
          eq(paymentRequests.id, paymentRequestId),
          eq(paymentRequests.storeId, reservation.storeId),
        ),
        columns: { type: true },
      })
    : undefined;
  return paymentInsuranceShareMinor(
    request?.type === "custom" ? "custom_request" : "rental",
    grossMinor,
    () =>
      reservationTotalsMinor({
        reservation,
        storeSettings: reservation.store.settings,
        items: reservation.items,
      }),
  );
};

/**
 * Whether one of the reservation's `deposit_hold` rows holds funds (`authorized`, a
 * release owed included) or took them (`completed`): `readHoldRows`' filter narrowed
 * to those statuses, served by `payments_reservation_idx`. Read under the
 * reservation's row lock, which every writer of a hold row takes first: it is what
 * the hold writer last committed.
 */
const depositLedgerHoldsFunds = async (tx: Transaction, reservationId: string) => {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, "deposit_hold"),
        inArray(payments.status, ["authorized", "completed"]),
      ),
    )
    .limit(1);
  return row !== undefined;
};

/**
 * The reservation's status and deposit as stored, read after its row lock, and
 * whether the paid confirmation leaves the deposit as it is
 * (`paidConfirmationKeepsDeposit`). Null when the reservation is not in the store.
 */
const readDepositUnderLock = async (
  tx: Transaction,
  scope: { reservationId: string; storeId: string },
) => {
  const [row] = await tx
    .select({ status: reservations.status, depositStatus: reservations.depositStatus })
    .from(reservations)
    .where(and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)));
  if (!row) return null;
  const keeps = paidConfirmationKeepsDeposit({
    depositStatus: row.depositStatus,
    ledgerHoldsFunds: await depositLedgerHoldsFunds(tx, scope.reservationId),
  });
  return { ...row, keeps };
};

/**
 * Confirms a paid pending reservation as the `payment` actor, with its
 * `confirmed` activity row. Returns false when it was not pending. Exported for
 * its database test. A reservation still busy after the owner entry's runs
 * throws `ReservationChangeBusyError`: the webhook answers non-2xx and Stripe
 * sends the event again; the payment's claim, committed before, stays.
 *
 * The session's customer, card and `depositStatus` are written on a pending
 * reservation unless funds are held or were taken on it: then its deposit is left
 * as stored, and the `confirmed` row says so (`depositStatusKept`).
 */
export const confirmPaidReservationOrThrow = async (params: {
  reservationId: string;
  storeId: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  depositStatus: DepositStatus;
  /** The metadata of the `confirmed` activity row. */
  activityMetadata: Record<string, unknown>;
}): Promise<boolean> => {
  const scope = { reservationId: params.reservationId, storeId: params.storeId };

  // Keep payment/deposit metadata even when stock consumption rolls back. A
  // merchant can then restock and confirm the paid reservation manually. Under
  // the reservation's lock alone, as the hold writer takes it, and committed
  // before the status transaction opens: it adds no lock order. The status
  // transaction decides again under its own lock, so a hold settled between the
  // two is seen there.
  await runReservationOnlyChange(scope, async (tx) => {
    const found = await readDepositUnderLock(tx, scope);
    if (found?.status !== "pending" || found.keeps) return;
    await tx
      .update(reservations)
      .set({
        stripeCustomerId: params.stripeCustomerId,
        stripePaymentMethodId: params.stripePaymentMethodId,
        depositStatus: params.depositStatus,
        updatedAt: new Date(),
      })
      .where(
        and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)),
      );
  });

  // A pending reservation is checked and takes its stock, a confirmed one is
  // repaired below: the owner entry locks their products, then the
  // reservation (DL-12). Any other status is left as it is, under the
  // reservation's lock alone. A lost deadlock, a product added or the status
  // changed meanwhile runs the whole transaction again. It records no
  // payment, so a new run cannot record one twice; the effects run once,
  // after it.
  const result = await runReservationChangeByStatus(
    scope,
    (status) => status === "pending" || status === "confirmed",
    async (tx, lock): Promise<{ confirmed: boolean; effects: ReservationBillingEffect[] }> => {
      // After the lock the owner entry took: the deposit and the ledger as the hold
      // writer last committed them, decided on with the status change.
      const found = await readDepositUnderLock(tx, scope);
      const change = await changeReservationStatus(tx, {
        lock,
        reservationId: params.reservationId,
        storeId: params.storeId,
        to: "confirmed",
        actor: "payment",
        actorUserId: null,
        expectedFrom: "pending",
        beforeWrite: (lockedTx) =>
          checkExistingReservationInventory(lockedTx, params.reservationId, params.storeId),
        activity: {
          metadata: {
            ...params.activityMetadata,
            ...(found?.keeps && { depositStatusKept: found.depositStatus }),
          },
        },
      });

      if (!change.changed) {
        // Already confirmed, by the other completion path or the merchant: make
        // sure its consumables were taken. Consuming twice changes nothing. Read
        // as confirmed under its lock, so the lock is the products'.
        if (change.from === "confirmed" && lock.kind === "products") {
          await consumeReservationStock(tx, lock);
        }
        return { confirmed: false, effects: [] };
      }

      if (!found?.keeps) {
        await tx
          .update(reservations)
          .set({
            stripeCustomerId: params.stripeCustomerId,
            stripePaymentMethodId: params.stripePaymentMethodId,
            depositStatus: params.depositStatus,
          })
          .where(
            and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)),
          );
      }

      return { confirmed: true, effects: change.effects };
    },
  );

  // The webhook records a paid checkout's fee itself, so this is empty today.
  await runReservationEffects(result.effects);
  return result.confirmed;
};

/**
 * Confirm a paid pending reservation and consume its consumable stock. Stock
 * that ran out between checkout and confirmation leaves the reservation
 * pending rather than failing the webhook or the customer's return: the
 * merchant restocks and confirms from the dashboard, or confirms it there
 * over the returnable stock (`allowOverbooking`) or past the turnover buffer
 * (`overrideTurnoverBuffer`), which no payment passes.
 */
const confirmPaidReservation = async (
  params: Parameters<typeof confirmPaidReservationOrThrow>[0],
  source: CheckoutPaymentCompletionSource,
): Promise<boolean> => {
  try {
    return await confirmPaidReservationOrThrow(params);
  } catch (error) {
    if (error instanceof ReservationInventoryError) {
      log.error("checkout", `Inventory conflict on paid confirmation: ${params.reservationId}`);
      return false;
    }
    if (error instanceof ConsumableStockError) {
      log.error({
        checkout: {
          event: "consumable_stock_insufficient_on_confirmation",
          source,
          reservationId: params.reservationId,
          productId: error.productId,
          requestedQuantity: error.requestedQuantity,
          availableQuantity: error.availableQuantity,
        },
      });
      return false;
    }
    throw error;
  }
};

const toStoreInfo = (store: ReservationRow["store"]) => ({
  id: store.id,
  name: store.name,
  slug: store.slug,
});

const toAdminNotificationStore = (store: ReservationRow["store"]) => ({
  id: store.id,
  name: store.name,
  email: store.email,
  discordWebhookUrl: store.discordWebhookUrl,
  ownerPhone: store.ownerPhone,
  notificationSettings: store.notificationSettings,
  settings: store.settings,
});

const toNotificationReservation = (reservation: ReservationRow) => ({
  id: reservation.id,
  number: reservation.number,
  startDate: reservation.startDate,
  endDate: reservation.endDate,
  totalAmount: Number(reservation.totalAmount),
  // Its own currency, frozen when it was made; null for an older one, which states the store's.
  currency: reservation.currency,
});

const toNotificationCustomer = (customer: ReservationRow["customer"]) =>
  customer
    ? {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      }
    : undefined;

/**
 * Claim → confirm → effects, once per (reservation, session) whichever path
 * arrives first. The claim is atomic under a row lock, so the webhook and the
 * customer's return can both run: only the claiming path emits the payment
 * effects, and only the confirming path emits the confirmation effects.
 */
const runCheckoutPaymentCompletion = async ({
  source,
  reservation,
  stripe: stripeDetails,
  paymentRequestId,
  analytics,
}: {
  source: CheckoutPaymentCompletionSource;
  reservation: ReservationRow;
  stripe: CheckoutPaymentStripeDetails;
  paymentRequestId?: string | null;
  analytics?: Record<string, unknown>;
}): Promise<CompleteCheckoutPaymentResult> => {
  const { store } = reservation;
  const reservationId = reservation.id;
  const statusBefore = reservation.status;
  const currency = stripeDetails.currency;
  const totalAmount = fromStripeCents(stripeDetails.amountTotalCents, currency);
  const depositAmount = Number(reservation.depositAmount) || 0;
  const depositStatus: DepositStatus =
    depositAmount > 0
      ? stripeDetails.stripeCustomerId && stripeDetails.stripePaymentMethodId
        ? "card_saved"
        : "pending"
      : "none";
  // Whole seconds, as the status change stores the `confirmed` row: MySQL would
  // round this one up, and the timeline would show the payment after it.
  const paidAt = toWholeSeconds(new Date());

  // v3 fee keys were written on the PaymentIntent only; v4 is on both.
  const feeFacts =
    readFeeMetadata(stripeDetails.paymentIntentMetadata) ??
    readFeeMetadata(stripeDetails.sessionMetadata);
  const grossMinor = stripeDetails.amountTotalCents;
  const insuranceShareMinor =
    feeFacts?.insuranceShareMinor ??
    (await insuranceShareAtClaim(reservation, grossMinor, paymentRequestId ?? null));

  const paymentClaim = await claimCompletedCheckoutPayment({
    reservationId,
    amount: totalAmount,
    currency,
    stripeCheckoutSessionId: stripeDetails.sessionId,
    stripePaymentIntentId: stripeDetails.paymentIntentId,
    stripeChargeId: stripeDetails.chargeId,
    stripePaymentMethodId: stripeDetails.stripePaymentMethodId,
    stripeAccountId: stripeDetails.stripeAccountId,
    claimedAt: paidAt,
    // The charge time, so a payment made just before midnight stays in its month.
    paidAt: stripeDetails.chargeCreatedAt ?? paidAt,
    grossMinor,
    insuranceShareMinor,
    origin: paymentRequestId
      ? "payment_request"
      : stripeDetails.sessionMetadata?.checkoutFlow === "storefront_checkout"
        ? "checkout"
        : "customer_session",
    paymentRequestId: paymentRequestId ?? null,
    feeFacts,
  });

  await db.transaction((tx) =>
    validateReservationContract(tx, reservationId, reservation.storeId, "payment"),
  );

  if (reservation.source === "marketplace") {
    await confirmMarketplaceBookingAttempt(reservationId);
  }

  const invoiceSource =
    source === "webhook"
      ? paymentClaim.claimed
        ? "stripe_checkout_webhook"
        : "stripe_checkout_webhook_existing_payment"
      : paymentClaim.claimed
        ? "checkout_success_fallback"
        : "checkout_success_existing_payment";
  await tryGenerateInvoiceForPayment(paymentClaim.paymentId, invoiceSource);

  if (paymentClaim.claimed) {
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "payment_received",
      description: null,
      metadata: {
        paymentIntentId: stripeDetails.paymentIntentId,
        chargeId: stripeDetails.chargeId,
        checkoutSessionId: stripeDetails.sessionId,
        amount: totalAmount,
        currency,
        method: "stripe",
        type: "rental",
        ...(source === "return" && { source: "success_page_verification" }),
      },
      createdAt: paidAt,
    });

    dispatchNotification("payment_received", {
      actor: "system",
      store: toAdminNotificationStore(store),
      reservation: toNotificationReservation(reservation),
      customer: toNotificationCustomer(reservation.customer),
      payment: { amount: totalAmount, currency },
    }).catch((error: unknown) => {
      log.error("checkout", `payment received notification failed: ${describeError(error)}`);
    });

    notifyPaymentReceived(toStoreInfo(store), reservation.number, totalAmount, currency).catch(
      () => {},
    );
  }

  // Pure, so the activity row can be written with the status change.
  const validationWarnings = evaluateReservationRules({
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    storeSettings: store.settings,
  });
  const reservationConfirmed = await confirmPaidReservation(
    {
      reservationId,
      storeId: store.id,
      stripeCustomerId: stripeDetails.stripeCustomerId,
      stripePaymentMethodId: stripeDetails.stripePaymentMethodId,
      depositStatus,
      activityMetadata: {
        source: "online_payment",
        depositAmount,
        depositStatus,
        cardSaved: Boolean(stripeDetails.stripePaymentMethodId),
        ...(validationWarnings.length > 0 && {
          validationWarnings,
          validationWarningsCount: validationWarnings.length,
        }),
      },
    },
    source,
  );

  if (paymentClaim.claimed) {
    // Each path keeps the meaning its funnel event always had: the webhook
    // reports "was pending before this event", the customer's return reports
    // the actual confirmation outcome (false when a consumable ran out).
    await captureProductServerEvent({
      distinctId: reservation.customerId,
      event: productAnalyticsEvents.checkoutPaymentCompleted,
      properties: {
        feature: "checkout",
        surface: "storefront",
        store_id: store.id,
        reservation_id: reservationId,
        customer_id: reservation.customerId,
        source: source === "webhook" ? "stripe_connect_webhook" : "success_page_verification",
        payment_provider: "stripe",
        amount_cents: toAnalyticsAmountCents(totalAmount),
        deposit_amount_cents: toAnalyticsAmountCents(depositAmount),
        currency,
        has_deposit: depositAmount > 0,
        card_saved: Boolean(stripeDetails.stripePaymentMethodId),
        payment_intent_present: Boolean(stripeDetails.paymentIntentId),
        reservation_status_before: statusBefore,
        ...(source === "webhook"
          ? {
              payment_request_present: Boolean(paymentRequestId),
              reservation_confirmed_by_event: statusBefore === "pending",
            }
          : { reservation_confirmed_by_event: reservationConfirmed }),
        ...analytics,
      },
    });
  }

  if (reservationConfirmed) {
    if (validationWarnings.length > 0) {
      log.warn({
        checkout: {
          event: "reservation_confirmed_with_rule_violations",
          source,
          reservationId,
          storeId: store.id,
          warnings: validationWarnings,
        },
      });
    }

    dispatchNotification("reservation_confirmed", {
      actor: "system",
      store: toAdminNotificationStore(store),
      reservation: toNotificationReservation(reservation),
      customer: toNotificationCustomer(reservation.customer),
    }).catch((error: unknown) => {
      log.error("checkout", `confirmation notification failed: ${describeError(error)}`);
    });

    if (reservation.customer) {
      const invoiceDelivery = await tryPrepareInitialInvoiceEmailDelivery(reservationId);
      dispatchCustomerNotification("customer_reservation_confirmed", {
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
          ...toNotificationReservation(reservation),
          subtotalAmount: Number(reservation.subtotalAmount),
          depositAmount: Number(reservation.depositAmount),
          taxEnabled: Boolean(reservation.taxRate),
          taxRate: reservation.taxRate ? Number(reservation.taxRate) : null,
          subtotalExclTax: reservation.subtotalExclTax ? Number(reservation.subtotalExclTax) : null,
          taxAmount: reservation.taxAmount ? Number(reservation.taxAmount) : null,
        },
        items: reservation.items.map((item) => ({
          name: item.productSnapshot?.name || "Product",
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
        reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`),
        documentAttachments: invoiceDelivery.attachments,
        contractSignatureUrl: invoiceDelivery.contractSignatureUrl,
      }).catch((error: unknown) => {
        log.error("checkout", `customer confirmation dispatch failed: ${describeError(error)}`);
      });
    }

    notifyReservationConfirmed(toStoreInfo(store), reservation.number).catch(() => {});

    try {
      await markReservationForCalendarSync(store.id, reservationId);
    } catch (error) {
      log.error("checkout", `calendar sync enqueue failed: ${describeError(error)}`);
    }
  }

  log.info({
    checkout: {
      event: "payment_completed",
      source,
      reservationId,
      claimed: paymentClaim.claimed,
      reservationConfirmed,
      depositStatus,
    },
  });

  return { status: "completed", claimed: paymentClaim.claimed, reservationConfirmed };
};

/**
 * Shared completion of a Stripe Checkout payment for a reservation, used by
 * the Connect webhook and by the customer's return from Stripe.
 */
export const completeCheckoutPayment = async (
  input: CompleteCheckoutPaymentInput,
): Promise<CompleteCheckoutPaymentResult> => {
  if (input.source === "webhook") {
    const reservation = await loadReservationForCompletion(input.reservationId);
    if (!reservation) {
      return { status: "not_found" };
    }
    return runCheckoutPaymentCompletion({
      source: "webhook",
      reservation,
      stripe: input.stripe,
      paymentRequestId: input.paymentRequestId,
      analytics: input.analytics,
    });
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, input.storeId),
    columns: { id: true, stripeAccountId: true },
  });
  if (!store) {
    return { status: "not_found" };
  }
  if (!store.stripeAccountId) {
    return { status: "payment_unavailable" };
  }

  const session = await getCheckoutSession(store.stripeAccountId, input.stripeCheckoutSessionId);

  // The session id comes from the URL: it must be the session created for
  // THIS reservation (`createCheckoutSession` stamps the id in the metadata),
  // otherwise a paid session could be replayed onto another pending reservation.
  if (session.metadata?.reservationId !== input.reservationId) {
    log.warn({
      security: {
        event: "checkout_session_reservation_mismatch",
        storeId: store.id,
        reservationId: input.reservationId,
        sessionId: session.id,
      },
    });
    return { status: "not_found" };
  }

  if (session.paymentStatus !== "paid") {
    return { status: "not_paid" };
  }

  let paymentIntentId: string | null = null;
  let chargeId: string | null = null;
  let chargeCreatedAt: Date | null = null;
  let stripeCustomerId: string | null = null;
  let stripePaymentMethodId: string | null = null;
  let paymentIntentMetadata: Record<string, string> | null = null;
  if (session.paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.paymentIntentId,
      { expand: ["latest_charge"] },
      { stripeAccount: store.stripeAccountId },
    );
    paymentIntentId = paymentIntent.id;
    const charge = paymentIntent.latest_charge;
    if (typeof charge === "string") {
      chargeId = charge;
    } else if (charge) {
      chargeId = charge.id;
      chargeCreatedAt = new Date(charge.created * 1000);
    }
    stripeCustomerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer : null;
    stripePaymentMethodId =
      typeof paymentIntent.payment_method === "string" ? paymentIntent.payment_method : null;
    paymentIntentMetadata = paymentIntent.metadata;
  }
  if (!stripeCustomerId && session.customerId) {
    stripeCustomerId = session.customerId;
  }

  const reservation = await loadReservationForCompletion(input.reservationId);
  if (!reservation || reservation.storeId !== store.id) {
    return { status: "not_found" };
  }

  return runCheckoutPaymentCompletion({
    source: "return",
    reservation,
    stripe: {
      sessionId: session.id,
      amountTotalCents: session.amountTotal || 0,
      currency: session.currency,
      paymentIntentId,
      chargeId,
      chargeCreatedAt,
      stripeCustomerId,
      stripePaymentMethodId,
      stripeAccountId: store.stripeAccountId,
      paymentIntentMetadata,
      sessionMetadata: session.metadata,
    },
    // Louez wrote it on the session it created for the request.
    paymentRequestId: session.metadata?.paymentRequestId ?? null,
  });
};
