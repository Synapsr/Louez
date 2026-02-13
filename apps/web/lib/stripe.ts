import Stripe from 'stripe'
import { stripe, getStripe } from './stripe/client'

export { stripe, getStripe }

// ============================================================================
// Connect Account Management
// ============================================================================

interface CreateConnectAccountParams {
  email: string
  country: string
  businessType?: 'individual' | 'company'
  metadata?: Record<string, string>
}

export async function createConnectAccount({
  email,
  country,
  businessType,
  metadata,
}: CreateConnectAccountParams) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    country,
    business_type: businessType,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      platform: 'louez',
      ...metadata,
    },
  })

  return account
}

export async function createAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
) {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
    collect: 'eventually_due',
  })

  return accountLink.url
}

export async function createAccountLoginLink(accountId: string) {
  const loginLink = await stripe.accounts.createLoginLink(accountId)
  return loginLink.url
}

export async function getAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirements: {
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      pastDue: account.requirements?.past_due ?? [],
    },
  }
}

// ============================================================================
// Checkout Sessions
// ============================================================================

interface CheckoutLineItem {
  name: string
  description?: string
  quantity: number
  unitAmount: number // In cents
}

interface CreateCheckoutSessionParams {
  stripeAccountId: string
  reservationId: string
  reservationNumber: string
  customerEmail: string
  lineItems: CheckoutLineItem[]
  depositAmount?: number // In cents - stored in metadata for later authorization hold
  currency: string
  successUrl: string
  cancelUrl: string
  applicationFeeAmount?: number // In cents (platform fee)
  locale?: string
}

export async function createCheckoutSession({
  stripeAccountId,
  reservationId,
  reservationNumber,
  customerEmail,
  lineItems,
  depositAmount = 0,
  currency,
  successUrl,
  cancelUrl,
  applicationFeeAmount,
  locale,
}: CreateCheckoutSessionParams) {
  // Build Stripe line items (rental only, deposit is handled separately as authorization hold)
  const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    lineItems.map((item) => ({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: {
          name: item.name,
          description: item.description,
        },
        unit_amount: item.unitAmount,
      },
      quantity: item.quantity,
    }))

  // Append session_id to success URL for payment verification
  const successUrlWithSession = successUrl.includes('?')
    ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}`
    : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: stripeLineItems,
    customer_email: customerEmail,
    success_url: successUrlWithSession,
    cancel_url: cancelUrl,
    locale: (locale as Stripe.Checkout.SessionCreateParams.Locale) || 'auto',
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
    // Create customer on connected account for future charges (deposit hold)
    customer_creation: 'always',
    metadata: {
      reservationId,
      reservationNumber,
      depositAmount: depositAmount.toString(),
    },
    payment_intent_data: {
      // Save card for future use (deposit authorization hold)
      setup_future_usage: 'off_session',
      metadata: {
        reservationId,
        reservationNumber,
      },
      ...(applicationFeeAmount && applicationFeeAmount > 0
        ? { application_fee_amount: applicationFeeAmount }
        : {}),
    },
  }

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: stripeAccountId,
  })

  return {
    sessionId: session.id,
    url: session.url!,
  }
}

/**
 * Retrieves a checkout session and returns payment status
 */
export async function getCheckoutSession(
  stripeAccountId: string,
  sessionId: string
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    stripeAccount: stripeAccountId,
  })

  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    paymentIntentId: session.payment_intent as string | null,
    customerId: session.customer as string | null,
    amountTotal: session.amount_total,
    currency: session.currency?.toUpperCase() ?? 'EUR',
    metadata: session.metadata,
  }
}

// ============================================================================
// Payment Request Sessions (for requesting payments from dashboard)
// ============================================================================

interface CreatePaymentRequestSessionParams {
  stripeAccountId: string
  reservationId: string
  reservationNumber: string
  customerEmail: string
  amount: number // In cents
  description: string
  currency: string
  successUrl: string
  cancelUrl: string
  applicationFeeAmount?: number // In cents (platform fee)
  locale?: string
}

/**
 * Creates a Stripe Checkout session for a payment request sent from the dashboard.
 * This is used when the store owner requests a payment (rental balance or custom amount).
 * Session expires after 24 hours (vs 30 minutes for initial checkout).
 */
export async function createPaymentRequestSession({
  stripeAccountId,
  reservationId,
  reservationNumber,
  customerEmail,
  amount,
  description,
  currency,
  successUrl,
  cancelUrl,
  applicationFeeAmount,
  locale,
}: CreatePaymentRequestSessionParams) {
  // Append session_id to success URL for payment verification
  const successUrlWithSession = successUrl.includes('?')
    ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}`
    : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
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
    success_url: successUrlWithSession,
    cancel_url: cancelUrl,
    locale: (locale as Stripe.Checkout.SessionCreateParams.Locale) || 'auto',
    expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    metadata: {
      reservationId,
      reservationNumber,
      type: 'payment_request',
    },
    payment_intent_data: {
      metadata: {
        reservationId,
        reservationNumber,
        type: 'payment_request',
      },
      ...(applicationFeeAmount && applicationFeeAmount > 0
        ? { application_fee_amount: applicationFeeAmount }
        : {}),
    },
  }

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: stripeAccountId,
  })

  return {
    sessionId: session.id,
    url: session.url!,
  }
}

// ============================================================================
// Refunds
// ============================================================================

