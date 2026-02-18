import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  longtext,
  timestamp,
  boolean,
  int,
  decimal,
  json,
  unique,
  index,
} from 'drizzle-orm/mysql-core'
import { relations } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type {
  StoreSettings,
  StoreTheme,
  BookingAttributeAxis,
  EmailSettings,
  ProductSnapshot,
  PricingBreakdown,
  ProductTaxSettings,
  ReviewBoosterSettings,
  GoogleReview,
  NotificationSettings,
  CustomerNotificationSettings,
  UnitAttributes,
} from '@louez/types'

// Helper for generating IDs
const id = () => varchar('id', { length: 21 }).primaryKey().$defaultFn(() => nanoid())

// ============================================================================
// Better Auth Tables
// ============================================================================

export const users = mysqlTable('users', {
  id: id(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  image: text('image'),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
})

export const accounts = mysqlTable(
  'accounts',
  {
    id: id(),
    userId: varchar('user_id', { length: 21 }).notNull(),
    providerId: varchar('provider', { length: 255 }).notNull(),
    accountId: varchar('provider_account_id', { length: 255 }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'date' }),
    scope: varchar('scope', { length: 255 }),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdx: unique('accounts_provider_idx').on(
      table.providerId,
      table.accountId
    ),
    userIdx: index('accounts_user_idx').on(table.userId),
  })
)

export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    userId: varchar('user_id', { length: 21 }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    ipAddress: varchar('ip_address', { length: 255 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
    tokenIdx: index('sessions_token_idx').on(table.token),
  })
)

export const verification = mysqlTable('verification', {
  id: id(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
})

// ============================================================================
// Subscriptions (simplified - plans defined in code)
// ============================================================================

export const subscriptionStatus = mysqlEnum('subscription_status', [
  'active',
  'cancelled',
  'past_due',
  'trialing',
])

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull().unique(),

    // Plan slug (references plans defined in src/lib/plans.ts)
    planSlug: varchar('plan_slug', { length: 50 }).notNull().default('start'),

    // Status
    status: subscriptionStatus.default('active').notNull(),

    // Stripe (optional - only if Stripe is configured)
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),

    // Billing period
    currentPeriodEnd: timestamp('current_period_end', { mode: 'date' }),

    // Cancellation
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('subscriptions_store_idx').on(table.storeId),
    stripeSubscriptionIdx: index('subscriptions_stripe_subscription_idx').on(
      table.stripeSubscriptionId
    ),
    stripeCustomerIdx: index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
  })
)

// ============================================================================
// Store Members (Multi-store support)
// ============================================================================

export const memberRole = mysqlEnum('member_role', ['owner', 'member'])

export const storeMembers = mysqlTable(
  'store_members',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    userId: varchar('user_id', { length: 21 }).notNull(),
    role: memberRole.default('member').notNull(),
    addedBy: varchar('added_by', { length: 21 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueMembership: unique('store_members_unique').on(table.storeId, table.userId),
    storeIdx: index('store_members_store_idx').on(table.storeId),
    userIdx: index('store_members_user_idx').on(table.userId),
  })
)

export const invitationStatus = mysqlEnum('invitation_status', ['pending', 'accepted', 'expired', 'cancelled'])

export const storeInvitations = mysqlTable(
  'store_invitations',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    role: memberRole.default('member').notNull(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    status: invitationStatus.default('pending').notNull(),
    invitedBy: varchar('invited_by', { length: 21 }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('store_invitations_store_idx').on(table.storeId),
    emailIdx: index('store_invitations_email_idx').on(table.email),
    tokenIdx: index('store_invitations_token_idx').on(table.token),
  })
)

// ============================================================================
// Core Tables
// ============================================================================

export const stores = mysqlTable(
  'stores',
  {
    id: id(),
    userId: varchar('user_id', { length: 21 }).notNull(), // Owner - no longer unique for multi-store

    // Identity
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    description: text('description'),

    // Contact
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: text('address'),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),

    // Branding
    logoUrl: longtext('logo_url'),
    darkLogoUrl: longtext('dark_logo_url'),

    // Configuration
    settings: json('settings').$type<StoreSettings>().default({
      reservationMode: 'payment',
      minRentalMinutes: 60,
      maxRentalMinutes: null,
      advanceNoticeMinutes: 1440,
    }),

    // Theme
    theme: json('theme').$type<StoreTheme>().default({
      mode: 'light',
      primaryColor: '#0066FF',
    }),

    // Legal
    cgv: text('cgv'),
    legalNotice: text('legal_notice'),
    includeCgvInContract: boolean('include_cgv_in_contract').default(false).notNull(),

    // Stripe Connect
    stripeAccountId: varchar('stripe_account_id', { length: 255 }),
    stripeOnboardingComplete: boolean('stripe_onboarding_complete').default(false),
    stripeChargesEnabled: boolean('stripe_charges_enabled').default(false),

    // Email settings
    emailSettings: json('email_settings').$type<EmailSettings>().default({
      confirmationEnabled: true,
      reminderPickupEnabled: true,
      reminderReturnEnabled: true,
      replyToEmail: null,
    }),

    // Review Booster settings
    reviewBoosterSettings: json('review_booster_settings').$type<ReviewBoosterSettings>(),

    // Notification settings (admin notifications)
    notificationSettings: json('notification_settings').$type<NotificationSettings>(),
    discordWebhookUrl: varchar('discord_webhook_url', { length: 500 }),
    ownerPhone: varchar('owner_phone', { length: 20 }),

    // Customer notification settings (notifications sent to customers)
    customerNotificationSettings: json('customer_notification_settings').$type<CustomerNotificationSettings>(),

    // Calendar export
    icsToken: varchar('ics_token', { length: 32 }),

    // Referral system
    referralCode: varchar('referral_code', { length: 12 }).unique(),
    referredByUserId: varchar('referred_by_user_id', { length: 21 }),
    referredByStoreId: varchar('referred_by_store_id', { length: 21 }),

    // Trial period (platform admin only)
    trialDays: int('trial_days').default(0).notNull(),

    // Subscription discount (platform admin only)
    discountPercent: int('discount_percent').default(0).notNull(),
    discountDurationMonths: int('discount_duration_months').default(0).notNull(),
    stripeCouponId: varchar('stripe_coupon_id', { length: 255 }),

    // Metadata
    onboardingCompleted: boolean('onboarding_completed').default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index('stores_slug_idx').on(table.slug),
    userIdx: index('stores_user_idx').on(table.userId),
    referralCodeIdx: index('stores_referral_code_idx').on(table.referralCode),
  })
)

