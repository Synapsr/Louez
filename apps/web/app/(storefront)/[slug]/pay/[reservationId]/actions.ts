"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { acceptReservationContract } from "@louez/api/services";
import { db, paymentRequests, reservations, type Transaction } from "@louez/db";
import { normalizeCurrency, validateStripePaymentAmount } from "@louez/utils";

import { reservationTotalsMinor } from "@/lib/billing-sync/money";
import { log } from "@/lib/evlog";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import {
  openRentalCheckoutSession,
  type LockedReservation,
} from "@/lib/reservations/rental-session-gate";
import { getRentalPaid } from "@/lib/reservations/util.payment-status";
import { getRentalRemaining } from "@/lib/reservations/util.rental-amount";
import { buildFeeMetadata, planApplicationFee } from "@/lib/pay-as-you-go";
import { createReservationInstantAccessUrl } from "@/lib/customer-auth/instant-access";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { createPaymentRequestSession, toStripeCents } from "@/lib/stripe";
import { paymentInsuranceShareMinor } from "@/lib/stripe/payment-completion";

export type PaymentRequestError =
  | "store_not_found"
  | "reservation_not_found"
  | "invalid_token"
  | "already_paid"
  | "no_longer_current"
  | "cancelled"
  | "stripe_not_configured"
  | "session_creation_failed";

export type PaymentRequestData =
  | {
      ok: true;
      store: { name: string; slug: string };
      reservation: { id: string; number: string };
      paymentRequest: { id: string; amount: number; currency: string; description: string };
      customer: { firstName: string };
      /** The customer has not accepted the rental terms yet: they do it before paying. */
      requiresContractAcceptance: boolean;
    }
  | { ok: false; error: PaymentRequestError };

export type InitiatePaymentResult =
  | { ok: true; url: string }
  | { ok: false; error: PaymentRequestError | "contract_not_accepted" }
  | { ok: false; error: "amount_too_small"; minimumAmount: number; currency: string };

// The Stripe session lives 30 minutes; the token that logs the customer in on
// the way back is minted before it, outlives it by half an hour and is
// consumed on first use (under the one-hour single-use threshold).
const PAYMENT_RETURN_ACCESS_TTL_MS = 60 * 60 * 1000;

const accessInputSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  reservationId: z.string().trim().min(1).max(64),
  token: z.string().trim().min(1).max(128).optional(),
});

const initiateInputSchema = accessInputSchema.extend({
  token: z.string().trim().min(1).max(128),
  paymentRequestId: z.string().trim().min(1).max(64),
  acceptContract: z.boolean().default(false),
});

/** Paying for the rental is when a customer who has not signed yet accepts the rental terms. */
const requiresContractAcceptance = (
  reservation: { signedAt: Date | null },
  paymentRequest: { type: "rental" | "custom" },
): boolean => reservation.signedAt === null && paymentRequest.type === "rental";

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The statuses on which a request may still be paid: the store sends one before
 * it confirms, while the rental runs, or after it ends, for what remains or for
 * damage. A cancelled, rejected or declined reservation, or a quote not accepted,
 * opens nothing.
 */
const REQUEST_PAYABLE_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "confirmed",
  "ongoing",
  "completed",
]);

type PaymentRequestRow = typeof paymentRequests.$inferSelect;

/**
 * Whether the request may still be paid on the reservation, read when the page
 * loads and again under the reservation's lock when its session is installed.
 * A rental request never collects more than the rental still owed: a request
 * written before the total went down, or before a payment was recorded, is no
 * longer current and the store asks again. Nothing is charged and the request is
 * left as it is. A request in another currency than the reservation's settles
 * none of it, and is no longer current either. A custom request asks what the
 * store chose.
 */
const requestRefusal = (
  paymentRequest: Pick<PaymentRequestRow, "type" | "currency" | "amount" | "status" | "expiresAt">,
  reservation: Pick<LockedReservation, "status" | "totalAmount" | "currency" | "payments">,
  storeSettings: Parameters<typeof reservationCurrency>[1],
): PaymentRequestError | null => {
  if (paymentRequest.status === "completed") return "already_paid";
  if (paymentRequest.status === "cancelled") return "cancelled";
  if (paymentRequest.expiresAt.getTime() <= Date.now()) return "invalid_token";
  if (!REQUEST_PAYABLE_STATUSES.has(reservation.status)) return "cancelled";
  if (paymentRequest.type !== "rental") return null;
  const currency = reservationCurrency(reservation.currency, storeSettings);
  if (normalizeCurrency(paymentRequest.currency, "") !== currency) return "no_longer_current";
  const owed = getRentalRemaining(reservation, getRentalPaid(reservation.payments, currency));
  const owedHundredths = Math.round(owed * 100);
  if (owedHundredths === 0) return "already_paid";
  if (Math.round(Number(paymentRequest.amount) * 100) > owedHundredths) {
    return "no_longer_current";
  }
  return null;
};

