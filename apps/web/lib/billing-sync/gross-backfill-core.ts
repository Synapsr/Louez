import Stripe from "stripe";
import { z } from "zod";

import type { payments } from "@louez/db";

import { toMinor } from "@/lib/billing-sync/money";

// What the gross backfill reads from Stripe for a payment written before PR b stored its
// billing facts (louez-billing docs/api: README Q7 and Q36, fees.md §3 and §8), and the
// rule that turns a charge into the payment's gross amount. No database here.

type PaymentType = (typeof payments.$inferSelect)["type"];

/** Why a fact stays empty. The heartbeat counts a completed payment left without gross. */
export type UnresolvedReason =
  /** A Stripe payment with no charge, PaymentIntent or Checkout Session id. */
  | "no_stripe_reference"
  /** Neither the payment nor its store has a connected account. */
  | "no_connected_account"
  /** Stripe has no such object on that account, for instance after a reconnection. */
  | "not_found_on_stripe"
  /** Stripe refuses the platform this account: the store revoked Louez's access. */
  | "account_inaccessible"
  /** The PaymentIntent has no charge. */
  | "no_charge"
  | "charge_not_succeeded"
  | "charge_not_captured"
  /** A payment other than a deposit capture whose charge was captured in part. */
  | "charge_partly_captured"
  | "currency_mismatch"
  /** The charge is below the payment's stored amount, which refunds only lower. */
  | "charge_below_amount"
  /** Another payment already holds the charge id: the service claims each for one. */
  | "charge_shared"
  /** A three-decimal currency, which contract 1 does not support (fees.md §3). */
  | "unsupported_currency"
  /** The share needs the gross amount, which stayed empty. */
  | "gross_unknown"
  /** The reservation's totals cannot be read in minor units. */
  | "totals_unreadable";

/** Stripe's answer for one object on a connected account. */
export type StripeAnswer =
  /** The object as Stripe sends it. */
  | { readonly found: unknown }
  | { readonly missing: "not_found_on_stripe" | "account_inaccessible" };

/** Stripe reads on a connected account. A failure other than a `missing` answer throws. */
export interface StripeChargeReads {
  charge(accountId: string, chargeId: string): Promise<StripeAnswer>;
  /** With `latest_charge` expanded. */
  paymentIntent(accountId: string, paymentIntentId: string): Promise<StripeAnswer>;
  /** With `payment_intent.latest_charge` expanded. */
  checkoutSession(accountId: string, sessionId: string): Promise<StripeAnswer>;
}

/** Stripe's answer for an object it does not have, on that account at least. */
export function isStripeNotFound(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    (error.statusCode === 404 || error.code === "resource_missing")
  );
}

/**
 * Stripe's answer when the platform may not act on the account in `Stripe-Account`: a
 * Standard account that revoked Louez (`account.application.deauthorized` keeps its id
 * on the store), or one that no longer exists. Stripe sends it as a 401 or a 403, or
 * with the code `account_invalid`. A wrong platform key gets the same answer on every
 * account: the run then reads nothing and stops before setting `gross_backfilled_at`.
 */
export function isStripeAccountRefusal(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    (error.statusCode === 401 || error.statusCode === 403 || error.code === "account_invalid")
  );
}

/** The reads on Stripe's client, with the platform key and `Stripe-Account`. */
export function stripeChargeReads(stripe: Stripe): StripeChargeReads {
  const answer = async (read: () => Promise<unknown>): Promise<StripeAnswer> => {
    try {
      return { found: await read() };
    } catch (error) {
      if (isStripeNotFound(error)) return { missing: "not_found_on_stripe" };
      if (isStripeAccountRefusal(error)) return { missing: "account_inaccessible" };
      throw error;
    }
  };
  return {
    charge: (accountId, chargeId) =>
      answer(() => stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId })),
    paymentIntent: (accountId, paymentIntentId) =>
      answer(() =>
        stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge"] },
          { stripeAccount: accountId },
        ),
      ),
    checkoutSession: (accountId, sessionId) =>
      answer(() =>
        stripe.checkout.sessions.retrieve(
          sessionId,
          { expand: ["payment_intent.latest_charge"] },
          { stripeAccount: accountId },
        ),
      ),
  };
}

const chargeSchema = z.object({
  object: z.literal("charge"),
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  amount_captured: z.number().int().nonnegative(),
  amount_refunded: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
});
export type StripeCharge = z.infer<typeof chargeSchema>;

const paymentIntentSchema = z.object({
  object: z.literal("payment_intent"),
  latest_charge: z.union([z.string(), chargeSchema]).nullable(),
});
type StripePaymentIntent = z.infer<typeof paymentIntentSchema>;

