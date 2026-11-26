import Stripe from "stripe";
import {
  roundDownToMinorUnit,
  validateStripePaymentAmount,
  ZERO_DECIMAL_CURRENCIES,
} from "@louez/utils";
import { stripe, getStripe } from "./stripe/client";

/**
 * How long a Checkout Session Louez creates for a reservation stays payable,
 * from its creation by Louez's clock (`expires_at`).
 */
export const CHECKOUT_SESSION_LIFETIME_SECONDS = 30 * 60;

export { stripe, getStripe };

// ============================================================================
// Checkout Sessions
// ============================================================================

interface CheckoutLineItem {
  name: string;
  description?: string;
  quantity: number;
  unitAmount: number; // In cents
}

interface CreateCheckoutSessionParams {
  stripeAccountId: string;
  reservationId: string;
  reservationNumber: string;
  customerEmail: string;
  customerName?: string | null;
  lineItems: CheckoutLineItem[];
  depositAmount?: number; // In cents - stored in metadata for later authorization hold
  currency: string;
  successUrl: string;
  cancelUrl: string;
  applicationFeeAmount?: number; // In cents (platform fee)
  /** Fee metadata v4, on the session and on its PaymentIntent (billing fees.md §8). */
  feeMetadata?: Record<string, string>;
  locale?: string;
  /**
   * Stamped in the session metadata so the expiry webhook can tell a storefront
   * checkout (whose pending reservation it may auto-cancel) from every other
   * payment link of the same reservation.
   */
  checkoutFlow?: CheckoutSessionFlow;
  /**
   * The key of this one create: Stripe answers the client's own retry of it with
   * the same session. A fresh key for each call ties no two calls together.
   */
  idempotencyKey?: string;
}

export type CheckoutSessionFlow = "storefront_checkout";

function normalizeStripeReferenceValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function buildReservationPaymentReference({
  reservationId,
  reservationNumber,
  customerName,
  type,
}: {
  reservationId: string;
  reservationNumber: string;
  customerName?: string | null;
  type?: string;
}) {
  const normalizedCustomerName = normalizeStripeReferenceValue(customerName);
  const reservationReference = `Reservation #${reservationNumber}`;
  const description = normalizedCustomerName
    ? `${reservationReference} - ${normalizedCustomerName}`
    : reservationReference;

  return {
    clientReferenceId: reservationNumber,
    description,
    metadata: {
      reservationId,
      reservationNumber,
      reservationReference,
      ...(normalizedCustomerName ? { customerName: normalizedCustomerName } : {}),
      ...(type ? { type } : {}),
    },
  };
}

export async function createCheckoutSession({
  stripeAccountId,
  reservationId,
  reservationNumber,
  customerEmail,
  customerName,
  lineItems,
  depositAmount = 0,
  currency,
  successUrl,
  cancelUrl,
  applicationFeeAmount,
  feeMetadata,
  locale,
  checkoutFlow,
  idempotencyKey,
}: CreateCheckoutSessionParams) {
  const paymentAmount = validateStripePaymentAmount(
    fromStripeCents(
      lineItems.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0),
      currency,
    ),
    currency,
  );
  if (!paymentAmount.ok) throw new Error(paymentAmount.error);

  // Build Stripe line items (rental only, deposit is handled separately as authorization hold)
  const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lineItems.map((item) => ({
    price_data: {
      currency: currency.toLowerCase(),
      product_data: {
        name: item.name,
        description: item.description,
      },
      unit_amount: item.unitAmount,
    },
    quantity: item.quantity,
  }));

  // Append session_id to success URL for payment verification
  const successUrlWithSession = successUrl.includes("?")
    ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}`
    : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`;

  const paymentReference = buildReservationPaymentReference({
    reservationId,
    reservationNumber,
    customerName,
    type: "reservation_payment",
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: stripeLineItems,
    customer_email: customerEmail,
    client_reference_id: paymentReference.clientReferenceId,
    success_url: successUrlWithSession,
    cancel_url: cancelUrl,
    locale: (locale as Stripe.Checkout.SessionCreateParams.Locale) || "auto",
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_LIFETIME_SECONDS,
    // Create customer on connected account for future charges (deposit hold)
    customer_creation: "always",
    metadata: {
      ...paymentReference.metadata,
      ...feeMetadata,
      depositAmount: depositAmount.toString(),
      ...(checkoutFlow ? { checkoutFlow } : {}),
    },
    payment_intent_data: {
      description: paymentReference.description,
      // Save card for future use (deposit authorization hold)
      setup_future_usage: "off_session",
      metadata: { ...paymentReference.metadata, ...feeMetadata },
      ...(applicationFeeAmount && applicationFeeAmount > 0
        ? { application_fee_amount: applicationFeeAmount }
        : {}),
    },
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: stripeAccountId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  return {
    sessionId: session.id,
    url: session.url!,
    expiresAt: new Date(session.expires_at * 1000),
  };
}

/**
 * Retrieves a checkout session and returns payment status
 */
export async function getCheckoutSession(stripeAccountId: string, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    stripeAccount: stripeAccountId,
  });

  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    paymentIntentId: session.payment_intent as string | null,
    customerId: session.customer as string | null,
    amountTotal: session.amount_total,
    currency: session.currency?.toUpperCase() ?? "EUR",
    metadata: session.metadata,
    url: session.url,
    expiresAt: new Date(session.expires_at * 1000),
  };
}