export const categories = mysqlTable(
  'categories',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    order: int('order').default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('categories_store_idx').on(table.storeId),
  })
)

export const productStatus = mysqlEnum('product_status', ['draft', 'active', 'archived'])
export const pricingModeEnum = mysqlEnum('pricing_mode', ['hour', 'day', 'week'])

export const products = mysqlTable(
  'products',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    categoryId: varchar('category_id', { length: 21 }),

    // Information
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),

    // Images (array of URLs)
    images: json('images').$type<string[]>().default([]),

    // Pricing
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    deposit: decimal('deposit', { precision: 10, scale: 2 }).default('0'),
    basePeriodMinutes: int('base_period_minutes'),

    // Product pricing mode
    pricingMode: pricingModeEnum.notNull(),

    // Video URL (YouTube)
    videoUrl: text('video_url'),

    // Tax settings (product-specific)
    taxSettings: json('tax_settings').$type<ProductTaxSettings>(),

    // Pricing tier enforcement: when true, customers can only book
    // for the exact durations defined by pricing tiers (package pricing)
    enforceStrictTiers: boolean('enforce_strict_tiers').notNull().default(false),

    // Stock
    quantity: int('quantity').notNull().default(1),

    // Unit tracking: when true, individual units can be registered with identifiers
    // and assigned to reservations to track exactly which units are rented out
    trackUnits: boolean('track_units').notNull().default(false),

    // Booking attributes (advanced mode with trackUnits=true)
    // Example: [{ key: 'size', label: 'Size', position: 0 }, ...]
    bookingAttributeAxes: json('booking_attribute_axes').$type<BookingAttributeAxis[]>(),

    // Display order (for manual sorting)
    displayOrder: int('display_order').default(0),

    // Status
    status: productStatus.default('active'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('products_store_idx').on(table.storeId),
    categoryIdx: index('products_category_idx').on(table.categoryId),
    statusIdx: index('products_status_idx').on(table.status),
    // Composite index for queries: WHERE store_id = ? AND status = ? ORDER BY name
    storeStatusNameIdx: index('products_store_status_name_idx').on(table.storeId, table.status, table.name),
  })
)

// ============================================================================
// Product Pricing Tiers (Tiered/Progressive Pricing)
// ============================================================================

export const productPricingTiers = mysqlTable(
  'product_pricing_tiers',
  {
    id: id(),
    productId: varchar('product_id', { length: 21 }).notNull(),

    // Threshold
    minDuration: int('min_duration'),
    period: int('period'),

    // Discount
    discountPercent: decimal('discount_percent', { precision: 10, scale: 6 }),
    price: decimal('price', { precision: 10, scale: 2 }),

    // Display order
    displayOrder: int('display_order').default(0),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index('product_pricing_tiers_product_idx').on(table.productId),
    uniqueProductDuration: unique('product_pricing_tiers_unique').on(
      table.productId,
      table.minDuration
    ),
    uniqueProductPeriod: unique('product_pricing_tiers_unique_period').on(
      table.productId,
      table.period
    ),
  })
)

export const customerType = mysqlEnum('customer_type', ['individual', 'business'])

export const customers = mysqlTable(
  'customers',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),

    // Customer type (individual or business)
    customerType: customerType.default('individual').notNull(),

    // Identity
    email: varchar('email', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 255 }).notNull(),
    lastName: varchar('last_name', { length: 255 }).notNull(),

    // Business info (only for business customers)
    companyName: varchar('company_name', { length: 255 }),

    // Contact
    phone: varchar('phone', { length: 50 }),
    address: text('address'),
    city: varchar('city', { length: 255 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 2 }).default('FR'),

    // Internal notes
    notes: text('notes'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueEmailPerStore: unique('customers_unique_email_per_store').on(
      table.storeId,
      table.email
    ),
    storeIdx: index('customers_store_idx').on(table.storeId),
    emailIdx: index('customers_email_idx').on(table.email),
  })
)

export const customerSessions = mysqlTable('customer_sessions', {
  id: id(),
  customerId: varchar('customer_id', { length: 21 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
})

export const verificationCodes = mysqlTable('verification_codes', {
  id: id(),
  email: varchar('email', { length: 255 }).notNull(),
  storeId: varchar('store_id', { length: 21 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'magic_link' | 'code' | 'instant_access'
  token: varchar('token', { length: 255 }), // For magic link and instant access
  reservationId: varchar('reservation_id', { length: 21 }), // For instant access links to specific reservation
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
})

export const reservationStatus = mysqlEnum('reservation_status', [
  'pending',
  'confirmed',
  'ongoing',
  'completed',
  'cancelled',
  'rejected',
])

export const depositStatus = mysqlEnum('deposit_status', [
  'none', // No deposit required
  'pending', // Awaiting card to be saved
  'card_saved', // Card saved, hold not yet created
  'authorized', // Authorization hold active
  'captured', // Deposit captured (damage/loss)
  'released', // Authorization released
  'failed', // Authorization failed
])

export const reservations = mysqlTable(
  'reservations',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    customerId: varchar('customer_id', { length: 21 }).notNull(),

    // Reservation number (auto-incremented per store)
    number: varchar('number', { length: 50 }).notNull(),

    // Status
    status: reservationStatus.default('pending').notNull(),

    // Dates
    startDate: timestamp('start_date', { mode: 'date' }).notNull(),
    endDate: timestamp('end_date', { mode: 'date' }).notNull(),

    // Amounts
    subtotalAmount: decimal('subtotal_amount', { precision: 10, scale: 2 }).notNull(),
    depositAmount: decimal('deposit_amount', { precision: 10, scale: 2 }).notNull(),
    totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),

    // Tax amounts
    subtotalExclTax: decimal('subtotal_excl_tax', { precision: 10, scale: 2 }),
    taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }),
    taxRate: decimal('tax_rate', { precision: 5, scale: 2 }),

    // Signature
    signedAt: timestamp('signed_at', { mode: 'date' }),
    signatureIp: varchar('signature_ip', { length: 50 }),

    // Deposit (caution) management
    depositStatus: depositStatus.default('pending'),
    depositPaymentIntentId: varchar('deposit_payment_intent_id', { length: 255 }),
    depositAuthorizationExpiresAt: timestamp('deposit_authorization_expires_at', { mode: 'date' }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
    stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }),

    // Tracking
    pickedUpAt: timestamp('picked_up_at', { mode: 'date' }),
    returnedAt: timestamp('returned_at', { mode: 'date' }),

    // Notes
    customerNotes: text('customer_notes'),
    internalNotes: text('internal_notes'),

    // Delivery
    deliveryOption: varchar('delivery_option', { length: 20 }).default('pickup'), // 'pickup' | 'delivery'
    deliveryAddress: text('delivery_address'),
    deliveryCity: varchar('delivery_city', { length: 255 }),
    deliveryPostalCode: varchar('delivery_postal_code', { length: 20 }),
    deliveryCountry: varchar('delivery_country', { length: 2 }),
    deliveryLatitude: decimal('delivery_latitude', { precision: 10, scale: 7 }),
    deliveryLongitude: decimal('delivery_longitude', { precision: 10, scale: 7 }),
    deliveryDistanceKm: decimal('delivery_distance_km', { precision: 8, scale: 2 }),
    deliveryFee: decimal('delivery_fee', { precision: 10, scale: 2 }).default('0'),

    // Source
    source: varchar('source', { length: 20 }).default('online'),

    // Tulip insurance contract
    tulipContractId: varchar('tulip_contract_id', { length: 50 }),
    tulipContractStatus: varchar('tulip_contract_status', { length: 20 }),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('reservations_store_idx').on(table.storeId),
    customerIdx: index('reservations_customer_idx').on(table.customerId),
    statusIdx: index('reservations_status_idx').on(table.status),
    dateIdx: index('reservations_date_idx').on(table.startDate, table.endDate),
  })
)

