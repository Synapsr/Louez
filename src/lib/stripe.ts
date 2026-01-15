// Import and re-export from the new stripe module
import { stripe } from './stripe/client'
export { stripe }

export async function createConnectAccount(email: string) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    country: 'FR',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
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
  })

  return accountLink.url
}

export async function getAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)

  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  }
}

interface CreatePaymentIntentOptions {
  amount: number
  currency?: string
  stripeAccountId: string
  metadata?: Record<string, string>
  applicationFeeAmount?: number
}

export async function createPaymentIntent({
  amount,
  currency = 'eur',
  stripeAccountId,
  metadata,
  applicationFeeAmount,
}: CreatePaymentIntentOptions) {
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata,
      application_fee_amount: applicationFeeAmount
        ? Math.round(applicationFeeAmount * 100)
        : undefined,
    },
    {
      stripeAccount: stripeAccountId,
    }
  )

  return paymentIntent
}
