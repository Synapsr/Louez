export const productAnalyticsEvents = {
  accountCreated: 'account_created',
  productCreated: 'product_created',
  dashboardReservationCreated: 'dashboard_reservation_created',
  dashboardReservationCreationStarted: 'dashboard_reservation_creation_started',
  dashboardReservationStepValidationFailed:
    'dashboard_reservation_step_validation_failed',
  dashboardReservationCapacityBlocked: 'dashboard_reservation_capacity_blocked',
  dashboardReservationOverbookingConfirmed:
    'dashboard_reservation_overbooking_confirmed',
  dashboardReservationTurnoverBufferOverridden:
    'dashboard_reservation_turnover_buffer_overridden',
  dashboardReservationCreationFailed: 'dashboard_reservation_creation_failed',
  reservationViewed: 'reservation_viewed',
  reservationActionStarted: 'reservation_action_started',
  reservationActionSucceeded: 'reservation_action_succeeded',
  reservationActionFailed: 'reservation_action_failed',
  reservationQuickActionsViewed: 'reservation_quick_actions_viewed',
  reservationQuickActionClicked: 'reservation_quick_action_clicked',
  // A refund of an online payment sent from the reservation's payment history.
  stripeRefundRequested: 'stripe_refund_requested',
  keyboardShortcutTriggered: 'keyboard_shortcut_triggered',
  keyboardShortcutSettingsUpdated: 'keyboard_shortcut_settings_updated',
  checkoutReservationCreated: 'checkout_reservation_created',
  checkoutStepViewed: 'checkout_step_viewed',
  checkoutStepValidationFailed: 'checkout_step_validation_failed',
  checkoutSubmitFailed: 'checkout_submit_failed',
  checkoutCompleted: 'checkout_completed',
  checkoutPaymentStarted: 'checkout_payment_started',
  checkoutPaymentCompleted: 'checkout_payment_completed',
  quoteAccepted: 'quote_accepted',
  quoteDeclined: 'quote_declined',
  onboardingStoreInfoSaved: 'onboarding_store_info_saved',
  onboardingCompleted: 'onboarding_completed',
  onboardingProfileCompleted: 'onboarding_profile_completed',
  onboardingStepViewed: 'onboarding_step_viewed',
  onboardingBrandingSaved: 'onboarding_branding_saved',
  onboardingStripeConnectStarted: 'onboarding_stripe_connect_started',
  onboardingSourceSkipped: 'onboarding_source_skipped',
  onboardingErrorShown: 'onboarding_error_shown',
  agentStoreSetupAction: 'agent_store_setup_action',
  acquisitionChannelReported: 'acquisition_channel_reported',
  whatsNewListViewed: 'whats_new_list_viewed',
  whatsNewAnnouncementViewed: 'whats_new_announcement_viewed',
  whatsNewAnnouncementCompleted: 'whats_new_announcement_completed',
  // A store's lifecycle on its owner (docs/analytics/lifecycle.md), sent by the
  // outbox's `store.lifecycleAnalytics` rows.
  storePublished: 'store_published',
  stripeConnectCompleted: 'stripe_connect_completed',
  subscriptionStarted: 'subscription_started',
  subscriptionChanged: 'subscription_changed',
  subscriptionCanceled: 'subscription_canceled',
  paygFeeCharged: 'payg_fee_charged',
  // The dashboard's plan offer (docs/domain/plan-offer.md), on the store's owner.
  planOfferShown: 'plan_offer_shown',
  planOfferDismissed: 'plan_offer_dismissed',
  planOfferClicked: 'plan_offer_clicked',
  // Test reservations (docs/analytics/test-reservation.md)
  testReservationStarted: 'test_reservation_started',
  testReservationCompleted: 'test_reservation_completed',
  testReservationManaged: 'test_reservation_managed',
  testReservationDeleted: 'test_reservation_deleted',
  // The "Se faire connaître" guide (docs/analytics/visibility.md)
  visibilityViewed: 'visibility_viewed',
  visibilityShareUsed: 'visibility_share_used',
  visibilityStepCompleted: 'visibility_step_completed',
  visibilityAiViewed: 'visibility_ai_viewed',
  visibilityAiFixOpened: 'visibility_ai_fix_opened',
  // Liens partenaires (docs/analytics/partners.md)
  partnersViewed: 'partners_viewed',
  partnerCreated: 'partner_created',
  partnerLinkShared: 'partner_link_shared',
  partnerMonthPaid: 'partner_month_paid',
  partnerStatementExported: 'partner_statement_exported',
  partnerReservationChanged: 'partner_reservation_changed',
  // The home's one next step card (docs/analytics/home.md)
  homeNextStepViewed: 'home_next_step_viewed',
} as const;

export type ProductAnalyticsEvent =
  (typeof productAnalyticsEvents)[keyof typeof productAnalyticsEvents];

export const productAnalyticsBaseProperties = {
  analytics_area: 'core_product',
  analytics_version: 1,
} as const;

export const authenticationAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'authentication',
  surface: 'dashboard',
} as const;

/** Shared by a store's lifecycle events (docs/analytics/lifecycle.md). */
export const lifecycleAnalyticsBaseProperties = {
  feature: 'account_lifecycle',
  surface: 'server',
} as const;

// Shared by every onboarding event so funnels can be filtered on one pair of
// properties regardless of whether the event was captured client or server side.
export const onboardingAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'onboarding',
  surface: 'dashboard',
} as const;

export const dashboardReservationAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'reservation_creation',
  surface: 'dashboard',
} as const;

export const reservationManagementAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'reservation_management',
  surface: 'dashboard',
} as const;

export const reservationAnalyticsActions = {
  acceptRequest: 'accept_request',
  rejectRequest: 'reject_request',
  cancelReservation: 'cancel_reservation',
  markPickedUp: 'mark_picked_up',
  confirmReturn: 'confirm_return',
  editReservation: 'edit_reservation',
  updateNotes: 'update_notes',
  sendEmail: 'send_email',
  downloadContract: 'download_contract',
  printReservation: 'print_reservation',
  copyAccessLink: 'copy_access_link',
  viewAsCustomer: 'view_as_customer',
  requestPayment: 'request_payment',
  recordPayment: 'record_payment',
  deletePayment: 'delete_payment',
  returnDeposit: 'return_deposit',
  recordDamage: 'record_damage',
  createDepositHold: 'create_deposit_hold',
  captureDepositHold: 'capture_deposit_hold',
  releaseDepositHold: 'release_deposit_hold',
  startDepartureInspection: 'start_departure_inspection',
  completeDepartureInspection: 'complete_departure_inspection',
  signDepartureInspection: 'sign_departure_inspection',
  startReturnInspection: 'start_return_inspection',
  completeReturnInspection: 'complete_return_inspection',
  signReturnInspection: 'sign_return_inspection',
} as const;

export type ReservationAnalyticsAction =
  (typeof reservationAnalyticsActions)[keyof typeof reservationAnalyticsActions];

export const keyboardShortcutAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'keyboard_shortcuts',
  surface: 'dashboard',
} as const;

/** Shared by the "Se faire connaître" guide's events (docs/analytics/visibility.md). */
export const visibilityAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'visibility',
  surface: 'dashboard',
} as const;

export const partnersAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'partners',
  surface: 'dashboard',
} as const;

export const homeNextStepAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'home_next_step',
  surface: 'dashboard',
} as const;

export const whatsNewAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'whats_new',
  surface: 'dashboard',
} as const;

export const checkoutAnalyticsBaseProperties = {
  ...productAnalyticsBaseProperties,
  feature: 'checkout',
  surface: 'storefront',
} as const;
