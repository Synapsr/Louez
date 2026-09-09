"use server";

import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db, payments, reservationActivity, reservations, verificationCodes } from "@louez/db";

import { log } from "@/lib/evlog";
import {
  INSTANT_ACCESS_SHORT_TTL_MS,
  createReservationInstantAccessUrl,
} from "@/lib/customer-auth/instant-access";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { createDepositAuthorizationIntent, toStripeCents } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";

import { verifyDepositHold } from "./util.deposit-hold";

export type DepositAuthorizationError =
  | "store_not_found"
  | "reservation_not_found"
  | "invalid_token"
  | "stripe_not_configured"
  | "deposit_already_authorized"
  | "no_deposit_required"
  | "payment_intent_creation_failed"
  | "not_authorized"
  | "confirmation_failed";

export type DepositAuthorizationData =
  | {
      ok: true;
      store: {
        id: string;
        name: string;
        slug: string;
        stripeAccountId: string;
        theme: { primaryColor: string; mode: "light" | "dark" } | null;
      };
      reservation: { id: string; number: string; depositAmount: number };
      customer: { firstName: string; email: string };
      currency: string;
    }
  | { ok: false; error: DepositAuthorizationError };

export type DepositPaymentIntentResult =
  | { ok: true; clientSecret: string }
  | { ok: false; error: DepositAuthorizationError };

export type ConfirmDepositAuthorizationResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: DepositAuthorizationError };

const AUTHORIZATION_HOLD_DAYS = 7;

const accessInputSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  reservationId: z.string().trim().min(1).max(64),
  token: z.string().trim().min(1).max(128).optional(),
});

const confirmInputSchema = accessInputSchema.extend({
  token: z.string().trim().min(1).max(128),
  paymentIntentId: z.string().trim().min(1).max(255),
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Store, reservation, token and deposit checks shared by the three actions.
 * A missing token is an invalid token: the page is only reachable by link.
 */
const loadDepositContext = async ({
  slug,
  reservationId,
  token,
}: z.infer<typeof accessInputSchema>) => {
  const store = await getStoreBySlug(slug);
  if (!store) {
    return { ok: false as const, error: "store_not_found" as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: { customer: true },
  });
  if (!reservation) {
    return { ok: false as const, error: "reservation_not_found" as const };
  }

  if (!token) {
    return { ok: false as const, error: "invalid_token" as const };
  }
  const verification = await db.query.verificationCodes.findFirst({
    columns: { id: true },
    where: and(
      eq(verificationCodes.token, token),
      eq(verificationCodes.reservationId, reservationId),
      eq(verificationCodes.storeId, store.id),
      gt(verificationCodes.expiresAt, new Date()),
    ),
  });
  if (!verification) {
    return { ok: false as const, error: "invalid_token" as const };
  }

  if (!store.stripeAccountId || !store.stripeChargesEnabled) {
    return { ok: false as const, error: "stripe_not_configured" as const };
  }

  const currency = store.settings?.currency || "EUR";
  const depositAmount = Number.parseFloat(reservation.depositAmount || "0");
  if (!(depositAmount > 0)) {
    return { ok: false as const, error: "no_deposit_required" as const };
  }

  return {
    ok: true as const,
    store: { ...store, stripeAccountId: store.stripeAccountId },
    reservation,
    currency,
    depositAmount,
  };
};

const isDepositHeld = (status: string | null): boolean =>
  status === "authorized" || status === "captured";

export const getDepositAuthorizationData = async (
  rawInput: z.input<typeof accessInputSchema>,
): Promise<DepositAuthorizationData> => {
  const parsed = accessInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_token" };
  }

  const context = await loadDepositContext(parsed.data);
  if (!context.ok) {
    return context;
  }
  if (isDepositHeld(context.reservation.depositStatus)) {
    return { ok: false, error: "deposit_already_authorized" };
  }

  const { store, reservation, currency, depositAmount } = context;
  return {
    ok: true,
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      stripeAccountId: store.stripeAccountId,
      theme: store.theme
        ? { primaryColor: store.theme.primaryColor, mode: store.theme.mode }
        : null,
    },
    reservation: { id: reservation.id, number: reservation.number, depositAmount },
    customer: { firstName: reservation.customer.firstName, email: reservation.customer.email },
    currency,
  };
};

