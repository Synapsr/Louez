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
  minDuration: number
  maxDuration: number | null
  advanceNotice: number
  requireCustomerAddress?: boolean
  /**
   * Controls whether pending (unanswered) reservation requests block availability.
   * Only applies when reservationMode is 'request'.
   * - true (default): Pending requests immediately block product availability
   * - false: Only confirmed reservations block availability
   */
  pendingBlocksAvailability?: boolean
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

export interface EmailCustomContent {
  subject?: string
  greeting?: string
  message?: string
  signature?: string
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
}
