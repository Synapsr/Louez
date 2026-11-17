import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { validateReservationContract } from "@louez/api/services";
import { confirmPaidReservation } from "@louez/api/services/payment-reservation-status";
import { ReservationInventoryError } from "@louez/api/services/reservation-inventory";
import {
  ConsumableStockError,
  type DatabaseOnConnection,
  documents,
  payments,
  reservationActivity,
  reservations,
  toWholeSeconds,
} from "@louez/db";
import { normalizeCurrency } from "@louez/utils";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { withNamedLock } from "@/lib/billing-sync/locks";
import { log } from "@/lib/evlog";
import { tryGenerateInvoiceForPayment } from "@/lib/invoicing/service";
import { getCheckoutChargeAmount } from "@/lib/reservations/build-stripe-line-items";
import {
  loadReservationForCompletion,
  sendPaidConfirmationMessages,
} from "@/lib/reservations/complete-checkout-payment";

/** The note of the payment row a simulated payment writes. */
export const SIMULATED_PAYMENT_NOTE = "Paiement simulé (réservation test)";

export type SimulatedPaymentResult =
  | { ok: true; confirmed: boolean }
  | { ok: false; error: "not_found" | "not_pending" | "busy" };

/**
 * What a test reservation's payment is worth: what the real checkout would have
 * charged (the store's online deposit percentage of the total), in the
 * reservation's currency. Pure, for the page and the payment row.
 */
export const simulatedPaymentAmount = (input: {
  totalAmount: string;
  currency: string | null;
  depositPercentage: number | undefined;
  storeCurrency: string | undefined;
}): { amount: number; currency: string } => {
  const currency = normalizeCurrency(input.currency, normalizeCurrency(input.storeCurrency));
  const { finalChargeAmount } = getCheckoutChargeAmount({
    total: Number.parseFloat(input.totalAmount),
    depositPercentage: input.depositPercentage ?? 100,
    currency,
  });
  return { amount: finalChargeAmount, currency };
};

/** How long a simulated payment waits for another one of the same reservation to finish. */
const LOCK_WAIT_SECONDS = 5;

/** The MySQL named lock a reservation's simulated payment runs under. */
export const simulatedPaymentLockName = (reservationId: string): string =>
  `louez:test-payment:${reservationId}`;

/**
 * The simulated payment of a test reservation (packages/db test-reservations.ts):
 * the confirmation a paid checkout gets, with nothing asked of Stripe and nothing
 * billed. One call at a time per reservation, under a MySQL named lock: a call that
 * waits `LOCK_WAIT_SECONDS` without it answers `busy`, and the page asks to try
 * again. Under it, each step finishes what an earlier call left undone and does no
 * more, so a call that failed halfway is completed by the next:
 *
 * 1. the payment, one completed `other` rental row, written once (not for a
 *    reservation no longer pending that has none);
 * 2. the contract's validation (`validateReservationContract`, which validates a
 *    contract once);
 * 3. the contract's document, generated only when the reservation has none
 *    (`tryGenerateInvoiceForPayment`, which never throws);
 * 4. the confirmation as paid, of a pending reservation only (no deposit is taken);
 * 5. its messages, sent by the call that confirmed it alone.
 *
 * Never a Stripe call, a fee, a referral or marketplace effect, or an invoice (the
 * invoicing service refuses a test reservation, and attaches its watermarked
 * contract where the store would attach documents).
 */
export async function simulateTestReservationPayment(input: {
  storeId: string;
  reservationId: string;
}): Promise<SimulatedPaymentResult> {
  const run = await withNamedLock(
    simulatedPaymentLockName(input.reservationId),
    LOCK_WAIT_SECONDS,
    (lockedDb) => simulateUnderLock(lockedDb, input),
  );
  return run.ran ? run.value : { ok: false, error: "busy" };
}

async function simulateUnderLock(
  lockedDb: DatabaseOnConnection,
  input: { storeId: string; reservationId: string },
): Promise<SimulatedPaymentResult> {
  const paidAt = toWholeSeconds(new Date());

  type Claim = { paymentId: string } | { error: "not_found" | "not_pending" };
  const claim = await lockedDb.transaction(async (tx): Promise<Claim> => {
    const [locked] = await tx
      .select({
        isTest: reservations.isTest,
        status: reservations.status,
        totalAmount: reservations.totalAmount,
        currency: reservations.currency,
      })
      .from(reservations)
      .where(and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)))
      .for("update");
    if (!locked?.isTest) return { error: "not_found" };

    const [existing] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, input.reservationId),
          eq(payments.type, "rental"),
          eq(payments.status, "completed"),
        ),
      )
      .limit(1);
    if (existing) return { paymentId: existing.id };
    if (locked.status !== "pending") return { error: "not_pending" };

    const store = await tx.query.stores.findFirst({
      where: (stores, { eq: equals }) => equals(stores.id, input.storeId),
      columns: { settings: true },
    });
    const { amount, currency } = simulatedPaymentAmount({
      totalAmount: locked.totalAmount,
      currency: locked.currency,
      depositPercentage: store?.settings?.onlinePaymentDepositPercentage,
      storeCurrency: store?.settings?.currency,
    });
    const paymentId = nanoid();
    await tx.insert(payments).values({
      id: paymentId,
      reservationId: input.reservationId,
      amount: amount.toFixed(2),
      type: "rental",
      method: "other",
      status: "completed",
      currency,
      notes: SIMULATED_PAYMENT_NOTE,
      paidAt,
      createdAt: paidAt,
      updatedAt: new Date(),
    });
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId: input.reservationId,
      activityType: "payment_received",
      description: null,
      metadata: { amount, currency, method: "other", type: "rental", simulated: true },
      createdAt: paidAt,
    });
    return { paymentId };
  });
  if (!("paymentId" in claim)) return { ok: false, error: claim.error };

  await lockedDb.transaction((tx) =>
    validateReservationContract(tx, input.reservationId, input.storeId, "payment"),
  );

  const [contract] = await lockedDb
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.reservationId, input.reservationId), eq(documents.type, "contract")))
    .limit(1);
  if (!contract) {
    // Refused for a test reservation: it only generates the watermarked contract
    // where the store would attach documents to the confirmation.
    await tryGenerateInvoiceForPayment(claim.paymentId, "test_reservation_simulated_payment");
  }

  // Its items hold no stock, but its capacity is still checked: one past it stays
  // pending, as a paid checkout does, and the owner confirms it from the dashboard.
  // A reservation no longer pending is not confirmed again (false).
  const confirmed = await confirmPaidReservation(
    {
      reservationId: input.reservationId,
      storeId: input.storeId,
      paymentId: claim.paymentId,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      depositStatus: "none",
      activityMetadata: { source: "simulated_payment", depositStatus: "none" },
    },
    runReservationEffects,
  ).catch((error: unknown) => {
    if (error instanceof ReservationInventoryError || error instanceof ConsumableStockError) {
      log.warn("test-reservations", `simulated payment left ${input.reservationId} pending`);
      return false;
    }
    throw error;
  });

  if (confirmed) {
    const reservation = await loadReservationForCompletion(input.reservationId);
    if (reservation) await sendPaidConfirmationMessages(reservation);
  }
  return { ok: true, confirmed };
}