const checkoutSessionSchema = z.object({
  object: z.literal("checkout.session"),
  payment_intent: z.union([z.string(), paymentIntentSchema]).nullable(),
});

/** An answer that is not the object asked for stops the run, like a failed call. */
function parseAnswer<T>(schema: z.ZodType<T>, answer: unknown, what: string): T {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new Error(`Stripe answered an unexpected ${what}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export type StripeReferences = {
  readonly stripeChargeId: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly stripeCheckoutSessionId: string | null;
};

export type ChargeLookup =
  | { readonly charge: StripeCharge }
  | {
      readonly reason: Extract<
        UnresolvedReason,
        "no_stripe_reference" | "not_found_on_stripe" | "account_inaccessible" | "no_charge"
      >;
    };

/**
 * The charge of a payment: by its charge id, else its PaymentIntent's latest charge,
 * else its Checkout Session's. The latest charge of a PaymentIntent that succeeded is
 * the one that took the money.
 */
export async function findStripeCharge(
  reads: StripeChargeReads,
  accountId: string,
  references: StripeReferences,
): Promise<ChargeLookup> {
  const byId = async (chargeId: string): Promise<ChargeLookup> => {
    const answer = await reads.charge(accountId, chargeId);
    if ("missing" in answer) return { reason: answer.missing };
    return { charge: parseAnswer(chargeSchema, answer.found, "charge") };
  };
  const ofIntent = (intent: StripePaymentIntent): Promise<ChargeLookup> | ChargeLookup => {
    const latest = intent.latest_charge;
    if (latest === null) return { reason: "no_charge" };
    return typeof latest === "string" ? byId(latest) : { charge: latest };
  };
  const byIntentId = async (paymentIntentId: string): Promise<ChargeLookup> => {
    const answer = await reads.paymentIntent(accountId, paymentIntentId);
    if ("missing" in answer) return { reason: answer.missing };
    return ofIntent(parseAnswer(paymentIntentSchema, answer.found, "PaymentIntent"));
  };

  if (references.stripeChargeId !== null) return byId(references.stripeChargeId);
  if (references.stripePaymentIntentId !== null) {
    return byIntentId(references.stripePaymentIntentId);
  }
  if (references.stripeCheckoutSessionId === null) return { reason: "no_stripe_reference" };
  const answer = await reads.checkoutSession(accountId, references.stripeCheckoutSessionId);
  if ("missing" in answer) return { reason: answer.missing };
  const session = parseAnswer(checkoutSessionSchema, answer.found, "Checkout Session");
  const intent = session.payment_intent;
  if (intent === null) return { reason: "no_charge" };
  return typeof intent === "string" ? byIntentId(intent) : ofIntent(intent);
}

export type GrossFromCharge =
  | { readonly grossMinor: number }
  | {
      readonly reason: Extract<
        UnresolvedReason,
        | "charge_not_succeeded"
        | "charge_not_captured"
        | "charge_partly_captured"
        | "currency_mismatch"
        | "charge_below_amount"
        | "unsupported_currency"
      >;
    };

/**
 * A Stripe payment's gross amount, what the write sites store for a new payment: the
 * charge amount (README Q7, `chargeMinor` of fees.md §8), the amount authorised for a
 * deposit hold, and the amount captured for a deposit capture.
 *
 * `amount` is the payment's stored amount, netted by refunds, in `currency`, the
 * payment's own, upper case.
 */
export function grossFromCharge(input: {
  readonly type: PaymentType;
  readonly amount: string;
  readonly currency: string;
  readonly charge: StripeCharge;
}): GrossFromCharge {
  const { charge, type } = input;
  if (charge.currency.toUpperCase() !== input.currency) return { reason: "currency_mismatch" };
  if (charge.status !== "succeeded") return { reason: "charge_not_succeeded" };
  if (type !== "deposit_hold" && !charge.captured) return { reason: "charge_not_captured" };
  if (
    type !== "deposit_hold" &&
    type !== "deposit_capture" &&
    charge.amount_captured !== charge.amount
  )
    return { reason: "charge_partly_captured" };
  const grossMinor = type === "deposit_capture" ? charge.amount_captured : charge.amount;

  const stored = toMinor(input.amount, input.currency);
  if ("error" in stored) return { reason: "unsupported_currency" };
  if (grossMinor < stored.minor) return { reason: "charge_below_amount" };
  return { grossMinor };
}

/**
 * The charge id a payment takes from its charge. A deposit hold has none: its capture
 * row holds the charge (Connect webhook, `payment_intent.amount_capturable_updated`).
 */
export function chargeIdFor(type: PaymentType, charge: StripeCharge): string | null {
  return type === "deposit_hold" ? null : charge.id;
}
