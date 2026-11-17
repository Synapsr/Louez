import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What the checkout's return hands its paid page, which reads it instead of a
 * URL anyone could hold: the store, the reservation and the Stripe session the
 * return just completed (or tried to). Sealed with the server's secret, so a
 * browser can neither write nor edit one, and short-lived.
 */
export interface CheckoutPaidClaim {
  storeId: string;
  reservationId: string;
  stripeCheckoutSessionId: string;
}

export const CHECKOUT_PAID_COOKIE = "louez_checkout_paid";

/**
 * Fifteen minutes: long enough for the webhook to record a payment the return
 * could not, and for the customer to refresh the page a few times meanwhile;
 * short enough that the next person at a shared computer rarely finds it.
 */
export const CHECKOUT_PAID_TTL_MS = 15 * 60 * 1000;

interface SealOptions {
  secret: string;
  now: Date;
}

const KEY_PURPOSE = "louez-checkout-paid:";

const sign = (payload: string, secret: string): Buffer =>
  createHmac("sha256", `${KEY_PURPOSE}${secret}`).update(payload, "utf8").digest();

interface SealedClaim {
  s: string;
  r: string;
  c: string;
  /** When it stops opening, in milliseconds. */
  x: number;
}

const isSealedClaim = (value: unknown): value is SealedClaim =>
  typeof value === "object" &&
  value !== null &&
  "s" in value &&
  typeof value.s === "string" &&
  "r" in value &&
  typeof value.r === "string" &&
  "c" in value &&
  typeof value.c === "string" &&
  "x" in value &&
  typeof value.x === "number";

export const sealCheckoutPaidClaim = (
  claim: CheckoutPaidClaim,
  { secret, now }: SealOptions,
): string => {
  if (!secret) throw new Error("No secret to seal the checkout's paid claim with.");
  const sealed: SealedClaim = {
    s: claim.storeId,
    r: claim.reservationId,
    c: claim.stripeCheckoutSessionId,
    x: now.getTime() + CHECKOUT_PAID_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
};

/** The claim a cookie holds, or null when it is missing, edited, foreign or expired. */
export const openCheckoutPaidClaim = (
  value: string | undefined,
  { secret, now }: SealOptions,
): CheckoutPaidClaim | null => {
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload = "", signature = ""] = parts;

  const expected = sign(payload, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let sealed: unknown;
  try {
    sealed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isSealedClaim(sealed) || now.getTime() >= sealed.x) return null;

  return { storeId: sealed.s, reservationId: sealed.r, stripeCheckoutSessionId: sealed.c };
};

export interface CheckoutPaidCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * HttpOnly, Lax (Stripe's redirect back is a top-level navigation), host-only
 * (no `Domain`: the storefront host that set it, never its siblings), and sent
 * to the paid page's path alone, whatever the storefront's URL shape.
 */
export const checkoutPaidCookieOptions = ({
  paidUrl,
  secure,
}: {
  paidUrl: string;
  secure: boolean;
}): CheckoutPaidCookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: "lax",
  path: new URL(paidUrl).pathname,
  maxAge: CHECKOUT_PAID_TTL_MS / 1000,
});
