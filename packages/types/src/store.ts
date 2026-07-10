export interface TimeRange {
  openTime: string; // "HH:mm" e.g. "09:00"
  closeTime: string; // "HH:mm" e.g. "18:00"
}

export interface DaySchedule {
  isOpen: boolean;
  ranges: TimeRange[]; // At least 1 range when isOpen=true
}

export interface ClosurePeriod {
  id: string;
  name: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  startTime?: string; // "HH:mm" for partial-day closures
  endTime?: string; // "HH:mm" for partial-day closures
  reason?: string;
}

export interface BusinessHours {
  enabled: boolean;
  schedule: {
    0: DaySchedule; // Sunday
    1: DaySchedule; // Monday
    2: DaySchedule; // Tuesday
    3: DaySchedule; // Wednesday
    4: DaySchedule; // Thursday
    5: DaySchedule; // Friday
    6: DaySchedule; // Saturday
  };
  closurePeriods: ClosurePeriod[];
}

// ============================================================================
// Tax Settings
// ============================================================================

export interface TaxSettings {
  enabled: boolean; // Activer les taxes
  defaultRate: number; // Taux par défaut (ex: 20 pour 20%)
  displayMode: 'inclusive' | 'exclusive'; // TTC (inclusive) ou HT (exclusive)
  taxLabel?: string; // Label personnalisé (défaut: "TVA")
  taxNumber?: string; // N° TVA de la boutique
}

export interface ProductTaxSettings {
  inheritFromStore: boolean; // true = utiliser taux boutique
  customRate?: number; // Taux personnalisé si false
}

// ============================================================================
// Product Booking Attributes (SKU tracking advanced mode)
// ============================================================================

export interface BookingAttributeAxis {
  /**
   * Stable key used for persistence and matching.
   * This key should be immutable once created.
   */
  key: string;
  /** Human-readable label shown in UI */
  label: string;
  /** Display and canonical ordering */
  position: number;
}

export type UnitAttributes = Record<string, string>;

export interface ResolvedCombination {
  combinationKey: string;
  selectedAttributes: UnitAttributes;
}

// ============================================================================
// Billing Address
// ============================================================================