// ============================================================================
// Product Tulip Mapping
// ============================================================================

export const productsTulip = mysqlTable(
  'products_tulip',
  {
    id: id(),
    productId: varchar('product_id', { length: 21 })
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    tulipProductId: varchar('tulip_product_id', { length: 50 }).notNull(),
  },
  (table) => ({
    productIdx: unique('products_tulip_product_idx').on(table.productId),
    tulipProductIdx: index('products_tulip_tulip_product_idx').on(table.tulipProductId),
  }),
)

export const reservationItems = mysqlTable(
  'reservation_items',
  {
    id: id(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),
    productId: varchar('product_id', { length: 21 }), // Nullable for custom items

    // Flag for custom items (not from catalog)
    isCustomItem: boolean('is_custom_item').default(false).notNull(),

    // Quantity and price at reservation time
    quantity: int('quantity').notNull(),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
    depositPerUnit: decimal('deposit_per_unit', { precision: 10, scale: 2 }).notNull(),
    totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),

    // Tax fields per item
    taxRate: decimal('tax_rate', { precision: 5, scale: 2 }),
    taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }),
    priceExclTax: decimal('price_excl_tax', { precision: 10, scale: 2 }),
    totalExclTax: decimal('total_excl_tax', { precision: 10, scale: 2 }),

    // Pricing breakdown for audit trail (tiered pricing details)
    pricingBreakdown: json('pricing_breakdown').$type<PricingBreakdown>(),

    // Product snapshot (for history) - also used for custom item name/description
    productSnapshot: json('product_snapshot').$type<ProductSnapshot>().notNull(),

    // Resolved combination key and selected attributes for tracked-unit products.
    // Null for non-tracked products and custom items.
    combinationKey: varchar('combination_key', { length: 255 }),
    selectedAttributes: json('selected_attributes').$type<UnitAttributes>(),

    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('reservation_items_reservation_idx').on(
      table.reservationId
    ),
    productCombinationIdx: index('reservation_items_product_combination_idx').on(
      table.productId,
      table.combinationKey
    ),
  })
)

export const paymentType = mysqlEnum('payment_type', [
  'rental',
  'deposit',
  'deposit_hold', // Authorization hold (empreinte)
  'deposit_capture', // Partial/full capture from hold
  'deposit_return',
  'damage',
  'adjustment', // Price adjustment (positive or negative)
])

export const paymentMethod = mysqlEnum('payment_method', [
  'stripe',
  'cash',
  'card',
  'transfer',
  'check',
  'other',
])

export const paymentStatus = mysqlEnum('payment_status', [
  'pending',
  'authorized', // For deposit holds (requires_capture)
  'completed',
  'failed',
  'cancelled', // Authorization cancelled (released)
  'refunded',
])

export const payments = mysqlTable(
  'payments',
  {
    id: id(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),

    // Amount
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),

    // Type and method
    type: paymentType.notNull(),
    method: paymentMethod.notNull(),
    status: paymentStatus.default('pending').notNull(),

    // Stripe (if online payment)
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
    stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
    stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }),

    // Authorization hold (empreinte)
    authorizationExpiresAt: timestamp('authorization_expires_at', { mode: 'date' }),
    capturedAmount: decimal('captured_amount', { precision: 10, scale: 2 }),

    // Currency (for multi-currency support)
    currency: varchar('currency', { length: 3 }).default('EUR'),

    // Notes
    notes: text('notes'),

    // Metadata
    paidAt: timestamp('paid_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('payments_reservation_idx').on(table.reservationId),
  })
)

export const documentType = mysqlEnum('document_type', ['contract', 'invoice'])

// ============================================================================
// Reservation Activity Log (Audit Trail)
// ============================================================================

export const activityType = mysqlEnum('activity_type', [
  'created',
  'confirmed',
  'rejected',
  'cancelled',
  'picked_up',
  'returned',
  'note_updated',
  'payment_added',
  'payment_updated',
  'payment_received', // Online payment received via Stripe
  'payment_initiated', // Customer started online payment (checkout session created)
  'payment_failed', // Online payment failed
  'payment_expired', // Checkout session expired (customer didn't complete payment)
  'deposit_authorized', // Authorization hold created
  'deposit_captured', // Deposit captured (damage/loss)
  'deposit_released', // Authorization released
  'deposit_failed', // Authorization failed
  'access_link_sent', // Instant access link sent to customer
  'modified', // Reservation modified (dates, items, prices)
  // Inspection events
  'inspection_departure_started', // Departure inspection initiated
  'inspection_departure_completed', // Departure inspection completed
  'inspection_return_started', // Return inspection initiated
  'inspection_return_completed', // Return inspection completed
  'inspection_damage_detected', // Damage found during inspection
  'inspection_signed', // Customer signed the inspection
])

