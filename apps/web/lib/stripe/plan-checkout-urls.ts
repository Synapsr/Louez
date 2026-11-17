/**
 * Where a plan's Stripe Checkout sends the owner back: the subscription settings,
 * which say whether the plan started. The plans page and the home's plan offer share it.
 */
export function planCheckoutReturnUrls(appUrl: string) {
  return {
    successUrl: `${appUrl}/dashboard/settings/subscription?success=true`,
    cancelUrl: `${appUrl}/dashboard/settings/subscription?canceled=true`,
  };
}