export interface BillingAddress {
  useSameAsStore: boolean; // true = use store address, false = use custom billing address
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

// ============================================================================
// Delivery Settings
// ============================================================================

/**
 * Delivery mode determines how delivery is offered to customers:
 * - 'optional': Customer chooses between pickup and delivery (default)
 * - 'required': Outbound delivery is mandatory, return remains selectable
 * - 'included': Outbound delivery is mandatory and free (included in price)
 */
export type DeliveryMode = 'optional' | 'required' | 'included';

/**
 * Method for a single delivery leg (outbound or return).
 * - 'store': Equipment is handled at the store (pickup/return in person)
 * - 'address': Equipment is delivered to/collected from a custom address
 */
export type LegMethod = 'store' | 'address';

export interface DeliverySettings {
  /** Whether delivery is enabled for this store */
  enabled: boolean;
  /** Whether customers can choose configured pickup/return locations */
  multiLocationEnabled?: boolean;
  /** How delivery is offered to customers */
  mode: DeliveryMode;
  /** Price per kilometer in store currency */
  pricePerKm: number;
  /** Minimum delivery fee per leg, regardless of distance */
  minimumFee: number;
  /** Maximum delivery distance in km, null = unlimited */
  maximumDistance: number | null;
  /** Order subtotal above which delivery is free, null = no free delivery */
  freeDeliveryThreshold: number | null;
  /** Minimum order subtotal required to offer address delivery, null = always available */
  minimumOrderAmountForDelivery?: number | null;
}

export interface ReservationLocationSnapshot {
  type: 'primary' | 'additional';
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

// ============================================================================
// Inspection Settings (Etat des lieux)
// ============================================================================

/**
 * Inspection mode determines when inspections are prompted:
 * - 'optional': Staff can skip inspections
 * - 'recommended': Reminder shown but can be skipped
 * - 'required': Cannot change status without completing inspection
 */
export type InspectionMode = 'optional' | 'recommended' | 'required';

export interface InspectionSettings {
  /** Whether inspection feature is enabled */
  enabled: boolean;
  /** How inspections are enforced */
  mode: InspectionMode;
  /** Require customer signature on inspections */
  requireCustomerSignature: boolean;
  /** Auto-generate PDF after inspection completion */
  autoGeneratePdf: boolean;
  /** Maximum photos per inspection item */
  maxPhotosPerItem: number;
}

/**
 * Default inspection settings for new stores
 */
export const DEFAULT_INSPECTION_SETTINGS: InspectionSettings = {
  enabled: false,
  mode: 'optional',
  requireCustomerSignature: true,
  autoGeneratePdf: true,
  maxPhotosPerItem: 10,
};

// ============================================================================
// Integrations Settings
// ============================================================================

export type TulipPublicMode = 'required' | 'optional' | 'no_public';

export interface IntegrationStateSettings {
  enabled?: boolean;
}

export type IntegrationStates = Record<string, IntegrationStateSettings>;

export interface IntegrationData {
  states?: IntegrationStates;
}

// ============================================================================
// Store Settings
// ============================================================================

export interface StoreSettings {
  reservationMode: 'payment' | 'request';
  /** Minimum rental duration in minutes. 0 = no restriction. Default: 60. */
  minRentalMinutes?: number;
  /** Maximum rental duration in minutes. null = no limit. */
  maxRentalMinutes?: number | null;
  /** Minimum notice before start in minutes. Default: 1440 (24h). */
  advanceNoticeMinutes: number;
  /** Operational buffer after each return before stock is available again. Default: 0. */
  turnoverBufferMinutes?: number;
  requireCustomerAddress?: boolean;
  /**
   * Controls whether pending (unanswered) reservation requests block availability.
   * Only applies when reservationMode is 'request'.
   * - true (default): Pending requests immediately block product availability
   * - false: Only confirmed reservations block availability
   */
  pendingBlocksAvailability?: boolean;
  /**
   * Percentage of rental amount to collect immediately during online checkout.
   * Only applies when reservationMode is 'payment'.
   * - 100 (default): Full payment required upfront
   * - 10-99: Partial payment (deposit), remainder due at pickup
   */
  onlinePaymentDepositPercentage?: number;
  businessHours?: BusinessHours;
  country?: string; // ISO 3166-1 alpha-2 (e.g., 'FR', 'BE', 'CH')
  timezone?: string; // IANA timezone (e.g., 'Europe/Paris')
  currency?: string; // ISO 4217 currency code (e.g., 'EUR', 'USD', 'GBP')
  tax?: TaxSettings; // Configuration des taxes
  billingAddress?: BillingAddress; // Separate billing address for contracts
  delivery?: DeliverySettings; // Delivery configuration
  inspection?: InspectionSettings; // Inventory inspection (etat des lieux)
  integrationData?: IntegrationData;
}

export interface StoreTheme {
  mode: 'light' | 'dark';
  primaryColor: string;
  heroImages?: string[];
  maxDiscountPercent?: number | null;
}

/**
 * Unified notification template interface.
 * Used for both email and SMS customization.
 * @deprecated Use NotificationTemplate instead for new code
 */
export interface EmailCustomContent {
  subject?: string;
  greeting?: string;
  message?: string;
  signature?: string;
}

/**
 * Modern unified notification template.
 * Supports both email and SMS with consistent field names.
 */
export interface NotificationTemplate {
  /** Email subject line (supports variables: {name}, {number}, {storeName}) */
  subject?: string;
  /** Custom email message body (supports variables) */
  emailMessage?: string;
  /** Custom SMS message (supports variables, max 160 chars recommended) */
  smsMessage?: string;
}

/**
 * Convert legacy EmailCustomContent to NotificationTemplate
 */
export function toNotificationTemplate(
  legacy: EmailCustomContent | undefined,
): NotificationTemplate | undefined {
  if (!legacy) return undefined;
  return {
    subject: legacy.subject,
    emailMessage: legacy.message,
  };
}

/**
 * Convert NotificationTemplate to legacy EmailCustomContent (for backward compat)
 */
export function toLegacyEmailContent(
  template: NotificationTemplate | undefined,
): EmailCustomContent | undefined {
  if (!template) return undefined;
  return {
    subject: template.subject,
    message: template.emailMessage,
  };
}

export interface EmailSettings {
  // Toggle settings
  confirmationEnabled: boolean;
  reminderPickupEnabled: boolean;
  reminderReturnEnabled: boolean;
  replyToEmail: string | null;