export const reservationActivity = mysqlTable(
  'reservation_activity',
  {
    id: id(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),
    userId: varchar('user_id', { length: 21 }), // null for system actions or customer actions
    activityType: activityType.notNull(),

    // Additional context
    description: text('description'), // e.g., rejection reason
    metadata: json('metadata').$type<Record<string, unknown>>(), // For additional structured data

    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('reservation_activity_reservation_idx').on(table.reservationId),
    userIdx: index('reservation_activity_user_idx').on(table.userId),
  })
)

export const documents = mysqlTable('documents', {
  id: id(),
  reservationId: varchar('reservation_id', { length: 21 }).notNull(),

  type: documentType.notNull(),
  number: varchar('number', { length: 50 }).notNull(),

  // File (longtext to support base64-encoded PDFs with embedded images)
  fileUrl: longtext('file_url').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  cgvSnapshot: longtext('cgv_snapshot'),

  // Metadata
  generatedAt: timestamp('generated_at', { mode: 'date' }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
})

export const emailLogs = mysqlTable('email_logs', {
  id: id(),
  storeId: varchar('store_id', { length: 21 }).notNull(),
  reservationId: varchar('reservation_id', { length: 21 }),
  customerId: varchar('customer_id', { length: 21 }),

  // Email
  to: varchar('to', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  templateType: varchar('template_type', { length: 50 }).notNull(),

  // Result
  messageId: varchar('message_id', { length: 255 }),
  status: varchar('status', { length: 20 }).default('sent'),
  error: text('error'),

  sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
})

export const smsLogs = mysqlTable('sms_logs', {
  id: id(),
  storeId: varchar('store_id', { length: 21 }).notNull(),
  reservationId: varchar('reservation_id', { length: 21 }),
  customerId: varchar('customer_id', { length: 21 }),

  // SMS
  to: varchar('to', { length: 50 }).notNull(),
  message: text('message').notNull(),
  templateType: varchar('template_type', { length: 50 }).notNull(),

  // Result
  messageId: varchar('message_id', { length: 255 }),
  status: varchar('status', { length: 20 }).default('sent'),
  error: text('error'),

  // Credit source tracking
  creditSource: varchar('credit_source', { length: 20 }).default('plan'), // 'plan' or 'topup'

  sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
})

// ============================================================================
// Discord Logs (Admin notification logs)
// ============================================================================

export const discordLogs = mysqlTable('discord_logs', {
  id: id(),
  storeId: varchar('store_id', { length: 21 }).notNull(),
  reservationId: varchar('reservation_id', { length: 21 }),

  // Notification details
  eventType: varchar('event_type', { length: 50 }).notNull(),

  // Result
  status: varchar('status', { length: 20 }).default('sent').notNull(),
  error: text('error'),

  sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
})

// ============================================================================
// SMS Credits (Prepaid SMS Balance)
// ============================================================================

export const smsCredits = mysqlTable(
  'sms_credits',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull().unique(),

    // Balance tracking
    balance: int('balance').notNull().default(0), // Current available credits
    totalPurchased: int('total_purchased').notNull().default(0), // Lifetime total purchased
    totalUsed: int('total_used').notNull().default(0), // Lifetime total used from prepaid

    // Timestamps
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('sms_credits_store_idx').on(table.storeId),
  })
)

export const smsTopupStatus = mysqlEnum('sms_topup_status', [
  'pending',
  'completed',
  'failed',
  'refunded',
])

export const smsTopupTransactions = mysqlTable(
  'sms_topup_transactions',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),

    // Purchase details
    quantity: int('quantity').notNull(), // Number of SMS purchased
    unitPriceCents: int('unit_price_cents').notNull(), // Price per SMS in cents (15 or 7)
    totalAmountCents: int('total_amount_cents').notNull(), // Total amount in cents
    currency: varchar('currency', { length: 3 }).notNull().default('eur'),

    // Stripe references
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    // Status
    status: smsTopupStatus.default('pending').notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { mode: 'date' }),
  },
  (table) => ({
    storeIdx: index('sms_topup_store_idx').on(table.storeId),
    statusIdx: index('sms_topup_status_idx').on(table.status),
    stripeSessionIdx: index('sms_topup_stripe_session_idx').on(table.stripeSessionId),
  })
)

// ============================================================================
// Review Booster Tables
// ============================================================================

export const reviewRequestChannel = mysqlEnum('review_request_channel', ['email', 'sms'])

export const reviewRequestLogs = mysqlTable(
  'review_request_logs',
  {
    id: id(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    customerId: varchar('customer_id', { length: 21 }).notNull(),
    channel: reviewRequestChannel.notNull(),
    sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('review_request_logs_reservation_idx').on(table.reservationId),
    storeIdx: index('review_request_logs_store_idx').on(table.storeId),
  })
)

// ============================================================================
// Reminder Logs (Automatic pickup/return reminders)
// ============================================================================

export const reminderType = mysqlEnum('reminder_type', ['pickup', 'return'])
export const reminderChannel = mysqlEnum('reminder_channel', ['email', 'sms'])

export const reminderLogs = mysqlTable(
  'reminder_logs',
  {
    id: id(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    customerId: varchar('customer_id', { length: 21 }).notNull(),
    type: reminderType.notNull(),
    channel: reminderChannel.notNull(),
    sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('reminder_logs_reservation_idx').on(table.reservationId),
    storeIdx: index('reminder_logs_store_idx').on(table.storeId),
    // Prevent duplicate reminders
    uniqueReminder: unique('reminder_logs_unique').on(
      table.reservationId,
      table.type,
      table.channel
    ),
  })
)

export const googlePlacesCache = mysqlTable(
  'google_places_cache',
  {
    id: id(),
    placeId: varchar('place_id', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    address: text('address'),
    rating: decimal('rating', { precision: 2, scale: 1 }),
    reviewCount: int('review_count'),
    reviews: json('reviews').$type<GoogleReview[]>(),
    mapsUrl: text('maps_url'),
    fetchedAt: timestamp('fetched_at', { mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  },
  (table) => ({
    placeIdIdx: index('google_places_cache_place_id_idx').on(table.placeId),
    expiresAtIdx: index('google_places_cache_expires_at_idx').on(table.expiresAt),
  })
)

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  ownedStores: many(stores),
  memberships: many(storeMembers),
  accounts: many(accounts),
  sessions: many(sessions),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  store: one(stores, {
    fields: [subscriptions.storeId],
    references: [stores.id],
  }),
}))