/**
 * The request as the reservation's lock holds it: its completion takes that lock
 * before it completes the request, so one completed meanwhile is seen.
 */
const readRequest = async (
  tx: Transaction,
  { id, storeId, reservationId }: Pick<PaymentRequestRow, "id" | "storeId" | "reservationId">,
) => {
  const [row] = await tx
    .select({
      type: paymentRequests.type,
      currency: paymentRequests.currency,
      amount: paymentRequests.amount,
      status: paymentRequests.status,
      expiresAt: paymentRequests.expiresAt,
    })
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.id, id),
        eq(paymentRequests.storeId, storeId),
        eq(paymentRequests.reservationId, reservationId),
      ),
    );
  return row;
};

/** Store, live token, reservation and Stripe checks shared by both actions. */
const loadPaymentRequestContext = async ({
  slug,
  reservationId,
  token,
}: z.infer<typeof accessInputSchema>) => {
  const store = await getStoreBySlug(slug);
  if (!store) {
    return { ok: false as const, error: "store_not_found" as const };
  }

  if (!token) {
    return { ok: false as const, error: "invalid_token" as const };
  }
  const paymentRequest = await db.query.paymentRequests.findFirst({
    where: and(
      eq(paymentRequests.token, token),
      eq(paymentRequests.reservationId, reservationId),
      eq(paymentRequests.storeId, store.id),
      gt(paymentRequests.expiresAt, new Date()),
    ),
  });
  if (!paymentRequest) {
    return { ok: false as const, error: "invalid_token" as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
      // The insurance share of a rental payment reads the reservation's totals.
      items: { columns: { productId: true, taxRate: true, totalPrice: true } },
      // What a rental request may still collect reads what was paid.
      payments: true,
    },
  });
  if (!reservation) {
    return { ok: false as const, error: "reservation_not_found" as const };
  }

  const refusal = requestRefusal(paymentRequest, reservation, store.settings);
  if (refusal) {
    return { ok: false as const, error: refusal };
  }

  // Read once: a connected account that cannot charge yet is "not configured".
  const isStripeChargeable = Boolean(store.stripeAccountId && store.stripeChargesEnabled);
  if (!isStripeChargeable || !store.stripeAccountId) {
    return { ok: false as const, error: "stripe_not_configured" as const };
  }

  return {
    ok: true as const,
    store: { ...store, stripeAccountId: store.stripeAccountId },
    reservation,
    paymentRequest,
  };
};

export const getPaymentRequestData = async (
  rawInput: z.input<typeof accessInputSchema>,
): Promise<PaymentRequestData> => {
  const parsed = accessInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_token" };
  }

  const context = await loadPaymentRequestContext(parsed.data);
  if (!context.ok) {
    return context;
  }

  const { store, reservation, paymentRequest } = context;
  return {
    ok: true,
    store: { name: store.name, slug: store.slug },
    reservation: { id: reservation.id, number: reservation.number },
    paymentRequest: {
      id: paymentRequest.id,
      amount: Number.parseFloat(paymentRequest.amount),
      currency: paymentRequest.currency,
      description: paymentRequest.description,
    },
    customer: { firstName: reservation.customer.firstName },
    requiresContractAcceptance: requiresContractAcceptance(reservation, paymentRequest),
  };
};