  // Custom email content
  defaultSignature?: string;
  confirmationContent?: EmailCustomContent;
  rejectionContent?: EmailCustomContent;
  pickupReminderContent?: EmailCustomContent;
  returnReminderContent?: EmailCustomContent;
  requestAcceptedContent?: EmailCustomContent;
}

export interface ProductSnapshot {
  name: string;
  description: string | null;
  images: string[];
  combinationKey?: string | null;
  selectedAttributes?: UnitAttributes | null;
}

// ============================================================================
// Promo Code Types
// ============================================================================

export type PromoCodeType = 'percentage' | 'fixed';

export interface PromoCodeSnapshot {
  code: string;
  type: PromoCodeType;
  value: number;
}

// ============================================================================
// Pricing Types
// ============================================================================

export type PricingMode = 'hour' | 'day' | 'week';

export interface PricingTier {
  id: string;
  minDuration: number | null; // Minimum units to trigger this tier
  discountPercent: number | null; // Discount percentage (0-99)
  displayOrder: number;
}

export interface Rate {
  id: string;
  price: number;
  period: number; // Period in minutes
  displayOrder: number;
}

export interface PricingBreakdown {
  basePrice: number;
  effectivePrice: number;
  duration: number;
  pricingMode: PricingMode;
  discountPercent: number | null;
  discountAmount: number;
  tierApplied: string | null; // Human-readable tier label
  // V2 rate-based pricing fields
  durationMinutes?: number;
  appliedPeriods?: number;
  appliedRates?: Array<{ period: number; price: number; quantity: number }>;
  optimizerVersion?: string;
  // Tax fields
  taxRate: number | null;
  taxAmount: number | null;
  subtotalExclTax: number | null;
  subtotalInclTax: number | null;
  // Manual price override fields
  isManualOverride?: boolean;
  originalPrice?: number; // Price before manual override
  // Seasonal pricing breakdown
  seasonalSegments?: Array<{
    seasonalPricingId: string | null;
    seasonalPricingName: string | null;
    startDate: string;
    endDate: string;
    subtotal: number;
  }>;
}

// ============================================================================
// Billing mode (subscription vs pay-as-you-go)
// ============================================================================

/**
 * How a store is billed by the platform.
 * - `subscription`: fixed monthly plan (Start/Pro/Ultra) with usage caps.
 * - `pay_as_you_go`: billed per rental ("location"), no caps.
 */
export type BillingMode = 'subscription' | 'pay_as_you_go';

/**
 * A single graduated pricing band. `upToCount` is the inclusive upper bound of the
 * monthly rental index this band covers; `null` means "and above" (the last band).
 * Bands are evaluated in order; the first band whose `upToCount` is >= the rental's
 * 1-based monthly index (or whose `upToCount` is null) applies.
 *
 * Example: `[{ upToCount: 50, priceCents: 100 }, { upToCount: null, priceCents: 50 }]`
 * → rentals 1..50 cost 100c each, 51+ cost 50c each (graduated, monthly reset).
 */
export interface PayAsYouGoTier {
  upToCount: number | null;
  priceCents: number;
}

/**
 * Per-store pay-as-you-go pricing configuration. Stored as JSON on the store's
 * subscription row. When fields are omitted, the platform default ladder applies.
 */
export interface PayAsYouGoConfig {
  /**
   * Flat lifetime rate (in cents) per rental that OVERRIDES the tier ladder.
   * Used for exclusive launch offers (e.g. 25c per rental for life).
   * `null`/omitted = use the tier ladder.
   */
  flatRateCents?: number | null;
  /** Graduated tier ladder. When omitted, the platform default ladder applies. */
  tiers?: PayAsYouGoTier[];
  /** ISO 4217 currency for the commission (lowercase, e.g. 'eur'). Default: 'eur'. */
  currency?: string;
}

export interface PlanFeatures {
  // Limits
  maxProducts: number | null; // null = unlimited
  maxReservationsPerMonth: number | null; // null = unlimited
  maxCustomers: number | null; // null = unlimited
  maxCollaborators: number | null; // null = unlimited, 0 = none
  maxSmsPerMonth: number | null; // null = unlimited, 0 = none