export const storeMembersRelations = relations(storeMembers, ({ one }) => ({
  store: one(stores, {
    fields: [storeMembers.storeId],
    references: [stores.id],
  }),
  user: one(users, {
    fields: [storeMembers.userId],
    references: [users.id],
  }),
  addedByUser: one(users, {
    fields: [storeMembers.addedBy],
    references: [users.id],
    relationName: 'addedByUser',
  }),
}))

export const storeInvitationsRelations = relations(storeInvitations, ({ one }) => ({
  store: one(stores, {
    fields: [storeInvitations.storeId],
    references: [stores.id],
  }),
  invitedByUser: one(users, {
    fields: [storeInvitations.invitedBy],
    references: [users.id],
  }),
}))

export const storesRelations = relations(stores, ({ one, many }) => ({
  owner: one(users, {
    fields: [stores.userId],
    references: [users.id],
  }),
  members: many(storeMembers),
  invitations: many(storeInvitations),
  subscription: one(subscriptions, {
    fields: [stores.id],
    references: [subscriptions.storeId],
  }),
  referredByStore: one(stores, {
    fields: [stores.referredByStoreId],
    references: [stores.id],
    relationName: 'referrals',
  }),
  referrals: many(stores, {
    relationName: 'referrals',
  }),
  categories: many(categories),
  products: many(products),
  customers: many(customers),
  reservations: many(reservations),
  emailLogs: many(emailLogs),
  smsLogs: many(smsLogs),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  store: one(stores, {
    fields: [categories.storeId],
    references: [stores.id],
  }),
  products: many(products),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, {
    fields: [products.storeId],
    references: [stores.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  reservationItems: many(reservationItems),
  pricingTiers: many(productPricingTiers),
  units: many(productUnits),
  accessories: many(productAccessories, { relationName: 'productAccessories' }),
  accessoryOf: many(productAccessories, { relationName: 'accessoryOf' }),
  tulipMapping: one(productsTulip, {
    fields: [products.id],
    references: [productsTulip.productId],
  }),
}))

export const productsTulipRelations = relations(productsTulip, ({ one }) => ({
  product: one(products, {
    fields: [productsTulip.productId],
    references: [products.id],
  }),
}))

export const productPricingTiersRelations = relations(productPricingTiers, ({ one }) => ({
  product: one(products, {
    fields: [productPricingTiers.productId],
    references: [products.id],
  }),
}))

// ============================================================================
// Product Units (Individual Unit Tracking)
// ============================================================================

export const unitStatus = mysqlEnum('unit_status', ['available', 'maintenance', 'retired'])

export const productUnits = mysqlTable(
  'product_units',
  {
    id: id(),
    productId: varchar('product_id', { length: 21 }).notNull(),

    // User-defined identifier (serial number, asset tag, etc.)
    identifier: varchar('identifier', { length: 255 }).notNull(),

    // Optional internal notes (e.g., "Blue frame", "New battery 2025")
    notes: text('notes'),

    // Flexible attributes for the unit (size/color/etc)
    attributes: json('attributes').$type<UnitAttributes>(),

    // Canonical key derived from product booking axes + unit attributes
    // "__default" is used when no booking axes are configured
    combinationKey: varchar('combination_key', { length: 255 }).notNull().default('__default'),

    // Unit lifecycle status
    // Note: "rented" is derived from reservation assignments, not stored here
    status: unitStatus.default('available').notNull(),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index('product_units_product_idx').on(table.productId),
    // Enforce unique identifier per product (same identifier can exist on different products)
    uniqueIdentifierPerProduct: unique('product_units_unique_identifier').on(
      table.productId,
      table.identifier
    ),
    // For quick lookups of available units
    statusIdx: index('product_units_status_idx').on(table.productId, table.status),
    statusCombinationIdx: index('product_units_status_combination_idx').on(
      table.productId,
      table.status,
      table.combinationKey
    ),
  })
)

export const productUnitsRelations = relations(productUnits, ({ one, many }) => ({
  product: one(products, {
    fields: [productUnits.productId],
    references: [products.id],
  }),
  reservationAssignments: many(reservationItemUnits),
}))

// ============================================================================
// Reservation Item Units (Unit Assignment to Reservations)
// ============================================================================

export const reservationItemUnits = mysqlTable(
  'reservation_item_units',
  {
    id: id(),
    reservationItemId: varchar('reservation_item_id', { length: 21 }).notNull(),
    productUnitId: varchar('product_unit_id', { length: 21 }).notNull(),

    // Snapshot of identifier at assignment time (for contract/history accuracy
    // even if the unit is renamed later)
    identifierSnapshot: varchar('identifier_snapshot', { length: 255 }).notNull(),

    // When the unit was assigned
    assignedAt: timestamp('assigned_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationItemIdx: index('reservation_item_units_item_idx').on(table.reservationItemId),
    productUnitIdx: index('reservation_item_units_unit_idx').on(table.productUnitId),
    // Prevent assigning the same unit twice to the same reservation item
    uniqueAssignment: unique('reservation_item_units_unique').on(
      table.reservationItemId,
      table.productUnitId
    ),
  })
)

export const reservationItemUnitsRelations = relations(reservationItemUnits, ({ one }) => ({
  reservationItem: one(reservationItems, {
    fields: [reservationItemUnits.reservationItemId],
    references: [reservationItems.id],
  }),
  productUnit: one(productUnits, {
    fields: [reservationItemUnits.productUnitId],
    references: [productUnits.id],
  }),
}))

// ============================================================================
// Product Accessories (Upsell/Cross-sell)
// ============================================================================

export const productAccessories = mysqlTable(
  'product_accessories',
  {
    id: id(),
    productId: varchar('product_id', { length: 21 }).notNull(),
    accessoryId: varchar('accessory_id', { length: 21 }).notNull(),
    displayOrder: int('display_order').default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index('product_accessories_product_idx').on(table.productId),
    uniqueProductAccessory: unique('product_accessories_unique').on(
      table.productId,
      table.accessoryId
    ),
  })
)

export const productAccessoriesRelations = relations(productAccessories, ({ one }) => ({
  product: one(products, {
    fields: [productAccessories.productId],
    references: [products.id],
    relationName: 'productAccessories',
  }),
  accessory: one(products, {
    fields: [productAccessories.accessoryId],
    references: [products.id],
    relationName: 'accessoryOf',
  }),
}))