interface CreateRefundParams {
  stripeAccountId: string
  chargeId: string
  amount?: number // In cents, omit for full refund
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent'
}

export async function createRefund({
  stripeAccountId,
  chargeId,
  amount,
  reason = 'requested_by_customer',
}: CreateRefundParams) {
  const refundParams: Stripe.RefundCreateParams = {
    charge: chargeId,
    reason,
  }

  if (amount) {
    refundParams.amount = amount
  }

  const refund = await stripe.refunds.create(refundParams, {
    stripeAccount: stripeAccountId,
  })

  return {
    refundId: refund.id,
    amount: refund.amount,
    status: refund.status,
    currency: refund.currency.toUpperCase(),
  }
}

export async function getChargeRefundableAmount(
  stripeAccountId: string,
  chargeId: string
) {
  const charge = await stripe.charges.retrieve(chargeId, {
    stripeAccount: stripeAccountId,
  })

  return {
    refundable: !charge.refunded && charge.amount > charge.amount_refunded,
    amount: charge.amount - charge.amount_refunded,
    alreadyRefunded: charge.amount_refunded,
  }
}

// ============================================================================
// Deposit Authorization Hold (Empreinte Bancaire)
// ============================================================================

interface CreateDepositAuthorizationIntentParams {
  stripeAccountId: string
  amount: number // In cents
  currency: string
  reservationId: string
  reservationNumber: string
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
}: CreateDepositAuthorizationIntentParams) {
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: currency.toLowerCase(),
      capture_method: 'manual', // Authorization only, no immediate capture
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        reservationId,
        reservationNumber,
        type: 'deposit_authorization_request',
      },
    },
    {
      stripeAccount: stripeAccountId,
    }
  )

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    status: paymentIntent.status,
  }
}

interface CreateDepositAuthorizationParams {
  stripeAccountId: string
  customerId: string
  paymentMethodId: string
  amount: number // In cents
  currency: string
  reservationId: string
  reservationNumber: string
}

/**
 * Creates an authorization hold on the customer's card for the deposit amount.
 * This blocks the funds on the card but does NOT charge them.
 * The authorization expires after 7 days.
 */
export async function createDepositAuthorization({
  stripeAccountId,
  customerId,
  paymentMethodId,
  amount,
  currency,
  reservationId,
  reservationNumber,
}: CreateDepositAuthorizationParams) {
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual', // Authorization only, no immediate capture
      confirm: true, // Confirm immediately to create the authorization
      off_session: true, // No customer interaction required
      metadata: {
        reservationId,
        reservationNumber,
        type: 'deposit_hold',
      },
    },
    {
      stripeAccount: stripeAccountId,
    }
  )

  // Authorization expires after 7 days
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    expiresAt,
  }
}

interface CaptureDepositParams {
  stripeAccountId: string
  paymentIntentId: string
  amountToCapture?: number // In cents, if partial capture
}

/**
 * Captures the deposit (fully or partially) from an authorization hold.
 * Any uncaptured amount is automatically released.
 */
export async function captureDeposit({
  stripeAccountId,
  paymentIntentId,
  amountToCapture,
}: CaptureDepositParams) {
  const captureParams: Stripe.PaymentIntentCaptureParams = {}

  if (amountToCapture !== undefined) {
    captureParams.amount_to_capture = amountToCapture
  }

  const paymentIntent = await stripe.paymentIntents.capture(
    paymentIntentId,
    captureParams,
    {
      stripeAccount: stripeAccountId,
    }
  )

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    amountCaptured: paymentIntent.amount_received,
    currency: paymentIntent.currency.toUpperCase(),
  }
}

interface ReleaseDepositParams {
  stripeAccountId: string
  paymentIntentId: string
}

/**
 * Releases (cancels) an authorization hold without capturing any funds.
 * The blocked amount is immediately released back to the customer.
 */
export async function releaseDeposit({
  stripeAccountId,
  paymentIntentId,
}: ReleaseDepositParams) {
  const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId, {
    stripeAccount: stripeAccountId,
  })

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
  }
}

/**
 * Retrieves the current status of a deposit authorization.
 */
export async function getDepositAuthorizationStatus(
  stripeAccountId: string,
  paymentIntentId: string
) {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    stripeAccount: stripeAccountId,
  })

  return {
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    amountCapturable: paymentIntent.amount_capturable,
    amountReceived: paymentIntent.amount_received,
    currency: paymentIntent.currency.toUpperCase(),
    metadata: paymentIntent.metadata,
  }
}

/**
 * Retrieves customer's saved payment method details (last 4 digits, brand, etc.)
 */
export async function getPaymentMethodDetails(
  stripeAccountId: string,
  paymentMethodId: string
) {
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId, {
    stripeAccount: stripeAccountId,
  })

  return {
    id: paymentMethod.id,
    brand: paymentMethod.card?.brand ?? null,
    last4: paymentMethod.card?.last4 ?? null,
    expMonth: paymentMethod.card?.exp_month ?? null,
    expYear: paymentMethod.card?.exp_year ?? null,
  }
}

// ============================================================================
// Currency Utilities
// ============================================================================

// Stripe zero-decimal currencies (amount in whole units, not cents)
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

export function toStripeCents(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return Math.round(amount)
  }
  return Math.round(amount * 100)
}

export function fromStripeCents(cents: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return cents
  }
  return cents / 100
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
) {
  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret)
}