  // Features
  customDomain: boolean;
  analytics: boolean;
  emailNotifications: boolean;
  prioritySupport: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  onlinePayment: boolean;
  customerPortal: boolean;
  reviewBooster: boolean;
  aiAdvisor: boolean;
  phoneSupport: boolean;
  dedicatedManager: boolean;
}

// ============================================================================
// Review Booster Types
// ============================================================================

export interface GoogleReview {
  authorName: string;
  authorPhotoUrl?: string;
  authorPhotoBase64?: string; // Cached base64 encoded photo
  rating: number;
  text: string;
  relativeTimeDescription: string;
  time: number; // Unix timestamp
}

export interface ReviewBoosterTemplate {
  subject?: string;
  emailMessage?: string;
  smsMessage?: string;
}

export interface ReviewBoosterSettings {
  enabled: boolean;
  // Google Place info
  googlePlaceId: string | null;
  googlePlaceName: string | null;
  googlePlaceAddress: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  // Feature toggles
  displayReviewsOnStorefront: boolean;
  showReviewPromptInPortal: boolean;
  // Automation settings
  autoSendThankYouEmail: boolean;
  autoSendThankYouSms: boolean;
  emailDelayHours: number;
  smsDelayHours: number;
  // Custom template
  template?: ReviewBoosterTemplate;
}

// ============================================================================
// AI Advisor (storefront customer-facing assistant)
// ============================================================================

/**
 * How the advisor participates in checkout:
 * - 'optional': available in the widget, checkout unchanged
 * - 'recommended': non-blocking suggestion shown at checkout
 * - 'required': checkout is blocked until the advisor validates the conversation
 */
export type AiAdvisorMode = 'optional' | 'recommended' | 'required';

export interface AiAdvisorSettings {
  /** Whether the advisor widget is shown on the storefront */
  enabled: boolean;
  /** How the advisor participates in checkout */
  mode: AiAdvisorMode;
  /**
   * Free-text store-level context read by the advisor — what the owner would
   * tell a new employee (constraints, verifications to run, tone, policies).
   */
  storeContext: string;
  /** First assistant bubble shown when the widget opens (falls back to i18n) */
  welcomeMessage?: string;
  /** Widget title (falls back to i18n) */
  displayName?: string;
}

/**
 * Cart snapshot frozen when the advisor validates a conversation
 * (required mode). Checkout only passes when the reservation matches it —
 * same products, quantities and rental period.
 */
export interface AdvisorValidatedCart {
  items: { productId: string; quantity: number }[];
  startDate: string | null;
  endDate: string | null;
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
  | 'reservation_reminder_pickup'
  | 'reservation_reminder_return'
  | 'payment_received'
  | 'payment_failed';

export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  'reservation_new',
  'reservation_confirmed',
  'reservation_rejected',
  'reservation_cancelled',
  'reservation_picked_up',
  'reservation_completed',
  'reservation_reminder_pickup',
  'reservation_reminder_return',
  'payment_received',
  'payment_failed',
];

export interface NotificationChannelConfig {
  email: boolean;
  sms: boolean;
  discord: boolean;
  push: boolean;
}

export interface NotificationSettings {
  reservation_new: NotificationChannelConfig;
  reservation_confirmed: NotificationChannelConfig;
  reservation_rejected: NotificationChannelConfig;
  reservation_cancelled: NotificationChannelConfig;
  reservation_picked_up: NotificationChannelConfig;
  reservation_completed: NotificationChannelConfig;
  reservation_reminder_pickup: NotificationChannelConfig;
  reservation_reminder_return: NotificationChannelConfig;
  payment_received: NotificationChannelConfig;
  payment_failed: NotificationChannelConfig;

  // Automatic admin reminder timing (independent of customer reminder timing)
  reminderSettings?: {
    // Pickup reminder: hours before startDate to alert the admin (default: 24)
    pickupReminderHours: number;
    // Return reminder: hours before endDate to alert the admin (default: 24)
    returnReminderHours: number;
    // Delivery mode for admin reminders:
    //  - 'per_reservation' (default): one reminder per reservation, sent
    //    `pickup/returnReminderHours` before each event.
    //  - 'daily_digest': one consolidated summary per day listing that day's
    //    pickups and returns, sent at `digestHour` in the store's timezone.
    mode?: AdminReminderMode;
    // Store-local hour (0-23) to send the daily digest. Default: 8 (08:00).
    digestHour?: number;
  };
}

export type AdminReminderMode = 'per_reservation' | 'daily_digest';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  // Push defaults ON only for new reservations — the #1 real-time event.
  reservation_new: { email: true, sms: false, discord: false, push: true },
  reservation_confirmed: { email: true, sms: false, discord: false, push: false },
  reservation_rejected: { email: true, sms: false, discord: false, push: false },
  reservation_cancelled: { email: true, sms: false, discord: false, push: false },
  reservation_picked_up: { email: false, sms: false, discord: false, push: false },
  reservation_completed: { email: false, sms: false, discord: false, push: false },
  // Admin reminders are opt-in (off by default; SMS/email/Discord cost money or noise)
  reservation_reminder_pickup: { email: false, sms: false, discord: false, push: false },
  reservation_reminder_return: { email: false, sms: false, discord: false, push: false },
  payment_received: { email: true, sms: false, discord: false, push: false },
  payment_failed: { email: true, sms: false, discord: false, push: false },