export const customersRelations = relations(customers, ({ one, many }) => ({
  store: one(stores, {
    fields: [customers.storeId],
    references: [stores.id],
  }),
  reservations: many(reservations),
  sessions: many(customerSessions),
}))

export const customerSessionsRelations = relations(customerSessions, ({ one }) => ({
  customer: one(customers, {
    fields: [customerSessions.customerId],
    references: [customers.id],
  }),
}))

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  store: one(stores, {
    fields: [reservations.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [reservations.customerId],
    references: [customers.id],
  }),
  items: many(reservationItems),
  payments: many(payments),
  documents: many(documents),
  activity: many(reservationActivity),
}))

export const reservationItemsRelations = relations(reservationItems, ({ one, many }) => ({
  reservation: one(reservations, {
    fields: [reservationItems.reservationId],
    references: [reservations.id],
  }),
  product: one(products, {
    fields: [reservationItems.productId],
    references: [products.id],
  }),
  assignedUnits: many(reservationItemUnits),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  reservation: one(reservations, {
    fields: [payments.reservationId],
    references: [reservations.id],
  }),
}))

export const documentsRelations = relations(documents, ({ one }) => ({
  reservation: one(reservations, {
    fields: [documents.reservationId],
    references: [reservations.id],
  }),
}))

export const reservationActivityRelations = relations(reservationActivity, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationActivity.reservationId],
    references: [reservations.id],
  }),
  user: one(users, {
    fields: [reservationActivity.userId],
    references: [users.id],
  }),
}))

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
  store: one(stores, {
    fields: [emailLogs.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [emailLogs.reservationId],
    references: [reservations.id],
  }),
  customer: one(customers, {
    fields: [emailLogs.customerId],
    references: [customers.id],
  }),
}))

export const smsLogsRelations = relations(smsLogs, ({ one }) => ({
  store: one(stores, {
    fields: [smsLogs.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [smsLogs.reservationId],
    references: [reservations.id],
  }),
  customer: one(customers, {
    fields: [smsLogs.customerId],
    references: [customers.id],
  }),
}))

export const discordLogsRelations = relations(discordLogs, ({ one }) => ({
  store: one(stores, {
    fields: [discordLogs.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [discordLogs.reservationId],
    references: [reservations.id],
  }),
}))

export const smsCreditsRelations = relations(smsCredits, ({ one }) => ({
  store: one(stores, {
    fields: [smsCredits.storeId],
    references: [stores.id],
  }),
}))

export const smsTopupTransactionsRelations = relations(smsTopupTransactions, ({ one }) => ({
  store: one(stores, {
    fields: [smsTopupTransactions.storeId],
    references: [stores.id],
  }),
}))

export const reviewRequestLogsRelations = relations(reviewRequestLogs, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reviewRequestLogs.reservationId],
    references: [reservations.id],
  }),
  store: one(stores, {
    fields: [reviewRequestLogs.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [reviewRequestLogs.customerId],
    references: [customers.id],
  }),
}))

export const reminderLogsRelations = relations(reminderLogs, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reminderLogs.reservationId],
    references: [reservations.id],
  }),
  store: one(stores, {
    fields: [reminderLogs.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [reminderLogs.customerId],
    references: [customers.id],
  }),
}))

// ============================================================================
// Analytics Tables
// ============================================================================

export const pageType = mysqlEnum('page_type', [
  'home',
  'catalog',
  'product',
  'cart',
  'checkout',
  'confirmation',
  'account',
  'rental',
])

export const deviceType = mysqlEnum('device_type', ['mobile', 'tablet', 'desktop'])

export const pageViews = mysqlTable(
  'page_views',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    sessionId: varchar('session_id', { length: 36 }).notNull(), // UUID for anonymous tracking
    page: pageType.notNull(),
    productId: varchar('product_id', { length: 21 }), // If viewing a product page
    categoryId: varchar('category_id', { length: 21 }), // If filtering by category
    referrer: varchar('referrer', { length: 500 }), // Where the user came from
    device: deviceType.default('desktop'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('page_views_store_idx').on(table.storeId),
    sessionIdx: index('page_views_session_idx').on(table.sessionId),
    storeCreatedIdx: index('page_views_store_created_idx').on(table.storeId, table.createdAt),
    productIdx: index('page_views_product_idx').on(table.productId),
  })
)

export const storefrontEventType = mysqlEnum('storefront_event_type', [
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'update_quantity',
  'checkout_started',
  'checkout_completed',
  'checkout_abandoned',
  'payment_initiated',
  'payment_completed',
  'payment_failed',
  'login_requested',
  'login_completed',
])

export const storefrontEvents = mysqlTable(
  'storefront_events',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    customerId: varchar('customer_id', { length: 21 }), // If logged in
    eventType: storefrontEventType.notNull(),
    metadata: json('metadata').$type<Record<string, unknown>>(), // productId, quantity, amount, etc.
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('storefront_events_store_idx').on(table.storeId),
    sessionIdx: index('storefront_events_session_idx').on(table.sessionId),
    storeCreatedIdx: index('storefront_events_store_created_idx').on(
      table.storeId,
      table.createdAt
    ),
    eventTypeIdx: index('storefront_events_type_idx').on(table.eventType),
  })
)

export const dailyStats = mysqlTable(
  'daily_stats',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    date: timestamp('date', { mode: 'date' }).notNull(), // Day at 00:00:00
    pageViews: int('page_views').default(0).notNull(),
    uniqueVisitors: int('unique_visitors').default(0).notNull(),
    productViews: int('product_views').default(0).notNull(),
    cartAdditions: int('cart_additions').default(0).notNull(),
    checkoutStarted: int('checkout_started').default(0).notNull(),
    checkoutCompleted: int('checkout_completed').default(0).notNull(),
    reservationsCreated: int('reservations_created').default(0).notNull(),
    reservationsConfirmed: int('reservations_confirmed').default(0).notNull(),
    revenue: decimal('revenue', { precision: 10, scale: 2 }).default('0').notNull(),
    averageCartValue: decimal('average_cart_value', { precision: 10, scale: 2 }).default('0'),
    mobileVisitors: int('mobile_visitors').default(0).notNull(),
    tabletVisitors: int('tablet_visitors').default(0).notNull(),
    desktopVisitors: int('desktop_visitors').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueStoreDate: unique('daily_stats_unique_store_date').on(table.storeId, table.date),
    storeIdx: index('daily_stats_store_idx').on(table.storeId),
    dateIdx: index('daily_stats_date_idx').on(table.date),
    storeDateIdx: index('daily_stats_store_date_idx').on(table.storeId, table.date),
  })
)

