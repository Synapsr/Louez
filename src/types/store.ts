export interface DaySchedule {
  isOpen: boolean
  openTime: string   // "09:00"
  closeTime: string  // "18:00"
}

export interface ClosurePeriod {
  id: string
  name: string
  startDate: string  // ISO date string
  endDate: string    // ISO date string
  reason?: string
}

export interface BusinessHours {
  enabled: boolean
  schedule: {
    0: DaySchedule  // Sunday
    1: DaySchedule  // Monday
    2: DaySchedule  // Tuesday
    3: DaySchedule  // Wednesday
    4: DaySchedule  // Thursday
    5: DaySchedule  // Friday
    6: DaySchedule  // Saturday
  }
  closurePeriods: ClosurePeriod[]
}

// ============================================================================
// Tax Settings
// ============================================================================

export interface TaxSettings {
  enabled: boolean                         // Activer les taxes
  defaultRate: number                      // Taux par défaut (ex: 20 pour 20%)
  displayMode: 'inclusive' | 'exclusive'   // TTC (inclusive) ou HT (exclusive)
  taxLabel?: string                        // Label personnalisé (défaut: "TVA")
  taxNumber?: string                       // N° TVA de la boutique
}

export interface ProductTaxSettings {
  inheritFromStore: boolean                // true = utiliser taux boutique
  customRate?: number                      // Taux personnalisé si false
}

// ============================================================================
// Billing Address
// ============================================================================

export interface BillingAddress {
  useSameAsStore: boolean  // true = use store address, false = use custom billing address
  address?: string
  city?: string
  postalCode?: string
  country?: string
}

// ============================================================================
// Store Settings
// ============================================================================

export interface StoreSettings {
  pricingMode: 'day' | 'hour' | 'week'
  reservationMode: 'payment' | 'request'
  /** @deprecated Use minRentalHours instead. Kept for backward compat reading. */
  minDuration?: number
  /** @deprecated Use maxRentalHours instead. Kept for backward compat reading. */
  maxDuration?: number | null
  /** Minimum rental duration in hours. 0 = no restriction. Default: 1. */
  minRentalHours?: number
  /** Maximum rental duration in hours. null = no limit. */
  maxRentalHours?: number | null
  advanceNotice: number
  requireCustomerAddress?: boolean
  /**
   * Controls whether pending (unanswered) reservation requests block availability.
   * Only applies when reservationMode is 'request'.
   * - true (default): Pending requests immediately block product availability
   * - false: Only confirmed reservations block availability
   */
  pendingBlocksAvailability?: boolean
  /**
   * Percentage of rental amount to collect immediately during online checkout.
   * Only applies when reservationMode is 'payment'.
   * - 100 (default): Full payment required upfront
   * - 10-99: Partial payment (deposit), remainder due at pickup
   */
  onlinePaymentDepositPercentage?: number
  businessHours?: BusinessHours
  country?: string    // ISO 3166-1 alpha-2 (e.g., 'FR', 'BE', 'CH')
  timezone?: string   // IANA timezone (e.g., 'Europe/Paris')
  currency?: string   // ISO 4217 currency code (e.g., 'EUR', 'USD', 'GBP')
  tax?: TaxSettings   // Configuration des taxes
  billingAddress?: BillingAddress  // Separate billing address for contracts
}

export interface StoreTheme {
  mode: 'light' | 'dark'
  primaryColor: string
  heroImages?: string[]
}

/**
 * Unified notification template interface.
 * Used for both email and SMS customization.
 * @deprecated Use NotificationTemplate instead for new code
 */
export interface EmailCustomContent {
  subject?: string
  greeting?: string
  message?: string
  signature?: string
}

/**
 * Modern unified notification template.
 * Supports both email and SMS with consistent field names.
 */
export interface NotificationTemplate {
  /** Email subject line (supports variables: {name}, {number}, {storeName}) */
  subject?: string
  /** Custom email message body (supports variables) */
  emailMessage?: string
  /** Custom SMS message (supports variables, max 160 chars recommended) */
  smsMessage?: string
}

