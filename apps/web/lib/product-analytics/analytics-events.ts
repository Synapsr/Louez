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
  keyboardShortcutTriggered: 'keyboard_shortcut_triggered',
  keyboardShortcutSettingsUpdated: 'keyboard_shortcut_settings_updated',
  checkoutReservationCreated: 'checkout_reservation_created',
  checkoutStepViewed: 'checkout_step_viewed',
  checkoutStepValidationFailed: 'checkout_step_validation_failed',
  checkoutSubmitFailed: 'checkout_submit_failed',
  checkoutValidationRecovered: 'checkout_validation_recovered',
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