export const productStats = mysqlTable(
  'product_stats',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    productId: varchar('product_id', { length: 21 }).notNull(),
    date: timestamp('date', { mode: 'date' }).notNull(),
    views: int('views').default(0).notNull(),
    cartAdditions: int('cart_additions').default(0).notNull(),
    reservations: int('reservations').default(0).notNull(),
    revenue: decimal('revenue', { precision: 10, scale: 2 }).default('0').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueProductDate: unique('product_stats_unique').on(table.storeId, table.productId, table.date),
    storeIdx: index('product_stats_store_idx').on(table.storeId),
    productIdx: index('product_stats_product_idx').on(table.productId),
    dateIdx: index('product_stats_date_idx').on(table.date),
  })
)

// Analytics Relations
export const pageViewsRelations = relations(pageViews, ({ one }) => ({
  store: one(stores, {
    fields: [pageViews.storeId],
    references: [stores.id],
  }),
  product: one(products, {
    fields: [pageViews.productId],
    references: [products.id],
  }),
  category: one(categories, {
    fields: [pageViews.categoryId],
    references: [categories.id],
  }),
}))

export const storefrontEventsRelations = relations(storefrontEvents, ({ one }) => ({
  store: one(stores, {
    fields: [storefrontEvents.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [storefrontEvents.customerId],
    references: [customers.id],
  }),
}))

export const dailyStatsRelations = relations(dailyStats, ({ one }) => ({
  store: one(stores, {
    fields: [dailyStats.storeId],
    references: [stores.id],
  }),
}))

export const productStatsRelations = relations(productStats, ({ one }) => ({
  store: one(stores, {
    fields: [productStats.storeId],
    references: [stores.id],
  }),
  product: one(products, {
    fields: [productStats.productId],
    references: [products.id],
  }),
}))

// ============================================================================
// Inspection Tables (Etat des lieux)
// ============================================================================

/**
 * Inspection template scope determines inheritance:
 * - store: Default template for all products in the store
 * - category: Template for products in a specific category
 * - product: Template for a specific product (highest priority)
 */
export const inspectionTemplateScope = mysqlEnum('inspection_template_scope', [
  'store',
  'category',
  'product',
])

/**
 * Field types for inspection template fields
 */
export const inspectionFieldType = mysqlEnum('inspection_field_type', [
  'checkbox', // Simple yes/no (e.g., "Brakes working")
  'rating', // 1-5 scale (e.g., "Tire condition")
  'text', // Free text notes
  'number', // Numeric value (e.g., "Operating hours: 150")
  'select', // Dropdown options (e.g., "Good/Fair/Poor")
])

/**
 * Inspection type: departure (pickup) or return
 */
export const inspectionType = mysqlEnum('inspection_type', [
  'departure', // Check-out inspection when customer picks up
  'return', // Check-in inspection when customer returns
])

/**
 * Inspection status workflow
 */
export const inspectionStatus = mysqlEnum('inspection_status', [
  'draft', // In progress, not yet completed
  'completed', // Inspection finished by staff
  'signed', // Customer signed the inspection
])

/**
 * Overall condition rating for quick assessment
 */
export const conditionRating = mysqlEnum('condition_rating', [
  'excellent', // Perfect condition
  'good', // Minor wear, acceptable
  'fair', // Noticeable wear, still functional
  'damaged', // Damage detected, needs attention
])

/**
 * Inspection templates define what points to check for products
 */
export const inspectionTemplates = mysqlTable(
  'inspection_templates',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    scope: inspectionTemplateScope.notNull(),
    categoryId: varchar('category_id', { length: 21 }), // If scope = 'category'
    productId: varchar('product_id', { length: 21 }), // If scope = 'product'
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    displayOrder: int('display_order').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('inspection_templates_store_idx').on(table.storeId),
    categoryIdx: index('inspection_templates_category_idx').on(table.categoryId),
    productIdx: index('inspection_templates_product_idx').on(table.productId),
    // One template per scope/target combination
    uniqueScope: unique('inspection_templates_unique_scope').on(
      table.storeId,
      table.scope,
      table.categoryId,
      table.productId
    ),
  })
)

/**
 * Individual inspection points within a template
 */
export const inspectionTemplateFields = mysqlTable(
  'inspection_template_fields',
  {
    id: id(),
    templateId: varchar('template_id', { length: 21 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    fieldType: inspectionFieldType.notNull(),
    options: json('options').$type<string[]>(), // For 'select' type
    ratingMin: int('rating_min').default(1), // For 'rating' type
    ratingMax: int('rating_max').default(5), // For 'rating' type
    numberUnit: varchar('number_unit', { length: 50 }), // For 'number' type (e.g., "hours", "km")
    isRequired: boolean('is_required').default(false).notNull(),
    sectionName: varchar('section_name', { length: 100 }), // Optional grouping
    displayOrder: int('display_order').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    templateIdx: index('inspection_template_fields_template_idx').on(table.templateId),
    orderIdx: index('inspection_template_fields_order_idx').on(
      table.templateId,
      table.displayOrder
    ),
  })
)

/**
 * Inspection records for reservations
 */
export const inspections = mysqlTable(
  'inspections',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    reservationId: varchar('reservation_id', { length: 21 }).notNull(),
    type: inspectionType.notNull(),
    status: inspectionStatus.default('draft').notNull(),
    // Template reference (snapshot stored for historical accuracy)
    templateId: varchar('template_id', { length: 21 }),
    templateSnapshot: json('template_snapshot').$type<{
      id: string
      name: string
      fields: Array<{
        id: string
        name: string
        fieldType: string
        options?: string[]
        ratingMin?: number
        ratingMax?: number
        numberUnit?: string
        isRequired: boolean
        sectionName?: string
      }>
    }>(),
    // General notes
    notes: text('notes'),
    // Performed by
    performedById: varchar('performed_by_id', { length: 21 }),
    performedAt: timestamp('performed_at', { mode: 'date' }),
    // Customer signature
    customerSignature: longtext('customer_signature'), // Base64 signature image
    signedAt: timestamp('signed_at', { mode: 'date' }),
    signatureIp: varchar('signature_ip', { length: 50 }),
    // Damage assessment
    hasDamage: boolean('has_damage').default(false).notNull(),
    damageDescription: text('damage_description'),
    estimatedDamageCost: decimal('estimated_damage_cost', { precision: 10, scale: 2 }),
    damagePaymentId: varchar('damage_payment_id', { length: 21 }), // Link to payment if charged
    // Timestamps
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('inspections_store_idx').on(table.storeId),
    reservationIdx: index('inspections_reservation_idx').on(table.reservationId),
    // One inspection per type per reservation
    uniqueTypePerReservation: unique('inspections_unique_type').on(
      table.reservationId,
      table.type
    ),
  })
)