/** Open the Stripe session for the request; the customer comes back logged in. */
export const initiatePayment = async (
  rawInput: z.input<typeof initiateInputSchema>,
): Promise<InitiatePaymentResult> => {
  const parsed = initiateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_token" };
  }

  const context = await loadPaymentRequestContext(parsed.data);
  if (!context.ok) {
    return context;
  }

  const { store, reservation, paymentRequest } = context;
  if (paymentRequest.id !== parsed.data.paymentRequestId || paymentRequest.status !== "pending") {
    return { ok: false, error: "invalid_token" };
  }
  // The customer signs by accepting the rental terms here, with the date and their IP
  // address, before paying. The contract picks the signature up when it is next generated.
  if (requiresContractAcceptance(reservation, paymentRequest)) {
    if (!parsed.data.acceptContract) {
      return { ok: false, error: "contract_not_accepted" };
    }
    await acceptReservationContract({
      reservationId: reservation.id,
      storeId: store.id,
      headers: await headers(),
      method: "payment_page",
    });
  }

  const currency = paymentRequest.currency;
  const chargeCents = toStripeCents(Number.parseFloat(paymentRequest.amount), currency);
  const paymentAmount = validateStripePaymentAmount(
    Number.parseFloat(paymentRequest.amount),
    currency,
  );
  if (!paymentAmount.ok) {
    return paymentAmount.error === "errors.paymentAmountTooSmall"
      ? { ok: false, error: "amount_too_small", ...paymentAmount.params }
      : { ok: false, error: "session_creation_failed" };
  }

  try {
    const paymentKind = paymentRequest.type === "rental" ? "rental" : "custom_request";
    const insuranceShareMinor = paymentInsuranceShareMinor(paymentKind, chargeCents, () =>
      reservationTotalsMinor({
        reservation,
        storeSettings: store.settings,
        items: reservation.items,
      }),
    );

    // The rental's one gate, shared with the customer's own payment session: a
    // custom request's payment is recorded as a rental payment too, so it takes
    // the same gate, without the rental's balance. Sending the request again
    // replaces its session; another door's open session is replaced the same way.
    const outcome = await openRentalCheckoutSession({
      storeId: store.id,
      reservationId: reservation.id,
      stripeAccountId: store.stripeAccountId,
      check: async (tx, locked) => {
        if (!locked) return "reservation_not_found";
        const current = await readRequest(tx, paymentRequest);
        return current ? requestRefusal(current, locked, store.settings) : "invalid_token";
      },
      create: async ({ idempotencyKey }) => {
        const [successUrl, locale] = await Promise.all([
          createReservationInstantAccessUrl({
            storeId: store.id,
            storeSlug: store.slug,
            customerEmail: reservation.customer.email,
            reservationId: reservation.id,
            redirectPath: `/account/reservations/${reservation.id}?event=payment_received`,
            ttlMs: PAYMENT_RETURN_ACCESS_TTL_MS,
          }),
          getLocale(),
        ]);
        // The legacy planner takes no fee on a custom charge (damage fees); a store the
        // billing service bills pays what its policy says of the kind. The payment
        // copies the fee from the metadata when it completes.
        const feePlan = await planApplicationFee({
          storeId: store.id,
          reservationId: reservation.id,
          kind: paymentKind,
          chargeMinor: chargeCents,
          currency,
          insuranceShareMinor: insuranceShareMinor ?? 0,
        });
        return createPaymentRequestSession({
          stripeAccountId: store.stripeAccountId,
          idempotencyKey,
          reservationId: reservation.id,
          reservationNumber: reservation.number,
          customerEmail: reservation.customer.email,
          customerName: `${reservation.customer.firstName} ${reservation.customer.lastName}`,
          amount: chargeCents,
          description: paymentRequest.description,
          currency,
          successUrl,
          cancelUrl: getStorefrontUrl(
            store.slug,
            `/pay/${reservation.id}?token=${encodeURIComponent(parsed.data.token)}`,
          ),
          paymentRequestId: paymentRequest.id,
          applicationFeeAmount: feePlan.applicationFeeCents,
          feeMetadata: buildFeeMetadata(feePlan, {
            insuranceShareMinor: insuranceShareMinor ?? 0,
            paymentKind,
            reservationId: reservation.id,
            storeId: store.id,
          }),
          locale,
        });
      },
      attempt: {
        amount: paymentRequest.amount,
        currency: normalizeCurrency(paymentRequest.currency),
        origin: "payment_request",
        paymentRequestId: paymentRequest.id,
        activity: { source: "payment_request" },
      },
    });
    if (outcome.ok) return { ok: true, url: outcome.session.url };
    if (outcome.refusal === "paid") {
      // An earlier session of the rental was paid and is now recorded: the request
      // reads what that leaves.
      const now = await loadPaymentRequestContext(parsed.data);
      return now.ok ? { ok: false, error: "session_creation_failed" } : now;
    }
    // A session that may still be paid, or another one opened meanwhile: nothing
    // new, and the next try asks again.
    if (outcome.refusal === "busy") return { ok: false, error: "session_creation_failed" };
    return { ok: false, error: outcome.refusal };
  } catch (error) {
    log.error("pay", `payment session failed: ${describeError(error)}`);
    return { ok: false, error: "session_creation_failed" };
  }
};