/**
 * Convert legacy EmailCustomContent to NotificationTemplate
 */
export function toNotificationTemplate(legacy: EmailCustomContent | undefined): NotificationTemplate | undefined {
  if (!legacy) return undefined
  return {
    subject: legacy.subject,
    emailMessage: legacy.message,
  }
}

/**
 * Convert NotificationTemplate to legacy EmailCustomContent (for backward compat)
 */
export function toLegacyEmailContent(template: NotificationTemplate | undefined): EmailCustomContent | undefined {
  if (!template) return undefined
  return {
    subject: template.subject,
    message: template.emailMessage,
  }
}

export interface EmailSettings {
  // Toggle settings
  confirmationEnabled: boolean
  reminderPickupEnabled: boolean
  reminderReturnEnabled: boolean
  replyToEmail: string | null

  // Custom email content
  defaultSignature?: string
  confirmationContent?: EmailCustomContent
  rejectionContent?: EmailCustomContent
  pickupReminderContent?: EmailCustomContent
  returnReminderContent?: EmailCustomContent
  requestAcceptedContent?: EmailCustomContent
}

export interface ProductSnapshot {
  name: string
  description: string | null
  images: string[]
}

// ============================================================================
// Pricing Types
// ============================================================================

export type PricingMode = 'hour' | 'day' | 'week'

export interface PricingTier {
  id: string
  minDuration: number      // Minimum units to trigger this tier
  discountPercent: number  // Discount percentage (0-99)
  displayOrder: number
}

export interface PricingBreakdown {
  basePrice: number
  effectivePrice: number
  duration: number
  pricingMode: PricingMode
  discountPercent: number | null
  discountAmount: number
  tierApplied: string | null  // Human-readable tier label
  // Tax fields
  taxRate: number | null
  taxAmount: number | null
  subtotalExclTax: number | null
  subtotalInclTax: number | null
  // Manual price override fields
  isManualOverride?: boolean
  originalPrice?: number  // Price before manual override
}

export interface PlanFeatures {
  // Limits
  maxProducts: number | null // null = unlimited
  maxReservationsPerMonth: number | null // null = unlimited
  maxCustomers: number | null // null = unlimited
  maxCollaborators: number | null // null = unlimited, 0 = none
  maxSmsPerMonth: number | null // null = unlimited, 0 = none

  // Features
  customDomain: boolean
  analytics: boolean
  emailNotifications: boolean
  prioritySupport: boolean
  apiAccess: boolean
  whiteLabel: boolean
  onlinePayment: boolean
  customerPortal: boolean
  reviewBooster: boolean
  phoneSupport: boolean
  dedicatedManager: boolean
}

// ============================================================================
// Review Booster Types
// ============================================================================

export interface GoogleReview {
  authorName: string
  authorPhotoUrl?: string
  authorPhotoBase64?: string // Cached base64 encoded photo
  rating: number
  text: string
  relativeTimeDescription: string
  time: number // Unix timestamp
}

export interface ReviewBoosterTemplate {
  subject?: string
  emailMessage?: string
  smsMessage?: string
}

export interface ReviewBoosterSettings {
  enabled: boolean
  // Google Place info
  googlePlaceId: string | null
  googlePlaceName: string | null
  googlePlaceAddress: string | null
  googleRating: number | null
  googleReviewCount: number | null
  // Feature toggles
  displayReviewsOnStorefront: boolean
  showReviewPromptInPortal: boolean
  // Automation settings
  autoSendThankYouEmail: boolean
  autoSendThankYouSms: boolean
  emailDelayHours: number
  smsDelayHours: number
  // Custom template
  template?: ReviewBoosterTemplate
}

// ============================================================================
// Notification Settings (Admin notifications)
// ============================================================================

export type NotificationEventType =
  | 'reservation_new'
  | 'reservation_confirmed'
  | 'reservation_rejected'
  | 'reservation_cancelled'
  | 'reservation_picked_up'
  | 'reservation_completed'
  | 'payment_received'
  | 'payment_failed'

