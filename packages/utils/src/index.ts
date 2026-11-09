// Class name utility
export { cn } from "./cn";

// Formatting utilities
export {
  formatCurrency,
  formatCurrencyForSms,
  formatNumber,
  formatPercent,
  formatDate,
  toDatePickerValue,
  formatDateShort,
  formatDateTime,
  formatTime,
  formatDateRange,
  formatRelativeTime,
  calculateDurationDays,
  formatDurationHuman,
  getCurrencySymbol,
  formatAmountWithSymbol,
  getLogoForLightBackground,
} from "./formatting";

// Pricing utilities
export * from "./pricing";
export * from "./variants";
export * from "./util.variant-identity";
export * from "./availability";
export * from "./stock-capacity";

// Permissions
export { hasPermission, type Permission, type MemberRole } from "./permissions";

// Business hours, rental windows and the reservation rules a booking is checked against
export * from "./business-hours";
export * from "./rental-duration";
export * from "./advance-notice";
export * from "./reservation-rules";
export { toAbsoluteUrl } from "./url";

// How a store hands its rentals over: delivery, pickup points, delivery-only modes
export * from "./delivery-availability";

// Countries a store can be in, with their time zones, its currencies, and store referral codes
export * from "./countries";
export * from "./currencies";
export * from "./referral-code";
export * from "./customer-social-links";

// Rich-text HTML (dashboard editor): whether it shows text. Its sanitiser is
// server-only, at `@louez/utils/sanitize-rich-text`.
export { RICH_TEXT_MAX_DEPTH, hasRichTextContent } from "./html/rich-text-content";
export { stripHtml } from "./html/strip-html";

// AI advisor
export { advisorValidationCovers } from "./ai-advisor";

// Reservation billing identity (individual or business, frozen at booking)
export {
  INDIVIDUAL_BILLING,
  billingFromCustomer,
  isBusinessBilling,
  resolveReservationBilling,
  type BillingCustomerLike,
} from "./reservation-billing";

export { hasReservationInsuranceCoverage } from "./util.reservation-insurance";

export * from "./pricing/product-promotion";

// Currency code and tax rate as the billing snapshots count them
export { beforeTaxRateBps, normalizeCurrency } from "./billing-money";

// Payment rows: a Stripe refund told apart from the charge it refunds
export * from "./util.payment-movement";
export * from "./util.stripe-payment-amount";