// ============================================================================
// Payment Request Sessions (for requesting payments from dashboard)
// ============================================================================

interface CreatePaymentRequestSessionParams {
  stripeAccountId: string;
  reservationId: string;
  reservationNumber: string;
  customerEmail: string;
  customerName?: string | null;
  amount: number; // In cents
  description: string;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  paymentRequestId: string;
  applicationFeeAmount?: number; // In cents (platform fee)
  /** Fee metadata v4, on the session and on its PaymentIntent (billing fees.md §8). */
  feeMetadata?: Record<string, string>;
  locale?: string;
  /**
   * The key of this one create: Stripe answers the client's own retry of it with
   * the same session. A fresh key for each call ties no two calls together.
   */
  idempotencyKey?: string;
}

/**
 * Creates a Stripe Checkout session for a payment request.
 * Called on-demand when the customer visits the /pay/ page and clicks "Pay".
 * Session expires after 30 minutes (customer is actively on the page).
 */
export async function createPaymentRequestSession({
  stripeAccountId,
  reservationId,
  reservationNumber,
  customerEmail,
  customerName,
  amount,
  description,
  currency,
  successUrl,
  cancelUrl,
  paymentRequestId,
  applicationFeeAmount,
  feeMetadata,
  locale,
  idempotencyKey,
}: CreatePaymentRequestSessionParams) {
  const paymentAmount = validateStripePaymentAmount(fromStripeCents(amount, currency), currency);
  if (!paymentAmount.ok) throw new Error(paymentAmount.error);

  // Append session_id to success URL for payment verification
  const successUrlWithSession = successUrl.includes("?")
    ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}`
    : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`;

  const paymentReference = buildReservationPaymentReference({
    reservationId,
    reservationNumber,
    customerName,
    type: "payment_request",
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: description,
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    customer_email: customerEmail,
    client_reference_id: paymentReference.clientReferenceId,
    success_url: successUrlWithSession,
    cancel_url: cancelUrl,
    locale: (locale as Stripe.Checkout.SessionCreateParams.Locale) || "auto",
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_LIFETIME_SECONDS,
    metadata: {
      ...paymentReference.metadata,
      ...feeMetadata,
      paymentRequestId,
    },
    payment_intent_data: {
      description: `${description} - ${paymentReference.description}`,
      metadata: {
        ...paymentReference.metadata,
        ...feeMetadata,
        paymentRequestId,
      },
      ...(applicationFeeAmount && applicationFeeAmount > 0
        ? { application_fee_amount: applicationFeeAmount }
        : {}),
    },
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: stripeAccountId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  return {
    sessionId: session.id,
    url: session.url!,
  };
}

// ============================================================================
// Deposit Authorization Hold (Empreinte Bancaire)
// ============================================================================

interface CreateDepositAuthorizationIntentParams {
  stripeAccountId: string;
  amount: number; // In cents
  currency: string;
  reservationId: string;
  reservationNumber: string;
  customerName?: string | null;
}

/**
 * Creates a PaymentIntent for deposit authorization that requires customer confirmation.
 * Used when customer needs to enter their card on the storefront page.
 * Returns the client secret to be used with Stripe Elements.
 */
export async function createDepositAuthorizationIntent({
  stripeAccountId,
  amount,
  currency,
  reservationId,
  reservationNumber,
  customerName,
}: CreateDepositAuthorizationIntentParams) {
  const paymentReference = buildReservationPaymentReference({
    reservationId,
    reservationNumber,
    customerName,
    type: "deposit_hold",
  });

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: currency.toLowerCase(),
      description: `Deposit hold - ${paymentReference.description}`,
      capture_method: "manual", // Authorization only, no immediate capture
      // Deposit holds must be card authorizations. Dynamic methods can expose
      // redirect/deferred methods that cannot create a capturable card hold.
      payment_method_types: ["card"],
      metadata: paymentReference.metadata,
    },
    {
      stripeAccount: stripeAccountId,
    },
  );

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    status: paymentIntent.status,
  };
}

/**
 * Retrieves customer's saved payment method details (last 4 digits, brand, etc.)
 */
export async function getPaymentMethodDetails(stripeAccountId: string, paymentMethodId: string) {
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId, {
    stripeAccount: stripeAccountId,
  });

  return {
    id: paymentMethod.id,
    brand: paymentMethod.card?.brand ?? null,
    last4: paymentMethod.card?.last4 ?? null,
    expMonth: paymentMethod.card?.exp_month ?? null,
    expYear: paymentMethod.card?.exp_year ?? null,
  };
}

// ============================================================================
// Currency Utilities
// ============================================================================

// Stripe zero-decimal currencies (amount in whole units, not cents): `ZERO_DECIMAL_CURRENCIES`, @louez/utils.

export function toStripeCents(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

/**
 * What a charge of `amount` takes at Stripe, in the currency's minor units,
 * rounded down to them (`roundDownToMinorUnit`): a rental charge never takes
 * more than it was asked.
 */
export function toStripeChargeCents(amount: number, currency: string): number {
  return toStripeCents(roundDownToMinorUnit(amount, currency), currency);
}

export function fromStripeCents(cents: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return cents;
  }
  return cents / 100;
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
) {
  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
}