  // Default admin reminder timing: 24 hours before event, per-reservation mode
  reminderSettings: {
    pickupReminderHours: 24,
    returnReminderHours: 24,
    mode: 'per_reservation',
    digestHour: 8,
  },
};

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
  | 'customer_payment_requested'
  | 'customer_deposit_authorization_requested'
  | 'customer_quote_sent'
  | 'customer_quote_accepted';

export const CUSTOMER_NOTIFICATION_EVENT_TYPES: CustomerNotificationEventType[] =
  [
    'customer_request_received',
    'customer_request_accepted',
    'customer_request_rejected',
    'customer_reservation_confirmed',
    'customer_reminder_pickup',
    'customer_reminder_return',
    'customer_payment_requested',
    'customer_deposit_authorization_requested',
    'customer_quote_sent',
    'customer_quote_accepted',
  ];

export interface CustomerNotificationChannelConfig {
  enabled: boolean;
  email: boolean;
  sms: boolean;
}

export interface CustomerNotificationTemplate {
  subject?: string;
  emailMessage?: string;
  smsMessage?: string;
}

export interface CustomerNotificationSettings {
  // Preferences per event type
  customer_request_received: CustomerNotificationChannelConfig;
  customer_request_accepted: CustomerNotificationChannelConfig;
  customer_request_rejected: CustomerNotificationChannelConfig;
  customer_reservation_confirmed: CustomerNotificationChannelConfig;
  customer_reminder_pickup: CustomerNotificationChannelConfig;
  customer_reminder_return: CustomerNotificationChannelConfig;
  customer_payment_requested: CustomerNotificationChannelConfig;
  customer_deposit_authorization_requested: CustomerNotificationChannelConfig;
  customer_quote_sent: CustomerNotificationChannelConfig;
  customer_quote_accepted: CustomerNotificationChannelConfig;

  // Custom templates
  templates: {
    customer_request_received?: CustomerNotificationTemplate;
    customer_request_accepted?: CustomerNotificationTemplate;
    customer_request_rejected?: CustomerNotificationTemplate;
    customer_reservation_confirmed?: CustomerNotificationTemplate;
    customer_reminder_pickup?: CustomerNotificationTemplate;
    customer_reminder_return?: CustomerNotificationTemplate;
    customer_payment_requested?: CustomerNotificationTemplate;
    customer_deposit_authorization_requested?: CustomerNotificationTemplate;
    customer_quote_sent?: CustomerNotificationTemplate;
    customer_quote_accepted?: CustomerNotificationTemplate;
  };

  // Automatic reminder settings
  reminderSettings?: {
    // Pickup reminder: hours before startDate to send reminder (default: 24)
    pickupReminderHours: number;
    // Return reminder: hours before endDate to send reminder (default: 24)
    returnReminderHours: number;
  };
}

export const DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS: CustomerNotificationSettings =
  {
    // Reservation journey - email enabled by default
    customer_request_received: { enabled: true, email: true, sms: false },
    customer_request_accepted: { enabled: true, email: true, sms: false },
    customer_request_rejected: { enabled: true, email: true, sms: false },
    customer_reservation_confirmed: { enabled: true, email: true, sms: false },

    // Reminders - email enabled by default (SMS disabled due to cost)
    customer_reminder_pickup: { enabled: true, email: true, sms: false },
    customer_reminder_return: { enabled: true, email: true, sms: false },

    // Payment requests - email enabled by default
    customer_payment_requested: { enabled: true, email: true, sms: false },
    customer_deposit_authorization_requested: {
      enabled: true,
      email: true,
      sms: false,
    },

    // Quotes - email enabled by default
    customer_quote_sent: { enabled: true, email: true, sms: false },
    customer_quote_accepted: { enabled: true, email: true, sms: false },

    // No custom templates by default
    templates: {},

    // Default reminder timing: 24 hours before event
    reminderSettings: {
      pickupReminderHours: 24,
      returnReminderHours: 24,
    },
  };