export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  'reservation_new',
  'reservation_confirmed',
  'reservation_rejected',
  'reservation_cancelled',
  'reservation_picked_up',
  'reservation_completed',
  'payment_received',
  'payment_failed',
]

export interface NotificationChannelConfig {
  email: boolean
  sms: boolean
  discord: boolean
}

export interface NotificationSettings {
  reservation_new: NotificationChannelConfig
  reservation_confirmed: NotificationChannelConfig
  reservation_rejected: NotificationChannelConfig
  reservation_cancelled: NotificationChannelConfig
  reservation_picked_up: NotificationChannelConfig
  reservation_completed: NotificationChannelConfig
  payment_received: NotificationChannelConfig
  payment_failed: NotificationChannelConfig
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  reservation_new: { email: true, sms: false, discord: false },
  reservation_confirmed: { email: true, sms: false, discord: false },
  reservation_rejected: { email: true, sms: false, discord: false },
  reservation_cancelled: { email: true, sms: false, discord: false },
  reservation_picked_up: { email: false, sms: false, discord: false },
  reservation_completed: { email: false, sms: false, discord: false },
  payment_received: { email: true, sms: false, discord: false },
  payment_failed: { email: true, sms: false, discord: false },
}

// ============================================================================
// Customer Notification Settings (Notifications sent to customers)
// ============================================================================

export type CustomerNotificationEventType =
  | 'customer_request_received'
  | 'customer_request_accepted'
  | 'customer_request_rejected'
  | 'customer_reservation_confirmed'
  | 'customer_reminder_pickup'
  | 'customer_reminder_return'

export const CUSTOMER_NOTIFICATION_EVENT_TYPES: CustomerNotificationEventType[] = [
  'customer_request_received',
  'customer_request_accepted',
  'customer_request_rejected',
  'customer_reservation_confirmed',
  'customer_reminder_pickup',
  'customer_reminder_return',
]

export interface CustomerNotificationChannelConfig {
  enabled: boolean
  email: boolean
  sms: boolean
}

export interface CustomerNotificationTemplate {
  subject?: string
  emailMessage?: string
  smsMessage?: string
}

export interface CustomerNotificationSettings {
  // Preferences per event type
  customer_request_received: CustomerNotificationChannelConfig
  customer_request_accepted: CustomerNotificationChannelConfig
  customer_request_rejected: CustomerNotificationChannelConfig
  customer_reservation_confirmed: CustomerNotificationChannelConfig
  customer_reminder_pickup: CustomerNotificationChannelConfig
  customer_reminder_return: CustomerNotificationChannelConfig

  // Custom templates
  templates: {
    customer_request_received?: CustomerNotificationTemplate
    customer_request_accepted?: CustomerNotificationTemplate
    customer_request_rejected?: CustomerNotificationTemplate
    customer_reservation_confirmed?: CustomerNotificationTemplate
    customer_reminder_pickup?: CustomerNotificationTemplate
    customer_reminder_return?: CustomerNotificationTemplate
  }

  // Automatic reminder settings
  reminderSettings?: {
    // Pickup reminder: hours before startDate to send reminder (default: 24)
    pickupReminderHours: number
    // Return reminder: hours before endDate to send reminder (default: 24)
    returnReminderHours: number
  }
}

export const DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS: CustomerNotificationSettings = {
  // Reservation journey - email enabled by default
  customer_request_received: { enabled: true, email: true, sms: false },
  customer_request_accepted: { enabled: true, email: true, sms: false },
  customer_request_rejected: { enabled: true, email: true, sms: false },
  customer_reservation_confirmed: { enabled: true, email: true, sms: false },

  // Reminders - email enabled by default (SMS disabled due to cost)
  customer_reminder_pickup: { enabled: true, email: true, sms: false },
  customer_reminder_return: { enabled: true, email: true, sms: false },

  // No custom templates by default
  templates: {},

  // Default reminder timing: 24 hours before event
  reminderSettings: {
    pickupReminderHours: 24,
    returnReminderHours: 24,
  },
}