/**
 * Per-item inspection within a reservation
 */
export const inspectionItems = mysqlTable(
  'inspection_items',
  {
    id: id(),
    inspectionId: varchar('inspection_id', { length: 21 }).notNull(),
    reservationItemId: varchar('reservation_item_id', { length: 21 }).notNull(),
    productUnitId: varchar('product_unit_id', { length: 21 }), // If unit tracking enabled
    // Product snapshot for historical reference
    productSnapshot: json('product_snapshot')
      .$type<{
        name: string
        unitIdentifier?: string
      }>()
      .notNull(),
    // Overall quick assessment
    overallCondition: conditionRating,
    notes: text('notes'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    inspectionIdx: index('inspection_items_inspection_idx').on(table.inspectionId),
    reservationItemIdx: index('inspection_items_reservation_item_idx').on(
      table.reservationItemId
    ),
    unitIdx: index('inspection_items_unit_idx').on(table.productUnitId),
  })
)

/**
 * Field values recorded during inspection
 */
export const inspectionFieldValues = mysqlTable(
  'inspection_field_values',
  {
    id: id(),
    inspectionItemId: varchar('inspection_item_id', { length: 21 }).notNull(),
    templateFieldId: varchar('template_field_id', { length: 21 }).notNull(),
    // Field snapshot for historical reference
    fieldSnapshot: json('field_snapshot')
      .$type<{
        name: string
        fieldType: string
        sectionName?: string
      }>()
      .notNull(),
    // Values (only one used based on type)
    checkboxValue: boolean('checkbox_value'),
    ratingValue: int('rating_value'),
    textValue: text('text_value'),
    numberValue: decimal('number_value', { precision: 15, scale: 4 }),
    selectValue: varchar('select_value', { length: 255 }),
    // Quick flag for filtering issues
    hasIssue: boolean('has_issue').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index('inspection_field_values_item_idx').on(table.inspectionItemId),
    fieldIdx: index('inspection_field_values_field_idx').on(table.templateFieldId),
    issueIdx: index('inspection_field_values_issue_idx').on(
      table.inspectionItemId,
      table.hasIssue
    ),
  })
)

/**
 * Photos taken during inspection
 */
export const inspectionPhotos = mysqlTable(
  'inspection_photos',
  {
    id: id(),
    inspectionItemId: varchar('inspection_item_id', { length: 21 }).notNull(),
    fieldValueId: varchar('field_value_id', { length: 21 }), // Optional link to specific field
    // R2/S3 storage keys
    photoKey: varchar('photo_key', { length: 255 }).notNull(),
    photoUrl: text('photo_url').notNull(),
    thumbnailKey: varchar('thumbnail_key', { length: 255 }),
    thumbnailUrl: text('thumbnail_url'),
    // Metadata
    caption: text('caption'),
    displayOrder: int('display_order').default(0).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index('inspection_photos_item_idx').on(table.inspectionItemId),
    fieldValueIdx: index('inspection_photos_field_value_idx').on(table.fieldValueId),
  })
)

// ============================================================================
// Inspection Relations
// ============================================================================

export const inspectionTemplatesRelations = relations(inspectionTemplates, ({ one, many }) => ({
  store: one(stores, {
    fields: [inspectionTemplates.storeId],
    references: [stores.id],
  }),
  category: one(categories, {
    fields: [inspectionTemplates.categoryId],
    references: [categories.id],
  }),
  product: one(products, {
    fields: [inspectionTemplates.productId],
    references: [products.id],
  }),
  fields: many(inspectionTemplateFields),
}))

export const inspectionTemplateFieldsRelations = relations(
  inspectionTemplateFields,
  ({ one }) => ({
    template: one(inspectionTemplates, {
      fields: [inspectionTemplateFields.templateId],
      references: [inspectionTemplates.id],
    }),
  })
)

export const inspectionsRelations = relations(inspections, ({ one, many }) => ({
  store: one(stores, {
    fields: [inspections.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [inspections.reservationId],
    references: [reservations.id],
  }),
  template: one(inspectionTemplates, {
    fields: [inspections.templateId],
    references: [inspectionTemplates.id],
  }),
  performedBy: one(users, {
    fields: [inspections.performedById],
    references: [users.id],
  }),
  damagePayment: one(payments, {
    fields: [inspections.damagePaymentId],
    references: [payments.id],
  }),
  items: many(inspectionItems),
}))

export const inspectionItemsRelations = relations(inspectionItems, ({ one, many }) => ({
  inspection: one(inspections, {
    fields: [inspectionItems.inspectionId],
    references: [inspections.id],
  }),
  reservationItem: one(reservationItems, {
    fields: [inspectionItems.reservationItemId],
    references: [reservationItems.id],
  }),
  productUnit: one(productUnits, {
    fields: [inspectionItems.productUnitId],
    references: [productUnits.id],
  }),
  fieldValues: many(inspectionFieldValues),
  photos: many(inspectionPhotos),
}))

export const inspectionFieldValuesRelations = relations(
  inspectionFieldValues,
  ({ one, many }) => ({
    inspectionItem: one(inspectionItems, {
      fields: [inspectionFieldValues.inspectionItemId],
      references: [inspectionItems.id],
    }),
    templateField: one(inspectionTemplateFields, {
      fields: [inspectionFieldValues.templateFieldId],
      references: [inspectionTemplateFields.id],
    }),
    photos: many(inspectionPhotos),
  })
)

export const inspectionPhotosRelations = relations(inspectionPhotos, ({ one }) => ({
  inspectionItem: one(inspectionItems, {
    fields: [inspectionPhotos.inspectionItemId],
    references: [inspectionItems.id],
  }),
  fieldValue: one(inspectionFieldValues, {
    fields: [inspectionPhotos.fieldValueId],
    references: [inspectionFieldValues.id],
  }),
}))
