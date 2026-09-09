import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, reservations, verificationCodes } from "@louez/db";

import { getStorefrontUrl } from "@/lib/storefront-url";

/** Email links stay valid for 30 days (contract, reservation page). */
export const INSTANT_ACCESS_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Tokens minted for a Stripe return: a few minutes, single use. */
export const INSTANT_ACCESS_SHORT_TTL_MS = 15 * 60 * 1000;

/** Under this lifetime a token is consumed on first use. */
const SINGLE_USE_TTL_THRESHOLD_MS = 60 * 60 * 1000;

interface CreateInstantAccessUrlInput {
  storeId: string;
  storeSlug: string;
  customerEmail: string;
  reservationId: string;
  /** Defaults to 30 days; pass `INSTANT_ACCESS_SHORT_TTL_MS` after a Stripe return. */
  ttlMs?: number;
  /** Store-relative destination, whitelisted by `/r/{id}` (`getInstantAccessRedirectPath`). */
  redirectPath?: string;
}

/**
 * Mints an auto-login token bound to one reservation and returns the
 * absolute `/r/{id}?token=…[&redirect=…]` URL used by emails, SMS and the
 * checkout return.
 */
export const createReservationInstantAccessUrl = async ({
  storeId,
  storeSlug,
  customerEmail,
  reservationId,
  ttlMs = INSTANT_ACCESS_DEFAULT_TTL_MS,
  redirectPath,
}: CreateInstantAccessUrlInput): Promise<string> => {
  const token = nanoid(64);
  const now = new Date();

  await db.insert(verificationCodes).values({
    id: nanoid(),
    email: customerEmail,
    storeId,
    code: "",
    type: "instant_access",
    token,
    reservationId,
    expiresAt: new Date(now.getTime() + ttlMs),
    createdAt: now,
  });

  const searchParams = new URLSearchParams({ token });
  if (redirectPath) {
    searchParams.set("redirect", redirectPath);
  }

  return getStorefrontUrl(storeSlug, `/r/${reservationId}?${searchParams.toString()}`);
};

export type InstantAccessFailure = "invalidToken" | "reservationNotFound";

export type InstantAccessResult =
  | { ok: true; customerId: string; reservationId: string }
  | { ok: false; error: InstantAccessFailure };

interface ConsumeInstantAccessInput {
  storeId: string;
  token: string;
  /** When given, the token must have been minted for this reservation. */
  reservationId?: string;
}

/**
 * Validates a token for `storeId` and resolves the customer who owns the
 * reservation. Long-lived tokens (email links) stay reusable; short-lived
 * ones (Stripe return) are marked used on first success.
 */
export const consumeReservationInstantAccess = async ({
  storeId,
  token,
  reservationId,
}: ConsumeInstantAccessInput): Promise<InstantAccessResult> => {
  const verification = await db.query.verificationCodes.findFirst({
    where: and(
      eq(verificationCodes.storeId, storeId),
      eq(verificationCodes.type, "instant_access"),
      eq(verificationCodes.token, token),
      ...(reservationId ? [eq(verificationCodes.reservationId, reservationId)] : []),
      gt(verificationCodes.expiresAt, new Date()),
      isNull(verificationCodes.usedAt),
    ),
  });

  if (!verification?.reservationId) {
    return { ok: false, error: "invalidToken" };
  }

  const reservation = await db.query.reservations.findFirst({
    columns: { id: true, customerId: true },
    where: and(eq(reservations.id, verification.reservationId), eq(reservations.storeId, storeId)),
  });

  if (!reservation) {
    return { ok: false, error: "reservationNotFound" };
  }

  const lifetimeMs = verification.expiresAt.getTime() - verification.createdAt.getTime();
  if (lifetimeMs <= SINGLE_USE_TTL_THRESHOLD_MS) {
    await db
      .update(verificationCodes)
      .set({ usedAt: new Date() })
      .where(eq(verificationCodes.id, verification.id));
  }

  return { ok: true, customerId: reservation.customerId, reservationId: reservation.id };
};
