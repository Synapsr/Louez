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
export * from "./availability";
export * from "./stock-capacity";

// Permissions
export { hasPermission, type Permission, type MemberRole } from "./permissions";

// Business hours
export { normalizeDaySchedule } from "./business-hours";
export { toAbsoluteUrl } from "./url";

// Rich-text HTML (dashboard editor) allow-list sanitiser
export { sanitizeRichTextHtml } from "./html/sanitize-rich-text";

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
