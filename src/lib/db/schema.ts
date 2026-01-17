import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
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
  EmailSettings,
  ProductSnapshot,
  PricingBreakdown,
  ProductTaxSettings,
} from '@/types'

// Helper for generating IDs
const id = () => varchar('id', { length: 21 }).primaryKey().$defaultFn(() => nanoid())

// ============================================================================
// Auth.js Tables
// ============================================================================

export const users = mysqlTable('users', {
  id: id(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  image: text('image'),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
})

export const accounts = mysqlTable(
  'accounts',
  {
    id: id(),
    userId: varchar('user_id', { length: 21 }).notNull(),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: int('expires_at'),
    token_type: varchar('token_type', { length: 255 }),
    scope: varchar('scope', { length: 255 }),
    id_token: text('id_token'),
    session_state: varchar('session_state', { length: 255 }),
  },
  (table) => ({
    providerIdx: unique('accounts_provider_idx').on(
      table.provider,
      table.providerAccountId
    ),
    userIdx: index('accounts_user_idx').on(table.userId),
  })
)

export const sessions = mysqlTable('sessions', {
  sessionToken: varchar('session_token', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 21 }).notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = mysqlTable(
  'verification_tokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => ({
    compositePk: unique('verification_tokens_identifier_token').on(
      table.identifier,
      table.token
    ),
  })
)

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
    logoUrl: text('logo_url'),

    // Configuration
    settings: json('settings').$type<StoreSettings>().default({
      pricingMode: 'day',
      reservationMode: 'payment',
      minDuration: 1,
      maxDuration: null,
      advanceNotice: 24,
    }),

    // Theme
    theme: json('theme').$type<StoreTheme>().default({
      mode: 'light',
      primaryColor: '#0066FF',
    }),

    // Legal
    cgv: text('cgv'),
    legalNotice: text('legal_notice'),

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

    // Calendar export
    icsToken: varchar('ics_token', { length: 32 }),

    // Metadata
    onboardingCompleted: boolean('onboarding_completed').default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index('stores_slug_idx').on(table.slug),
    userIdx: index('stores_user_idx').on(table.userId),
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

    // Product-specific pricing mode (null = inherit from store)
    pricingMode: pricingModeEnum,

    // Video URL (YouTube)
    videoUrl: text('video_url'),

    // Tax settings (product-specific)
    taxSettings: json('tax_settings').$type<ProductTaxSettings>(),

    // Stock
    quantity: int('quantity').notNull().default(1),

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
    minDuration: int('min_duration').notNull(),

    // Discount
    discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull(),

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

    // Source
    source: varchar('source', { length: 20 }).default('online'),

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

    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index('reservation_items_reservation_idx').on(
      table.reservationId
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

  // File
  fileUrl: text('file_url').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),

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
  categories: many(categories),
  products: many(products),
  customers: many(customers),
  reservations: many(reservations),
  emailLogs: many(emailLogs),
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
  accessories: many(productAccessories, { relationName: 'productAccessories' }),
  accessoryOf: many(productAccessories, { relationName: 'accessoryOf' }),
}))

export const productPricingTiersRelations = relations(productPricingTiers, ({ one }) => ({
  product: one(products, {
    fields: [productPricingTiers.productId],
    references: [products.id],
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

export const reservationItemsRelations = relations(reservationItems, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationItems.reservationId],
    references: [reservations.id],
  }),
  product: one(products, {
    fields: [reservationItems.productId],
    references: [products.id],
  }),
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
