"use server";

import { getLocale } from "next-intl/server";

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { db, paymentRequests, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import { buildFeeMetadata, getStoreBilling, planStripeFees } from "@/lib/pay-as-you-go";
import { createReservationInstantAccessUrl } from "@/lib/customer-auth/instant-access";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { createPaymentRequestSession, toStripeCents } from "@/lib/stripe";

export type PaymentRequestError =
  | "store_not_found"
  | "reservation_not_found"
  | "invalid_token"
  | "already_paid"
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
    }
  | { ok: false; error: PaymentRequestError };

export type InitiatePaymentResult =
  | { ok: true; url: string }
  | { ok: false; error: PaymentRequestError };

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
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  if (paymentRequest.status === "completed") {
    return { ok: false as const, error: "already_paid" as const };
  }
  if (paymentRequest.status === "cancelled") {
    return { ok: false as const, error: "cancelled" as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: { customer: true },
  });
  if (!reservation) {
    return { ok: false as const, error: "reservation_not_found" as const };
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

  const currency = paymentRequest.currency;
  const chargeCents = toStripeCents(Number.parseFloat(paymentRequest.amount), currency);

  try {
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

    // Platform fees apply to rental payments only, never to custom charges
    // (damage fees); the exact breakdown is recorded by the webhook.
    const feePlan =
      paymentRequest.type === "rental"
        ? await planStripeFees({
            storeId: store.id,
            reservationId: reservation.id,
            chargeCents,
            billing: await getStoreBilling(store.id),
          })
        : null;

    const session = await createPaymentRequestSession({
      stripeAccountId: store.stripeAccountId,
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
      applicationFeeAmount: feePlan?.applicationFeeCents,
      feeMetadata: feePlan ? buildFeeMetadata(feePlan) : undefined,
      locale,
    });

    return { ok: true, url: session.url };
  } catch (error) {
    log.error("pay", `payment session failed: ${describeError(error)}`);
    return { ok: false, error: "session_creation_failed" };
  }
};