/** A manual-capture PaymentIntent for the hold; the client secret feeds Stripe Elements. */
export const createDepositPaymentIntent = async (
  rawInput: z.input<typeof accessInputSchema>,
): Promise<DepositPaymentIntentResult> => {
  const parsed = accessInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_token" };
  }

  const context = await loadDepositContext(parsed.data);
  if (!context.ok) {
    return context;
  }
  if (isDepositHeld(context.reservation.depositStatus)) {
    return { ok: false, error: "deposit_already_authorized" };
  }

  const { store, reservation, currency, depositAmount } = context;
  try {
    const intent = await createDepositAuthorizationIntent({
      stripeAccountId: store.stripeAccountId,
      amount: toStripeCents(depositAmount, currency),
      currency,
      reservationId: reservation.id,
      reservationNumber: reservation.number,
      customerName: `${reservation.customer.firstName} ${reservation.customer.lastName}`,
    });
    return { ok: true, clientSecret: intent.clientSecret };
  } catch (error) {
    log.error("authorize-deposit", `payment intent failed: ${describeError(error)}`);
    return { ok: false, error: "payment_intent_creation_failed" };
  }
};

/**
 * Record the hold once Stripe confirms it. The PaymentIntent is re-read from
 * Stripe: only a `requires_capture` intent of this reservation, for the
 * deposit amount, marks the deposit authorised. Idempotent on the intent id.
 */
export const confirmDepositAuthorization = async (
  rawInput: z.input<typeof confirmInputSchema>,
): Promise<ConfirmDepositAuthorizationResult> => {
  const parsed = confirmInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "invalid_token" };
  }

  const context = await loadDepositContext(parsed.data);
  if (!context.ok) {
    return context;
  }

  const { store, reservation, currency, depositAmount } = context;
  const { paymentIntentId } = parsed.data;
  const buildRedirectUrl = () =>
    createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug: store.slug,
      customerEmail: reservation.customer.email,
      reservationId: reservation.id,
      redirectPath: `/account/reservations/${reservation.id}?event=deposit_authorized`,
      ttlMs: INSTANT_ACCESS_SHORT_TTL_MS,
    });

  try {
    const existingHold = await db.query.payments.findFirst({
      columns: { id: true },
      where: and(
        eq(payments.reservationId, reservation.id),
        eq(payments.stripePaymentIntentId, paymentIntentId),
      ),
    });
    if (existingHold) {
      return { ok: true, redirectUrl: await buildRedirectUrl() };
    }
    if (isDepositHeld(reservation.depositStatus)) {
      return { ok: false, error: "deposit_already_authorized" };
    }

    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
      stripeAccount: store.stripeAccountId,
    });
    const verdict = verifyDepositHold(
      {
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
        paymentMethodId:
          typeof intent.payment_method === "string"
            ? intent.payment_method
            : intent.payment_method?.id,
        metadataReservationId: intent.metadata?.reservationId,
      },
      {
        reservationId: reservation.id,
        amountCents: toStripeCents(depositAmount, currency),
        currency,
      },
    );
    if (!verdict.ok) {
      log.warn("authorize-deposit", `hold rejected: ${verdict.reason} (${paymentIntentId})`);
      return { ok: false, error: "not_authorized" };
    }
    const { paymentMethodId } = verdict;

    const now = new Date();
    const authorizationExpiresAt = new Date(now);
    authorizationExpiresAt.setDate(authorizationExpiresAt.getDate() + AUTHORIZATION_HOLD_DAYS);

    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({
          depositStatus: "authorized",
          depositPaymentIntentId: paymentIntentId,
          depositAuthorizationExpiresAt: authorizationExpiresAt,
          stripePaymentMethodId: paymentMethodId,
          updatedAt: now,
        })
        .where(and(eq(reservations.id, reservation.id), eq(reservations.storeId, store.id)));

      await tx.insert(payments).values({
        id: nanoid(),
        reservationId: reservation.id,
        amount: depositAmount.toFixed(2),
        currency,
        status: "authorized",
        type: "deposit_hold",
        method: "stripe",
        stripePaymentIntentId: paymentIntentId,
        stripePaymentMethodId: paymentMethodId,
        authorizationExpiresAt,
        notes: "Deposit authorization hold",
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId: reservation.id,
        activityType: "deposit_authorized",
        metadata: { paymentIntentId, amount: depositAmount, currency },
        createdAt: now,
      });
    });

    return { ok: true, redirectUrl: await buildRedirectUrl() };
  } catch (error) {
    log.error("authorize-deposit", `confirmation failed: ${describeError(error)}`);
    return { ok: false, error: "confirmation_failed" };
  }
};
