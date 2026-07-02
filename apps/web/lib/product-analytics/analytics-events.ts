export const productAnalyticsEvents = {
  productCreated: 'product_created',
  dashboardReservationCreated: 'dashboard_reservation_created',
  checkoutReservationCreated: 'checkout_reservation_created',
  checkoutPaymentStarted: 'checkout_payment_started',
  checkoutPaymentCompleted: 'checkout_payment_completed',
  quoteAccepted: 'quote_accepted',
  quoteDeclined: 'quote_declined',
  onboardingStoreInfoSaved: 'onboarding_store_info_saved',
  onboardingCompleted: 'onboarding_completed',
} as const;

export type ProductAnalyticsEvent =
  (typeof productAnalyticsEvents)[keyof typeof productAnalyticsEvents];

export const productAnalyticsBaseProperties = {
  analytics_area: 'core_product',
  analytics_version: 1,
} as const;
