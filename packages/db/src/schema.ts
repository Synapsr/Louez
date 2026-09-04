import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  decimal,
  foreignKey,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";

import type {
  AdvisorValidatedCart,
  AiAdvisorSettings,
  AiPhoneSettings,
  BookingAttributeAxis,
  CustomerNotificationSettings,
  EmailSettings,
  En16931InvoiceSnapshot,
  GoogleReview,
  InvoiceBuyerSnapshot,
  InvoiceLineSnapshot,
  InvoiceSellerSnapshot,
  InvoiceVatBreakdownSnapshot,
  NotificationSettings,
  PricingBreakdown,
  ProductImageHistory,
  ProductSnapshot,
  ProductTaxSettings,
  PromoCodeSnapshot,
  ReservationLocationSnapshot,
  ReviewBoosterSettings,
  StoreSettings,
  StoreTheme,
  UnitAttributes,
} from "@louez/types";
import type { PayAsYouGoConfig } from "@louez/types";

// Helper for generating IDs
const id = () =>
  varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid());

// ============================================================================
// Better Auth Tables
// ============================================================================

export const users = mysqlTable("users", {
  id: id(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  image: text("image"),
  emailVerified: boolean("email_verified").notNull().default(false),
  // Acquisition Channel: self-reported "how did you hear about us", captured once
  // on the owner's first Store onboarding. Distinct from Referral Attribution
  // (stores.referredByStoreId), which is the programmatic ?ref= link.
  acquisitionChannel: varchar("acquisition_channel", { length: 32 }),
  acquisitionChannelOther: varchar("acquisition_channel_other", {
    length: 255,
  }),
  // First-touch acquisition origin captured from the signup-origin cookie (e.g. "reeent").
  signupOrigin: varchar("signup_origin", { length: 32 }),
  // Self-reported segment ("you are: independent / established store /
  // association / individual"), optional, captured on the profile onboarding step.
  businessType: varchar("business_type", { length: 32 }),
  // Self-reported rental intent, optional, captured once on the profile
  // onboarding step: what they plan to rent out and roughly how many items.
  // Analytics segmentation only (ICP discovery) — never gates features.
  productCategory: varchar("product_category", { length: 32 }),
  fleetSize: varchar("fleet_size", { length: 16 }),
  keyboardShortcuts: json("keyboard_shortcuts").$type<Record<string, string | string[]>>(),
  // What's New reading state, per user rather than per browser: which
  // announcements have been read (`seenIds`) and which contextual "New" badges
  // have been dismissed (`dismissedFeatureIds`). `null` until the first read.
  whatsNewProgress: json("whats_new_progress").$type<{
    dismissedFeatureIds: string[];
    seenIds: string[];
  }>(),
  // Set once the user has been through the "introduce yourself" onboarding
  // step. Google users get a prefilled name but still confirm it once.
  profileCompletedAt: timestamp("profile_completed_at", { mode: "date" }),
  reeentIntroAcknowledgedAt: timestamp("reeent_intro_acknowledged_at", {
    mode: "date",
  }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = mysqlTable(
  "accounts",
  {
    id: id(),
    userId: varchar("user_id", { length: 21 }).notNull(),
    providerId: varchar("provider", { length: 255 }).notNull(),
    accountId: varchar("provider_account_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: varchar("scope", { length: 255 }),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdx: unique("accounts_provider_idx").on(table.providerId, table.accountId),
    userIdx: index("accounts_user_idx").on(table.userId),
  }),
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: id(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    userId: varchar("user_id", { length: 21 }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    ipAddress: varchar("ip_address", { length: 255 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    tokenIdx: index("sessions_token_idx").on(table.token),
  }),
);

export const verification = mysqlTable("verification", {
  id: id(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: varchar("value", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
});

// ============================================================================
// Subscriptions (simplified - plans defined in code)
// ============================================================================

export const subscriptionStatus = mysqlEnum("subscription_status", [
  "active",
  "cancelled",
  "past_due",
  "trialing",
]);

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull().unique(),

    // Plan slug (references plans defined in src/lib/plans.ts). The free "start"
    // tier no longer exists; new stores default to pay-as-you-go.
    planSlug: varchar("plan_slug", { length: 50 }).notNull().default("pay_as_you_go"),

    // Billing mode: fixed subscription plan vs usage-based pay-as-you-go.
    // When 'pay_as_you_go', `planSlug` is ignored for limits and the store is
    // billed per rental (see platform_fee / pay_as_you_go_invoices). New stores
    // default to pay-as-you-go.
    billingMode: mysqlEnum("billing_mode", ["subscription", "pay_as_you_go"])
      .default("pay_as_you_go")
      .notNull(),

    // Per-store pay-as-you-go pricing override. null => platform default ladder.
    payAsYouGoConfig: json("pay_as_you_go_config").$type<PayAsYouGoConfig>(),

    // Welcome allowance: number of free reservations granted at account creation. While
    // unused credits remain, a rental's pay-as-you-go commission is waived. Editable per
    // store in admin. Usage is derived from the ledger (reservation fees with source 'free').
    freeReservationsGranted: int("free_reservations_granted").notNull().default(0),

    // Status
    status: subscriptionStatus.default("active").notNull(),

    // Stripe (optional - only if Stripe is configured)
    stripeSubscriptionId: varchar("stripe_subscription_id", {
      length: 255,
    }).unique(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),

    // Billing period
    currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),

    // Cancellation
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("subscriptions_store_idx").on(table.storeId),
    stripeSubscriptionIdx: index("subscriptions_stripe_subscription_idx").on(
      table.stripeSubscriptionId,
    ),
    stripeCustomerIdx: index("subscriptions_stripe_customer_idx").on(table.stripeCustomerId),
  }),
);

// ============================================================================
// Platform fee ledger & pay-as-you-go invoicing
// ============================================================================

export const platformFeeSource = mysqlEnum("platform_fee_source", [
  "online", // collected at source via the Stripe application fee
  "manual", // reservation fee accrued for the month-end invoice (no Stripe)
  "free", // waived by the store's free-reservation welcome allowance (amount 0)
  "marketplace_online", // reeent fee collected at source via the Stripe application fee
  "marketplace_manual", // reeent fee accrued for the month-end invoice
  "marketplace_waived", // lifetime launch-cohort waiver (amount 0)
]);

export const platformFeeStatus = mysqlEnum("platform_fee_status", [
  "pending", // manual usage/marketplace fee awaiting the month-end invoice
  "collected", // collected at source via the application fee (or settled free row)
  "billed", // included in a paid/sent month-end invoice
  "voided", // reservation cancelled before billing -> not charged
  "reversed", // collected fee refunded (payment refunded)
]);

/**
 * Ledger of platform commissions the application collected (or will collect). A
 * reservation may have one PAYG row (`res:<reservationId>`) and one reeent marketplace
 * row (`mkt:<reservationId>`), each idempotent through the unique `dedupKey`.
 */
export const platformFees = mysqlTable(
  "platform_fee",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    // The payment this fee was collected on (online fees). Null for manual fees.
    paymentId: varchar("payment_id", { length: 21 }),

    // Idempotency key: `res:<reservationId>` (PAYG) or `mkt:<reservationId>` (reeent).
    dedupKey: varchar("dedup_key", { length: 80 }).notNull().unique(),

    amountCents: int("amount_cents").notNull(),
    // How much of `amountCents` has been reversed (refunds/disputes). When it reaches
    // `amountCents` the row is marked `reversed`. Supports partial refunds.
    amountReversedCents: int("amount_reversed_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("eur"),

    source: platformFeeSource.notNull(),
    status: platformFeeStatus.notNull(),

    // YYYY-MM the fee is billed in (set when first recorded).
    billingMonth: varchar("billing_month", { length: 7 }).notNull(),
    // 1-based monthly position of a reservation fee, assigned at record time and used
    // to pick the graduated band. The stored `amountCents` is the authoritative,
    // immutable price for the rental (never recomputed from the current config).
    monthlyIndex: int("monthly_index"),

    // Stripe references (for source-collection + reversal on refund).
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeApplicationFeeId: varchar("stripe_application_fee_id", {
      length: 255,
    }),

    // Month-end invoice this fee was rolled into (manual usage/marketplace fees).
    invoiceId: varchar("invoice_id", { length: 21 }),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    billedAt: timestamp("billed_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    // Covers the hot month-end / usage aggregation filter (store, month, status).
    storeMonthIdx: index("platform_fee_store_month_idx").on(
      table.storeId,
      table.billingMonth,
      table.status,
    ),
    statusIdx: index("platform_fee_status_idx").on(table.status),
    reservationIdx: index("platform_fee_reservation_idx").on(table.reservationId),
    // Covers the refund-reversal lookup (paymentIntent, status).
    paymentIntentIdx: index("platform_fee_payment_intent_idx").on(
      table.stripePaymentIntentId,
      table.status,
    ),
  }),
);

export const payAsYouGoInvoiceStatus = mysqlEnum("payg_invoice_status", [
  "draft",
  "open", // sent / awaiting payment
  "paid",
  "failed",
  "void",
]);

/**
 * One aggregated month-end platform-fee invoice per (store, month). PAYG stores can
 * receive a usage line; every billing mode can receive a reeent marketplace line.
 * Unique by (store, month) so the billing cron is idempotent.
 */
export const payAsYouGoInvoices = mysqlTable(
  "pay_as_you_go_invoices",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    billingMonth: varchar("billing_month", { length: 7 }).notNull(),

    locationCount: int("location_count").notNull().default(0),
    grossAmountCents: int("gross_amount_cents").notNull().default(0), // T(N)
    collectedAtSourceCents: int("collected_at_source_cents").notNull().default(0), // C
    invoicedAmountCents: int("invoiced_amount_cents").notNull().default(0), // T - C
    usageLocationCount: int("usage_location_count").notNull().default(0),
    usageFeeAmountCents: int("usage_fee_amount_cents").notNull().default(0),
    marketplaceReservationCount: int("marketplace_reservation_count").notNull().default(0),
    marketplaceFeeAmountCents: int("marketplace_fee_amount_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("eur"),

    status: payAsYouGoInvoiceStatus.default("draft").notNull(),

    stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    paidAt: timestamp("paid_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueStoreMonth: unique("payg_invoices_store_month_unique").on(
      table.storeId,
      table.billingMonth,
    ),
    statusIdx: index("payg_invoices_status_idx").on(table.status),
    stripeInvoiceIdx: index("payg_invoices_stripe_invoice_idx").on(table.stripeInvoiceId),
  }),
);

export const referralRewardKind = mysqlEnum("referral_reward_kind", [
  "free_reservations", // pay-as-you-go referrer: granted as freeReservationsGranted
  "invoice_credit", // subscribed referrer: granted as a negative Stripe invoice item
]);

export const referralRewardStatus = mysqlEnum("referral_reward_status", [
  "granted",
  "clawed_back", // qualifying payment refunded/disputed within the clawback window
]);

/**
 * Ledger of Referrer Rewards: one row per Referred Store whose Qualifying Event (first
 * online Reservation payment at/above the minimum) unlocked a reward for its Referrer.
 * Idempotent via the UNIQUE `referred_store_id` (a referral pays out at most once).
 * Carries the Stripe payment references so a refund/dispute can claw the reward back.
 */
export const referralRewards = mysqlTable(
  "referral_rewards",
  {
    id: id(),
    // The Referrer Store that earns the reward.
    referrerStoreId: varchar("referrer_store_id", { length: 21 }).notNull(),
    // The Referred Store whose Qualifying Event unlocked it. Unique => one reward per
    // referred store (the grant idempotency key).
    referredStoreId: varchar("referred_store_id", { length: 21 }).notNull().unique(),
    referredUserId: varchar("referred_user_id", { length: 21 }),

    // The qualifying online Reservation payment.
    qualifyingReservationId: varchar("qualifying_reservation_id", {
      length: 21,
    }),
    qualifyingPaymentId: varchar("qualifying_payment_id", { length: 21 }),
    qualifyingAmountCents: int("qualifying_amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("eur"),

    // Stripe references for clawback lookup (refund keys on charge, dispute on PI).
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeChargeId: varchar("stripe_charge_id", { length: 255 }),
    // The negative invoice item created for an invoice_credit reward (clawback target).
    stripeInvoiceItemId: varchar("stripe_invoice_item_id", { length: 255 }),

    kind: referralRewardKind.notNull(),
    // Free reservations granted (kind='free_reservations'); 0 otherwise.
    freeReservations: int("free_reservations").notNull().default(0),
    // Euro invoice credit in cents (kind='invoice_credit'); 0 otherwise.
    creditCents: int("credit_cents").notNull().default(0),

    // YYYY-MM the reward was granted in (drives the per-referrer monthly cap).
    grantedMonth: varchar("granted_month", { length: 7 }).notNull(),

    status: referralRewardStatus.notNull().default("granted"),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    clawedBackAt: timestamp("clawed_back_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    // Covers the referrer's reward list and the monthly-cap count.
    referrerMonthIdx: index("referral_rewards_referrer_month_idx").on(
      table.referrerStoreId,
      table.grantedMonth,
    ),
    // Clawback lookups from refund (charge) and dispute (payment intent) events.
    chargeIdx: index("referral_rewards_charge_idx").on(table.stripeChargeId),
    paymentIntentIdx: index("referral_rewards_payment_intent_idx").on(table.stripePaymentIntentId),
  }),
);

// ============================================================================
// Store Members (Multi-store support)
// ============================================================================

export const memberRole = mysqlEnum("member_role", ["owner", "member"]);

export const storeMembers = mysqlTable(
  "store_members",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    userId: varchar("user_id", { length: 21 }).notNull(),
    role: memberRole.default("member").notNull(),
    addedBy: varchar("added_by", { length: 21 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueMembership: unique("store_members_unique").on(table.storeId, table.userId),
    storeIdx: index("store_members_store_idx").on(table.storeId),
    userIdx: index("store_members_user_idx").on(table.userId),
  }),
);

export const invitationStatus = mysqlEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "cancelled",
]);

export const storeInvitations = mysqlTable(
  "store_invitations",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: memberRole.default("member").notNull(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    status: invitationStatus.default("pending").notNull(),
    invitedBy: varchar("invited_by", { length: 21 }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("store_invitations_store_idx").on(table.storeId),
    emailIdx: index("store_invitations_email_idx").on(table.email),
    tokenIdx: index("store_invitations_token_idx").on(table.token),
  }),
);

// ============================================================================
// Core Tables
// ============================================================================

export const stores = mysqlTable(
  "stores",
  {
    id: id(),
    userId: varchar("user_id", { length: 21 }).notNull(), // Owner - no longer unique for multi-store

    // Identity
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    description: text("description"),

    // Contact
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),

    // Branding
    logoUrl: longtext("logo_url"),
    darkLogoUrl: longtext("dark_logo_url"),

    // Configuration
    settings: json("settings").$type<StoreSettings>().default({
      reservationMode: "payment",
      minRentalMinutes: 60,
      maxRentalMinutes: null,
      advanceNoticeMinutes: 1440,
      turnoverBufferMinutes: 0,
    }),

    // Theme
    theme: json("theme").$type<StoreTheme>().default({
      mode: "light",
      primaryColor: "#0066FF",
    }),

    // Legal
    cgv: text("cgv"),
    legalNotice: text("legal_notice"),
    includeCgvInContract: boolean("include_cgv_in_contract").default(false).notNull(),

    // Stripe Connect
    stripeAccountId: varchar("stripe_account_id", { length: 255 }),
    stripeOnboardingComplete: boolean("stripe_onboarding_complete").default(false),
    stripeChargesEnabled: boolean("stripe_charges_enabled").default(false),

    // Email settings
    emailSettings: json("email_settings").$type<EmailSettings>().default({
      confirmationEnabled: true,
      reminderPickupEnabled: true,
      reminderReturnEnabled: true,
      replyToEmail: null,
    }),

    // Review Booster settings
    reviewBoosterSettings: json("review_booster_settings").$type<ReviewBoosterSettings>(),

    // AI Advisor settings (storefront customer-facing assistant)
    aiAdvisorSettings: json("ai_advisor_settings").$type<AiAdvisorSettings>(),

    // AI Phone receptionist settings (inbound voice channel)
    aiPhoneSettings: json("ai_phone_settings").$type<AiPhoneSettings>(),

    // Notification settings (admin notifications)
    notificationSettings: json("notification_settings").$type<NotificationSettings>(),
    discordWebhookUrl: varchar("discord_webhook_url", { length: 500 }),
    ownerPhone: varchar("owner_phone", { length: 20 }),

    // Customer notification settings (notifications sent to customers)
    customerNotificationSettings: json(
      "customer_notification_settings",
    ).$type<CustomerNotificationSettings>(),

    // Calendar export
    icsToken: varchar("ics_token", { length: 32 }),

    // Referral system
    referralCode: varchar("referral_code", { length: 12 }).unique(),
    referredByUserId: varchar("referred_by_user_id", { length: 21 }),
    referredByStoreId: varchar("referred_by_store_id", { length: 21 }),
    signupOrigin: varchar("signup_origin", { length: 32 }),

    // Trial period (platform admin only)
    trialDays: int("trial_days").default(0).notNull(),

    // Subscription discount (platform admin only)
    discountPercent: int("discount_percent").default(0).notNull(),
    discountDurationMonths: int("discount_duration_months").default(0).notNull(),
    stripeCouponId: varchar("stripe_coupon_id", { length: 255 }),

    // Metadata
    onboardingCompleted: boolean("onboarding_completed").default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index("stores_slug_idx").on(table.slug),
    userIdx: index("stores_user_idx").on(table.userId),
    referralCodeIdx: index("stores_referral_code_idx").on(table.referralCode),
  }),
);

export const storeLegalProfiles = mysqlTable(
  "store_legal_profiles",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    legalName: varchar("legal_name", { length: 255 }).notNull(),
    legalForm: varchar("legal_form", { length: 100 }).notNull(),
    companyNumber: varchar("company_number", { length: 64 }).notNull(),
    companyNumberScheme: mysqlEnum("company_number_scheme", ["fr_siren", "be_bce"]),
    siret: varchar("siret", { length: 14 }),
    vatNumber: varchar("vat_number", { length: 64 }),
    rcsCity: varchar("rcs_city", { length: 255 }),
    shareCapital: decimal("share_capital", { precision: 10, scale: 2 }),
    registeredAddress: text("registered_address").notNull(),
    registeredAddressComplement: text("registered_address_complement"),
    registeredPostalCode: varchar("registered_postal_code", {
      length: 20,
    }).notNull(),
    registeredCity: varchar("registered_city", { length: 255 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    invoicingEnabled: boolean("invoicing_enabled").default(false).notNull(),
    vatRegime: mysqlEnum("vat_regime", ["monthly", "quarterly", "simplified", "vat_exemption"]),
    hasVatOnDebits: boolean("has_vat_on_debits").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeUnique: unique("store_legal_profiles_store_unique").on(table.storeId),
    storeIdx: index("store_legal_profiles_store_idx").on(table.storeId),
  }),
);

// ============================================================================
// Integrations
// ============================================================================

export const storeIntegrations = mysqlTable(
  "store_integrations",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    providerKey: varchar("provider_key", { length: 80 }).notNull(),
    category: varchar("category", { length: 60 }).notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    connectedByUserId: varchar("connected_by_user_id", { length: 21 }),
    providerAccountEmail: varchar("provider_account_email", { length: 255 }),
    status: mysqlEnum("status", ["disabled", "active", "needs_reconnect", "error", "syncing"])
      .default("disabled")
      .notNull(),
    lastHealthCheckAt: timestamp("last_health_check_at", { mode: "date" }),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeProviderUnique: unique("store_integrations_store_provider_unique").on(
      table.storeId,
      table.providerKey,
    ),
    storeIdx: index("store_integrations_store_idx").on(table.storeId),
    providerIdx: index("store_integrations_provider_idx").on(table.providerKey),
    statusIdx: index("store_integrations_status_idx").on(table.status),
  }),
);

export const integrationCredentials = mysqlTable(
  "integration_credentials",
  {
    id: id(),
    integrationId: varchar("integration_id", { length: 21 }).notNull(),
    credentialKind: mysqlEnum("credential_kind", ["oauth", "api_key"]).default("oauth").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    scopes: text("scopes"),
    keyVersion: int("key_version").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    integrationUnique: unique("integration_credentials_integration_unique").on(table.integrationId),
    integrationIdx: index("integration_credentials_integration_idx").on(table.integrationId),
  }),
);

export const storeCalendarIntegrations = mysqlTable(
  "store_calendar_integrations",
  {
    id: id(),
    integrationId: varchar("integration_id", { length: 21 }).notNull(),
    calendarId: varchar("calendar_id", { length: 255 }),
    calendarName: varchar("calendar_name", { length: 255 }),
    syncPendingReservations: boolean("sync_pending_reservations").default(true).notNull(),
    cancelledReservationBehavior: mysqlEnum("cancelled_reservation_behavior", ["show", "hide"])
      .default("show")
      .notNull(),
    backfillMonths: int("backfill_months").default(12).notNull(),
    backfillPastDays: int("backfill_past_days").default(30).notNull(),
    lastSyncAt: timestamp("last_sync_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    integrationUnique: unique("store_calendar_integrations_integration_unique").on(
      table.integrationId,
    ),
    integrationIdx: index("store_calendar_integrations_integration_idx").on(table.integrationId),
  }),
);

export const storeTulipIntegrations = mysqlTable(
  "store_tulip_integrations",
  {
    id: id(),
    integrationId: varchar("integration_id", { length: 21 }).notNull(),
    renterUid: varchar("renter_uid", { length: 120 }),
    archivedRenterUid: varchar("archived_renter_uid", { length: 120 }),
    publicMode: mysqlEnum("public_mode", ["required", "optional", "no_public"])
      .default("optional")
      .notNull(),
    connectedAt: timestamp("connected_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    integrationUnique: unique("store_tulip_integrations_integration_unique").on(
      table.integrationId,
    ),
    integrationIdx: index("store_tulip_integrations_integration_idx").on(table.integrationId),
    renterUidIdx: index("store_tulip_integrations_renter_uid_idx").on(table.renterUid),
  }),
);

export const storeMarketplaceChannels = mysqlTable(
  "store_marketplace_channels",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull().unique(),
    enabledByOwner: boolean("enabled_by_owner").default(false).notNull(),
    ownerDecidedAt: timestamp("owner_decided_at", { mode: "date" }),
    status: mysqlEnum("status", ["setup_required", "pending", "published", "paused", "disabled"])
      .default("setup_required")
      .notNull(),
    publishedAt: timestamp("published_at", { mode: "date" }),
    lifetimeFeeWaiverAt: timestamp("lifetime_fee_waiver_at", { mode: "date" }),
    cohortRank: int("cohort_rank"),
    disabledAt: timestamp("disabled_at", { mode: "date" }),
    termsAcceptedAt: timestamp("terms_accepted_at", { mode: "date" }),
    consentBasis: mysqlEnum("consent_basis", ["explicit", "terms_update"])
      .default("explicit")
      .notNull(),
    claimedBusinessId: varchar("claimed_business_id", { length: 255 }),
    claimConfirmedAt: timestamp("claim_confirmed_at", { mode: "date" }),
    statusReason: varchar("status_reason", { length: 255 }),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    statusUpdatedIdx: index("store_marketplace_channels_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    cohortRankUnique: unique("store_marketplace_channels_cohort_rank_unique").on(table.cohortRank),
  }),
);

export const storeMarketplaceCategoryMappings = mysqlTable(
  "store_marketplace_category_mappings",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    categoryId: varchar("category_id", { length: 21 }).notNull(),
    marketplaceCategorySlug: varchar("marketplace_category_slug", {
      length: 160,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeCategoryUnique: unique("store_marketplace_category_mappings_store_category_unique").on(
      table.storeId,
      table.categoryId,
    ),
    storeIdx: index("store_marketplace_category_mappings_store_idx").on(table.storeId),
    categoryIdx: index("store_marketplace_category_mappings_category_idx").on(table.categoryId),
  }),
);

export const marketplaceCatalogTombstones = mysqlTable(
  "marketplace_catalog_tombstones",
  {
    id: id(),
    entityType: mysqlEnum("entity_type", ["store", "product"]).notNull(),
    entityId: varchar("entity_id", { length: 21 }).notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    deletedAtIdIdx: index("marketplace_catalog_tombstones_deleted_at_id_idx").on(
      table.deletedAt,
      table.id,
    ),
    entityIdx: index("marketplace_catalog_tombstones_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

export type StoreMarketplaceChannel = typeof storeMarketplaceChannels.$inferSelect;
export type NewStoreMarketplaceChannel = typeof storeMarketplaceChannels.$inferInsert;
export type StoreMarketplaceCategoryMapping = typeof storeMarketplaceCategoryMappings.$inferSelect;
export type NewStoreMarketplaceCategoryMapping =
  typeof storeMarketplaceCategoryMappings.$inferInsert;
export type MarketplaceCatalogTombstone = typeof marketplaceCatalogTombstones.$inferSelect;
export type NewMarketplaceCatalogTombstone = typeof marketplaceCatalogTombstones.$inferInsert;

export const storeSuperPdpIntegrations = mysqlTable(
  "store_super_pdp_integrations",
  {
    id: id(),
    integrationId: varchar("integration_id", { length: 21 }).notNull(),
    environment: mysqlEnum("environment", ["sandbox", "production"]).default("sandbox").notNull(),
    superPdpCompanyId: varchar("super_pdp_company_id", { length: 255 }),
    companyVerificationStatus: varchar("company_verification_status", {
      length: 64,
    }),
    directoryEntryId: varchar("directory_entry_id", { length: 255 }),
    directoryEntryStatus: mysqlEnum("directory_entry_status", ["pending", "created", "error"]),
    sendAndReceive: boolean("send_and_receive").default(true).notNull(),
    lastEventCursor: varchar("last_event_cursor", { length: 255 }),
    connectedAt: timestamp("connected_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    integrationUnique: unique("store_super_pdp_integrations_integration_unique").on(
      table.integrationId,
    ),
    integrationIdx: index("store_super_pdp_integrations_integration_idx").on(table.integrationId),
    companyIdx: index("store_super_pdp_integrations_company_idx").on(table.superPdpCompanyId),
  }),
);

export const reservationCalendarEvents = mysqlTable(
  "reservation_calendar_events",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    integrationId: varchar("integration_id", { length: 21 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 255 }),
    payloadHash: varchar("payload_hash", { length: 64 }),
    syncStatus: mysqlEnum("sync_status", ["pending", "synced", "failed"])
      .default("pending")
      .notNull(),
    attemptCount: int("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }).defaultNow().notNull(),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIntegrationUnique: unique(
      "reservation_calendar_events_reservation_integration_unique",
    ).on(table.reservationId, table.integrationId),
    reservationIdx: index("reservation_calendar_events_reservation_idx").on(table.reservationId),
    integrationIdx: index("reservation_calendar_events_integration_idx").on(table.integrationId),
    syncIdx: index("reservation_calendar_events_sync_idx").on(
      table.syncStatus,
      table.nextAttemptAt,
    ),
  }),
);

export const storeLocations = mysqlTable(
  "store_locations",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 })
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    address: text("address").notNull(),
    city: varchar("city", { length: 255 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 2 }).default("FR"),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("store_locations_store_idx").on(table.storeId),
    activeIdx: index("store_locations_active_idx").on(table.storeId, table.isActive),
  }),
);

export const categories = mysqlTable(
  "categories",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    order: int("order").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("categories_store_idx").on(table.storeId),
  }),
);

// ============================================================================
// Variant Definitions (store-level shared catalog: Size, Color, Material...)
// ============================================================================

export const variantDefinitions = mysqlTable(
  "variant_definitions",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    // Canonical axis key (normalizeAxisKey of the label), matches
    // products.bookingAttributeAxes[].key and product_units.attributes keys.
    key: varchar("key", { length: 32 }).notNull(),
    label: varchar("label", { length: 50 }).notNull(),
    // Drives the presentation: color → swatches, size → ordered chips.
    kind: mysqlEnum("kind", ["size", "color", "custom"]).notNull().default("custom"),
    isActive: boolean("is_active").notNull().default(true),
    position: int("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("variant_definitions_store_idx").on(table.storeId),
    uniqueStoreKey: unique("variant_definitions_store_key_unique").on(table.storeId, table.key),
  }),
);

export const variantValues = mysqlTable(
  "variant_values",
  {
    id: id(),
    definitionId: varchar("definition_id", { length: 21 }).notNull(),
    // Stored label is the canonical value shared across products; units
    // reference it by label in product_units.attributes.
    label: varchar("label", { length: 100 }).notNull(),
    colorHex: varchar("color_hex", { length: 7 }),
    position: int("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    definitionIdx: index("variant_values_definition_idx").on(table.definitionId),
    uniqueDefinitionLabel: unique("variant_values_unique").on(table.definitionId, table.label),
  }),
);

export const productStatus = mysqlEnum("product_status", ["draft", "active", "archived"]);
export const pricingModeEnum = mysqlEnum("pricing_mode", ["hour", "day", "week"]);
export const pricingKindEnum = mysqlEnum("pricing_kind", ["duration", "fixed"]);
export const stockKindEnum = mysqlEnum("stock_kind", ["returnable", "consumable", "untracked"]);

export const products = mysqlTable(
  "products",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    categoryId: varchar("category_id", { length: 21 }),

    // Information
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Free-text context read by the storefront AI advisor (constraints,
    // ideal use cases, requirements). Never rendered on the storefront.
    aiContext: text("ai_context"),

    // Images (array of URLs)
    images: json("images").$type<string[]>().default([]),
    // Non-destructive transformation history for each logical product image.
    imageHistory: json("image_history").$type<ProductImageHistory[]>().default([]),

    // Pricing
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    deposit: decimal("deposit", { precision: 10, scale: 2 }).default("0"),
    basePeriodMinutes: int("base_period_minutes"),

    // Product pricing mode
    pricingMode: pricingModeEnum.notNull(),
    pricingKind: pricingKindEnum.notNull().default("duration"),
    stockKind: stockKindEnum.notNull().default("returnable"),

    // Video URL (YouTube)
    videoUrl: text("video_url"),

    // Tax settings (product-specific)
    taxSettings: json("tax_settings").$type<ProductTaxSettings>(),

    // Pricing tier enforcement: when true, customers can only book
    // for the exact durations defined by pricing tiers (package pricing)
    enforceStrictTiers: boolean("enforce_strict_tiers").notNull().default(false),

    // Stock
    quantity: int("quantity").notNull().default(1),

    // Unit tracking: when true, individual units can be registered with identifiers
    // and assigned to reservations to track exactly which units are rented out
    trackUnits: boolean("track_units").notNull().default(false),

    // Booking attributes (advanced mode with trackUnits=true)
    // Example: [{ key: 'size', label: 'Size', position: 0 }, ...]
    bookingAttributeAxes: json("booking_attribute_axes").$type<BookingAttributeAxis[]>(),

    // Display order (for manual sorting)
    displayOrder: int("display_order").default(0),

    // Status
    status: productStatus.default("active"),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("products_store_idx").on(table.storeId),
    categoryIdx: index("products_category_idx").on(table.categoryId),
    statusIdx: index("products_status_idx").on(table.status),
    // Composite index for queries: WHERE store_id = ? AND status = ? ORDER BY name
    storeStatusNameIdx: index("products_store_status_name_idx").on(
      table.storeId,
      table.status,
      table.name,
    ),
  }),
);

// ============================================================================
// Product Categories (Many-to-Many)
// ============================================================================

// Products can belong to several categories. `products.category_id` is kept in
// sync with the first (primary) category for backward compatibility with
// consumers that expect a single category (analytics, exports, related
// products, inspection templates).
export const productCategories = mysqlTable(
  "product_categories",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 }).notNull(),
    categoryId: varchar("category_id", { length: 21 }).notNull(),
    position: int("position").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("product_categories_product_idx").on(table.productId),
    categoryIdx: index("product_categories_category_idx").on(table.categoryId),
    uniqueProductCategory: unique("product_categories_unique").on(
      table.productId,
      table.categoryId,
    ),
  }),
);

// ============================================================================
// Product Pricing Tiers (Tiered/Progressive Pricing)
// ============================================================================

export const productPricingTiers = mysqlTable(
  "product_pricing_tiers",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 }).notNull(),

    // Threshold
    minDuration: int("min_duration"),
    period: int("period"),

    // Discount
    discountPercent: decimal("discount_percent", { precision: 10, scale: 6 }),
    price: decimal("price", { precision: 10, scale: 2 }),

    // Display order
    displayOrder: int("display_order").default(0),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("product_pricing_tiers_product_idx").on(table.productId),
    uniqueProductDuration: unique("product_pricing_tiers_unique").on(
      table.productId,
      table.minDuration,
    ),
    uniqueProductPeriod: unique("product_pricing_tiers_unique_period").on(
      table.productId,
      table.period,
    ),
  }),
);

// ============================================================================
// Product Seasonal Pricing
// ============================================================================

export const productSeasonalPricing = mysqlTable(
  "product_seasonal_pricing",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("product_seasonal_pricing_product_idx").on(table.productId),
    productDateIdx: index("product_seasonal_pricing_product_date_idx").on(
      table.productId,
      table.startDate,
      table.endDate,
    ),
  }),
);

export const productSeasonalPricingTiers = mysqlTable(
  "product_seasonal_pricing_tiers",
  {
    id: id(),
    seasonalPricingId: varchar("seasonal_pricing_id", { length: 21 }).notNull(),

    // Threshold (same structure as productPricingTiers)
    minDuration: int("min_duration"),
    period: int("period"),

    // Discount
    discountPercent: decimal("discount_percent", { precision: 10, scale: 6 }),
    price: decimal("price", { precision: 10, scale: 2 }),

    // Display order
    displayOrder: int("display_order").default(0),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    seasonalPricingIdx: index("seasonal_pricing_tiers_seasonal_idx").on(table.seasonalPricingId),
  }),
);

export const customerType = mysqlEnum("customer_type", ["individual", "business"]);

export const customers = mysqlTable(
  "customers",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),

    // Customer type (individual or business)
    customerType: customerType.default("individual").notNull(),

    // Identity
    email: varchar("email", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 255 }).notNull(),
    lastName: varchar("last_name", { length: 255 }).notNull(),
    marketplaceUserId: varchar("marketplace_user_id", { length: 255 }),

    // Business info (only for business customers)
    companyName: varchar("company_name", { length: 255 }),
    companyNumber: varchar("company_number", { length: 64 }),
    companyNumberScheme: mysqlEnum("company_number_scheme", ["fr_siren", "be_bce"]),
    vatNumber: varchar("vat_number", { length: 64 }),

    // Contact
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    city: varchar("city", { length: 255 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 2 }).default("FR"),

    // Internal notes
    notes: text("notes"),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueEmailPerStore: unique("customers_unique_email_per_store").on(table.storeId, table.email),
    storeIdx: index("customers_store_idx").on(table.storeId),
    emailIdx: index("customers_email_idx").on(table.email),
    marketplaceUserIdx: index("customers_marketplace_user_idx").on(table.marketplaceUserId),
  }),
);

export const customerSessions = mysqlTable("customer_sessions", {
  id: id(),
  customerId: varchar("customer_id", { length: 21 }).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const verificationCodes = mysqlTable("verification_codes", {
  id: id(),
  email: varchar("email", { length: 255 }).notNull(),
  storeId: varchar("store_id", { length: 21 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'magic_link' | 'code' | 'instant_access'
  token: varchar("token", { length: 255 }), // For magic link and instant access
  reservationId: varchar("reservation_id", { length: 21 }), // For instant access links to specific reservation
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const reservationStatus = mysqlEnum("reservation_status", [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
]);

export const depositStatus = mysqlEnum("deposit_status", [
  "none", // No deposit required
  "pending", // Awaiting card to be saved
  "card_saved", // Card saved, hold not yet created
  "authorized", // Authorization hold active
  "captured", // Deposit captured (damage/loss)
  "released", // Authorization released
  "failed", // Authorization failed
]);

export const reservations = mysqlTable(
  "reservations",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    customerId: varchar("customer_id", { length: 21 }).notNull(),

    // Reservation number (auto-incremented per store)
    number: varchar("number", { length: 50 }).notNull(),

    // Status
    status: reservationStatus.default("pending").notNull(),

    // Dates
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    endDate: timestamp("end_date", { mode: "date" }).notNull(),

    // Amounts
    subtotalAmount: decimal("subtotal_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    depositAmount: decimal("deposit_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),

    // Tax amounts
    subtotalExclTax: decimal("subtotal_excl_tax", { precision: 10, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
    taxRate: decimal("tax_rate", { precision: 5, scale: 2 }),

    // Signature
    signedAt: timestamp("signed_at", { mode: "date" }),
    signatureIp: varchar("signature_ip", { length: 50 }),

    // Deposit (caution) management
    depositStatus: depositStatus.default("pending"),
    depositPaymentIntentId: varchar("deposit_payment_intent_id", {
      length: 255,
    }),
    depositAuthorizationExpiresAt: timestamp("deposit_authorization_expires_at", { mode: "date" }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 255 }),

    // Tracking
    pickedUpAt: timestamp("picked_up_at", { mode: "date" }),
    returnedAt: timestamp("returned_at", { mode: "date" }),

    // Notes
    customerNotes: text("customer_notes"),
    internalNotes: text("internal_notes"),

    // Delivery — leg-based model (outbound = receive equipment, return = give back)
    outboundMethod: varchar("outbound_method", { length: 20 }).notNull().default("store"), // 'store' | 'address'
    returnMethod: varchar("return_method", { length: 20 }).notNull().default("store"), // 'store' | 'address'
    deliveryOption: varchar("delivery_option", { length: 20 }).default("pickup"), // Legacy: 'pickup' | 'delivery' — kept for backward compat
    deliveryAddress: text("delivery_address"), // Outbound leg address (when outboundMethod = 'address')
    deliveryCity: varchar("delivery_city", { length: 255 }),
    deliveryPostalCode: varchar("delivery_postal_code", { length: 20 }),
    deliveryCountry: varchar("delivery_country", { length: 2 }),
    deliveryLatitude: decimal("delivery_latitude", { precision: 10, scale: 7 }),
    deliveryLongitude: decimal("delivery_longitude", {
      precision: 10,
      scale: 7,
    }),
    deliveryDistanceKm: decimal("delivery_distance_km", {
      precision: 8,
      scale: 2,
    }),
    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0"),

    // Return leg address (when returnMethod = 'address')
    returnAddress: text("return_address"),
    returnCity: varchar("return_city", { length: 255 }),
    returnPostalCode: varchar("return_postal_code", { length: 20 }),
    returnCountry: varchar("return_country", { length: 2 }),
    returnLatitude: decimal("return_latitude", { precision: 10, scale: 7 }),
    returnLongitude: decimal("return_longitude", { precision: 10, scale: 7 }),
    returnDistanceKm: decimal("return_distance_km", { precision: 8, scale: 2 }),

    // Store pickup/return location snapshots. Null id means the store primary location.
    pickupLocationId: varchar("pickup_location_id", { length: 21 }),
    returnLocationId: varchar("return_location_id", { length: 21 }),
    pickupLocationSnapshot: json("pickup_location_snapshot").$type<ReservationLocationSnapshot>(),
    returnLocationSnapshot: json("return_location_snapshot").$type<ReservationLocationSnapshot>(),

    // Promo code
    promoCodeId: varchar("promo_code_id", { length: 21 }),
    discountAmount: decimal("discount_amount", {
      precision: 10,
      scale: 2,
    }).default("0"),
    promoCodeSnapshot: json("promo_code_snapshot").$type<PromoCodeSnapshot>(),

    // Source
    source: varchar("source", { length: 20 }).default("online"),

    // Tulip insurance contract
    tulipInsuranceOptIn: boolean("tulip_insurance_opt_in"),
    tulipInsuranceAmount: decimal("tulip_insurance_amount", {
      precision: 10,
      scale: 2,
    }),
    tulipContractId: varchar("tulip_contract_id", { length: 50 }),
    tulipContractStatus: varchar("tulip_contract_status", { length: 20 }),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("reservations_store_idx").on(table.storeId),
    customerIdx: index("reservations_customer_idx").on(table.customerId),
    statusIdx: index("reservations_status_idx").on(table.status),
    dateIdx: index("reservations_date_idx").on(table.startDate, table.endDate),
  }),
);

export const marketplaceBookingAttempts = mysqlTable(
  "marketplace_booking_attempts",
  {
    id: id(),
    bookingAttemptId: varchar("booking_attempt_id", { length: 36 }).notNull().unique(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    quoteTokenHash: varchar("quote_token_hash", { length: 64 }).notNull(),
    holdId: varchar("hold_id", { length: 21 }),
    reservationId: varchar("reservation_id", { length: 21 }),
    status: varchar("status", { length: 32 }).default("creating_hold").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("marketplace_booking_attempts_store_idx").on(table.storeId),
    reservationIdx: unique("marketplace_booking_attempts_reservation_idx").on(table.reservationId),
    holdIdx: unique("marketplace_booking_attempts_hold_idx").on(table.holdId),
    expiresAtIdx: index("marketplace_booking_attempts_expires_at_idx").on(table.expiresAt),
    updatedAtIdIdx: index("marketplace_booking_attempts_updated_at_id_idx").on(
      table.updatedAt,
      table.id,
    ),
  }),
);

export type MarketplaceBookingAttempt = typeof marketplaceBookingAttempts.$inferSelect;
export type NewMarketplaceBookingAttempt = typeof marketplaceBookingAttempts.$inferInsert;

// ============================================================================
// Product Tulip Mapping
// ============================================================================

export const productsTulip = mysqlTable(
  "products_tulip",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tulipProductId: varchar("tulip_product_id", { length: 50 }).notNull(),
  },
  (table) => ({
    productIdx: unique("products_tulip_product_idx").on(table.productId),
    tulipProductIdx: index("products_tulip_tulip_product_idx").on(table.tulipProductId),
  }),
);

export const reservationItems = mysqlTable(
  "reservation_items",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    productId: varchar("product_id", { length: 21 }), // Nullable for custom items

    // Flag for custom items (not from catalog)
    isCustomItem: boolean("is_custom_item").default(false).notNull(),

    // Quantity and price at reservation time
    quantity: int("quantity").notNull(),
    consumedQuantity: int("consumed_quantity").notNull().default(0),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    depositPerUnit: decimal("deposit_per_unit", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),

    // Tax fields per item
    taxRate: decimal("tax_rate", { precision: 5, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
    priceExclTax: decimal("price_excl_tax", { precision: 10, scale: 2 }),
    totalExclTax: decimal("total_excl_tax", { precision: 10, scale: 2 }),

    // Pricing breakdown for audit trail (tiered pricing details)
    pricingBreakdown: json("pricing_breakdown").$type<PricingBreakdown>(),

    // Product snapshot (for history) - also used for custom item name/description
    productSnapshot: json("product_snapshot").$type<ProductSnapshot>().notNull(),

    // Resolved combination key and selected attributes for tracked-unit products.
    // Null for non-tracked products and custom items.
    combinationKey: varchar("combination_key", { length: 255 }),
    selectedAttributes: json("selected_attributes").$type<UnitAttributes>(),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index("reservation_items_reservation_idx").on(table.reservationId),
    productCombinationIdx: index("reservation_items_product_combination_idx").on(
      table.productId,
      table.combinationKey,
    ),
  }),
);

export const paymentType = mysqlEnum("payment_type", [
  "rental",
  "deposit",
  "deposit_hold", // Authorization hold (empreinte)
  "deposit_capture", // Partial/full capture from hold
  "deposit_return",
  "damage",
  "adjustment", // Price adjustment (positive or negative)
]);

export const paymentMethod = mysqlEnum("payment_method", [
  "stripe",
  "cash",
  "card",
  "transfer",
  "check",
  "other",
]);

export const paymentStatus = mysqlEnum("payment_status", [
  "pending",
  "authorized", // For deposit holds (requires_capture)
  "completed",
  "failed",
  "cancelled", // Authorization cancelled (released)
  "refunded",
]);

export const payments = mysqlTable(
  "payments",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),

    // Amount
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    // Type and method
    type: paymentType.notNull(),
    method: paymentMethod.notNull(),
    status: paymentStatus.default("pending").notNull(),

    // Stripe (if online payment)
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeChargeId: varchar("stripe_charge_id", { length: 255 }),
    stripeCheckoutSessionId: varchar("stripe_checkout_session_id", {
      length: 255,
    }),
    stripeRefundId: varchar("stripe_refund_id", { length: 255 }),
    refundOfPaymentId: varchar("refund_of_payment_id", { length: 21 }),
    stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 255 }),

    // Authorization hold (empreinte)
    authorizationExpiresAt: timestamp("authorization_expires_at", {
      mode: "date",
    }),
    capturedAmount: decimal("captured_amount", { precision: 10, scale: 2 }),

    // Currency (for multi-currency support)
    currency: varchar("currency", { length: 3 }).default("EUR"),

    // Notes
    notes: text("notes"),

    // Metadata
    paidAt: timestamp("paid_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index("payments_reservation_idx").on(table.reservationId),
    stripeCheckoutSessionUnique: unique("payments_reservation_checkout_session_unique").on(
      table.reservationId,
      table.stripeCheckoutSessionId,
    ),
    refundOfPaymentIdx: index("payments_refund_of_payment_idx").on(table.refundOfPaymentId),
  }),
);

export const documentType = mysqlEnum("document_type", ["contract", "invoice"]);

// ============================================================================
// Reservation Activity Log (Audit Trail)
// ============================================================================

export const activityType = mysqlEnum("activity_type", [
  "created",
  "confirmed",
  "rejected",
  "cancelled",
  "picked_up",
  "returned",
  "note_updated",
  "payment_added",
  "payment_updated",
  "payment_received", // Online payment received via Stripe
  "payment_initiated", // Customer started online payment (checkout session created)
  "payment_failed", // Online payment failed
  "payment_expired", // Checkout session expired (customer didn't complete payment)
  "deposit_authorized", // Authorization hold created
  "deposit_captured", // Deposit captured (damage/loss)
  "deposit_released", // Authorization released
  "deposit_failed", // Authorization failed
  "access_link_sent", // Instant access link sent to customer
  "modified", // Reservation modified (dates, items, prices)
  // Inspection events
  "inspection_departure_started", // Departure inspection initiated
  "inspection_departure_completed", // Departure inspection completed
  "inspection_return_started", // Return inspection initiated
  "inspection_return_completed", // Return inspection completed
  "inspection_damage_detected", // Damage found during inspection
  "inspection_signed", // Customer signed the inspection
  "quote_accepted", // Customer accepted a quote
  "quote_declined", // Customer declined a quote
]);

export const reservationActivity = mysqlTable(
  "reservation_activity",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    userId: varchar("user_id", { length: 21 }), // null for system actions or customer actions
    activityType: activityType.notNull(),

    // Additional context
    description: text("description"), // e.g., rejection reason
    metadata: json("metadata").$type<Record<string, unknown>>(), // For additional structured data

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index("reservation_activity_reservation_idx").on(table.reservationId),
    userIdx: index("reservation_activity_user_idx").on(table.userId),
  }),
);

export const documents = mysqlTable("documents", {
  id: id(),
  // Received supplier invoices are not tied to a Louez reservation.
  reservationId: varchar("reservation_id", { length: 21 }),

  type: documentType.notNull(),
  number: varchar("number", { length: 50 }).notNull(),

  // File (longtext to support base64-encoded PDFs with embedded images)
  fileUrl: longtext("file_url").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  cgvSnapshot: longtext("cgv_snapshot"),

  // Metadata
  generatedAt: timestamp("generated_at", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// Global account-departure totals. Deliberately stores no user, Store,
// free-text answer, or timestamp so a response cannot be linked back to a
// deleted account.
export const accountDepartureReason = mysqlEnum("account_departure_reason", [
  "too_expensive",
  "missing_features",
  "difficult_to_use",
  "no_longer_needed",
  "switched_service",
  "technical_issues",
  "privacy_concerns",
  "other",
]);

export const accountDepartureReasonCounters = mysqlTable("account_departure_reason_counters", {
  reason: accountDepartureReason.primaryKey(),
  count: int("count", { unsigned: true }).default(0).notNull(),
});

// Restricted accounting archive used only for Louez's own billing records.
// Merchant-issued and supplier invoices are deleted with the Store. The
// original user and Store IDs are absent from this encrypted snapshot.
export const legalRetentionRecords = mysqlTable(
  "legal_retention_records",
  {
    id: id(),
    retentionGroupId: varchar("retention_group_id", { length: 21 }).notNull(),
    sourceType: mysqlEnum("legal_retention_source_type", ["platform_invoice"]).notNull(),
    sourceRecordHash: varchar("source_record_hash", { length: 64 }).notNull(),
    documentNumber: varchar("document_number", { length: 255 }),
    issuedAt: date("issued_at", { mode: "string" }).notNull(),
    retainUntil: date("retain_until", { mode: "string" }).notNull(),
    legalBasis: varchar("legal_basis", { length: 100 })
      .notNull()
      .default("fr_code_commerce_l123_22"),
    encryptedPayload: longtext("encrypted_payload").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    retentionGroupIdx: index("legal_retention_group_idx").on(table.retentionGroupId),
    retainUntilIdx: index("legal_retention_until_idx").on(table.retainUntil),
    sourceUnique: unique("legal_retention_source_unique").on(
      table.sourceType,
      table.sourceRecordHash,
    ),
  }),
);

// ============================================================================
// Electronic Invoicing
// ============================================================================

export const invoiceSequences = mysqlTable(
  "invoice_sequences",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    series: mysqlEnum("series", ["invoice", "credit_note"]).notNull(),
    year: int("year").notNull(),
    nextNumber: int("next_number").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeSeriesYearUnique: unique("invoice_sequences_store_series_year_unique").on(
      table.storeId,
      table.series,
      table.year,
    ),
    storeIdx: index("invoice_sequences_store_idx").on(table.storeId),
  }),
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    customerId: varchar("customer_id", { length: 21 }).notNull(),
    type: mysqlEnum("type", ["invoice", "credit_note"]).notNull(),
    kind: mysqlEnum("kind", ["initial", "complementary", "credit_note"]).notNull(),
    number: varchar("number", { length: 50 }).notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    sellerSnapshot: json("seller_snapshot").$type<InvoiceSellerSnapshot>().notNull(),
    buyerSnapshot: json("buyer_snapshot").$type<InvoiceBuyerSnapshot>().notNull(),
    lines: json("lines").$type<InvoiceLineSnapshot[]>().notNull(),
    vatBreakdown: json("vat_breakdown").$type<InvoiceVatBreakdownSnapshot[]>().notNull(),
    totalExclTax: decimal("total_excl_tax", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalTax: decimal("total_tax", { precision: 10, scale: 2 }).notNull(),
    totalInclTax: decimal("total_incl_tax", {
      precision: 10,
      scale: 2,
    }).notNull(),
    en16931Snapshot: json("en16931_snapshot").$type<En16931InvoiceSnapshot>().notNull(),
    documentId: varchar("document_id", { length: 21 }).notNull(),
    precedingInvoiceId: varchar("preceding_invoice_id", { length: 21 }),
    processingRule: mysqlEnum("processing_rule", ["b2b", "b2c"]).notNull(),
    transmissionStatus: mysqlEnum("transmission_status", [
      "not_applicable",
      "pending",
      "sent",
      "validated",
      "rejected",
      "failed",
    ])
      .default("not_applicable")
      .notNull(),
    superPdpInvoiceId: varchar("super_pdp_invoice_id", { length: 255 }),
    attemptCount: int("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }),
    lastError: text("last_error"),
    latestSuperPdpStatus: varchar("latest_super_pdp_status", { length: 32 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeNumberUnique: unique("invoices_store_number_unique").on(table.storeId, table.number),
    documentUnique: unique("invoices_document_unique").on(table.documentId),
    superPdpInvoiceUnique: unique("invoices_super_pdp_invoice_unique").on(table.superPdpInvoiceId),
    storeIdx: index("invoices_store_idx").on(table.storeId),
    reservationIdx: index("invoices_reservation_idx").on(table.reservationId),
    customerIdx: index("invoices_customer_idx").on(table.customerId),
    precedingInvoiceIdx: index("invoices_preceding_invoice_idx").on(table.precedingInvoiceId),
    transmissionIdx: index("invoices_transmission_idx").on(
      table.transmissionStatus,
      table.nextAttemptAt,
    ),
  }),
);

export const invoicePayments = mysqlTable(
  "invoice_payments",
  {
    id: id(),
    invoiceId: varchar("invoice_id", { length: 21 }).notNull(),
    paymentId: varchar("payment_id", { length: 21 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    invoicePaymentUnique: unique("invoice_payments_invoice_payment_unique").on(
      table.invoiceId,
      table.paymentId,
    ),
    invoiceIdx: index("invoice_payments_invoice_idx").on(table.invoiceId),
    paymentIdx: index("invoice_payments_payment_idx").on(table.paymentId),
  }),
);

export const receivedInvoices = mysqlTable(
  "received_invoices",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    superPdpInvoiceId: varchar("super_pdp_invoice_id", {
      length: 255,
    }).notNull(),
    sellerName: varchar("seller_name", { length: 255 }).notNull(),
    sellerIdentifier: varchar("seller_identifier", { length: 80 }).notNull(),
    number: varchar("number", { length: 50 }).notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    totalExclTax: decimal("total_excl_tax", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalTax: decimal("total_tax", { precision: 10, scale: 2 }).notNull(),
    totalInclTax: decimal("total_incl_tax", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    latestStatus: varchar("latest_status", { length: 32 }),
    ourAction: mysqlEnum("our_action", ["none", "acknowledged", "accepted", "refused"])
      .default("none")
      .notNull(),
    documentId: varchar("document_id", { length: 21 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeInvoiceUnique: unique("received_invoices_store_super_pdp_invoice_unique").on(
      table.storeId,
      table.superPdpInvoiceId,
    ),
    storeIdx: index("received_invoices_store_idx").on(table.storeId),
    issueDateIdx: index("received_invoices_issue_date_idx").on(table.issueDate),
    documentIdx: index("received_invoices_document_idx").on(table.documentId),
  }),
);

export const emailLogs = mysqlTable("email_logs", {
  id: id(),
  storeId: varchar("store_id", { length: 21 }).notNull(),
  reservationId: varchar("reservation_id", { length: 21 }),
  customerId: varchar("customer_id", { length: 21 }),

  // Email
  to: varchar("to", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  templateType: varchar("template_type", { length: 50 }).notNull(),

  // Result
  messageId: varchar("message_id", { length: 255 }),
  status: varchar("status", { length: 20 }).default("sent"),
  error: text("error"),

  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
});

export const smsLogs = mysqlTable("sms_logs", {
  id: id(),
  storeId: varchar("store_id", { length: 21 }).notNull(),
  reservationId: varchar("reservation_id", { length: 21 }),
  customerId: varchar("customer_id", { length: 21 }),

  // SMS
  to: varchar("to", { length: 50 }).notNull(),
  message: text("message").notNull(),
  templateType: varchar("template_type", { length: 50 }).notNull(),

  // Result
  messageId: varchar("message_id", { length: 255 }),
  status: varchar("status", { length: 20 }).default("sent"),
  error: text("error"),

  // Credit source tracking
  creditSource: varchar("credit_source", { length: 20 }).default("plan"), // 'plan' or 'topup'

  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
});

// ============================================================================
// Discord Logs (Admin notification logs)
// ============================================================================

export const discordLogs = mysqlTable("discord_logs", {
  id: id(),
  storeId: varchar("store_id", { length: 21 }).notNull(),
  reservationId: varchar("reservation_id", { length: 21 }),

  // Notification details
  eventType: varchar("event_type", { length: 50 }).notNull(),

  // Result
  status: varchar("status", { length: 20 }).default("sent").notNull(),
  error: text("error"),

  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
});

// ============================================================================
// SMS Credits (Prepaid SMS Balance)
// ============================================================================

export const smsCredits = mysqlTable(
  "sms_credits",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull().unique(),

    // Balance tracking
    balance: int("balance").notNull().default(0), // Current available credits
    totalPurchased: int("total_purchased").notNull().default(0), // Lifetime total purchased
    totalUsed: int("total_used").notNull().default(0), // Lifetime total used from prepaid

    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("sms_credits_store_idx").on(table.storeId),
  }),
);

export const smsTopupStatus = mysqlEnum("sms_topup_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

export const smsTopupTransactions = mysqlTable(
  "sms_topup_transactions",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),

    // Purchase details
    quantity: int("quantity").notNull(), // Number of SMS purchased
    unitPriceCents: int("unit_price_cents").notNull(), // Price per SMS in cents (15 or 7)
    totalAmountCents: int("total_amount_cents").notNull(), // Total amount in cents
    currency: varchar("currency", { length: 3 }).notNull().default("eur"),

    // Stripe references
    stripeSessionId: varchar("stripe_session_id", { length: 255 }),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),

    // Status
    status: smsTopupStatus.default("pending").notNull(),

    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => ({
    storeIdx: index("sms_topup_store_idx").on(table.storeId),
    statusIdx: index("sms_topup_status_idx").on(table.status),
    stripeSessionIdx: index("sms_topup_stripe_session_idx").on(table.stripeSessionId),
  }),
);

// ============================================================================
// Review Booster Tables
// ============================================================================

export const reviewRequestChannel = mysqlEnum("review_request_channel", ["email", "sms"]);

export const reviewRequestLogs = mysqlTable(
  "review_request_logs",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    customerId: varchar("customer_id", { length: 21 }).notNull(),
    channel: reviewRequestChannel.notNull(),
    sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index("review_request_logs_reservation_idx").on(table.reservationId),
    storeIdx: index("review_request_logs_store_idx").on(table.storeId),
  }),
);

// ============================================================================
// Reminder Logs (Automatic pickup/return reminders)
// ============================================================================

export const reminderType = mysqlEnum("reminder_type", ["pickup", "return"]);
export const reminderChannel = mysqlEnum("reminder_channel", ["email", "sms", "discord"]);
// Who the reminder is for: the customer or the store admin/owner.
export const reminderAudience = mysqlEnum("reminder_audience", ["customer", "admin"]);

export const reminderLogs = mysqlTable(
  "reminder_logs",
  {
    id: id(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    customerId: varchar("customer_id", { length: 21 }).notNull(),
    type: reminderType.notNull(),
    channel: reminderChannel.notNull(),
    // Partitions customer vs. admin reminders so they dedupe independently.
    audience: reminderAudience.notNull().default("customer"),
    sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationIdx: index("reminder_logs_reservation_idx").on(table.reservationId),
    storeIdx: index("reminder_logs_store_idx").on(table.storeId),
    // Prevent duplicate reminders (per audience, so an admin email and a
    // customer email for the same reservation/type don't collide).
    uniqueReminder: unique("reminder_logs_unique").on(
      table.reservationId,
      table.type,
      table.channel,
      table.audience,
    ),
  }),
);

// Tracks the once-a-day admin reminder digest so it is sent at most once per
// store per day per channel (the cron runs every minute).
export const adminDigestLogs = mysqlTable(
  "admin_digest_logs",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    // Store-local calendar day the digest covers, as 'YYYY-MM-DD'.
    digestDate: varchar("digest_date", { length: 10 }).notNull(),
    channel: reminderChannel.notNull(),
    sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("admin_digest_logs_store_idx").on(table.storeId),
    uniqueDigest: unique("admin_digest_logs_unique").on(
      table.storeId,
      table.digestDate,
      table.channel,
    ),
  }),
);

export const googlePlacesCache = mysqlTable(
  "google_places_cache",
  {
    id: id(),
    placeId: varchar("place_id", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    address: text("address"),
    rating: decimal("rating", { precision: 2, scale: 1 }),
    reviewCount: int("review_count"),
    reviews: json("reviews").$type<GoogleReview[]>(),
    mapsUrl: text("maps_url"),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  },
  (table) => ({
    placeIdIdx: index("google_places_cache_place_id_idx").on(table.placeId),
    expiresAtIdx: index("google_places_cache_expires_at_idx").on(table.expiresAt),
  }),
);

// ============================================================================
// Payment Requests
// ============================================================================

export const paymentRequests = mysqlTable(
  "payment_requests",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    description: varchar("description", { length: 255 }).notNull(),
    type: mysqlEnum("type", ["rental", "custom"]).notNull(),
    status: mysqlEnum("status", ["pending", "completed", "cancelled"]).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("payment_requests_store_idx").on(table.storeId),
    reservationIdx: index("payment_requests_reservation_idx").on(table.reservationId),
    tokenIdx: index("payment_requests_token_idx").on(table.token),
  }),
);

// ============================================================================
// Promo Codes
// ============================================================================

export const promoCodeType = mysqlEnum("promo_code_type", ["percentage", "fixed"]);

export const promoCodes = mysqlTable(
  "promo_codes",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    description: text("description"),
    type: promoCodeType.notNull(),
    value: decimal("value", { precision: 10, scale: 2 }).notNull(),
    minimumAmount: decimal("minimum_amount", { precision: 10, scale: 2 }),
    maxUsageCount: int("max_usage_count"),
    currentUsageCount: int("current_usage_count").notNull().default(0),
    startsAt: timestamp("starts_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("promo_codes_store_idx").on(table.storeId),
    uniqueCodePerStore: unique("promo_codes_unique_code").on(table.storeId, table.code),
    activeIdx: index("promo_codes_active_idx").on(table.storeId, table.isActive),
  }),
);

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  ownedStores: many(stores),
  memberships: many(storeMembers),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  store: one(stores, {
    fields: [subscriptions.storeId],
    references: [stores.id],
  }),
}));

export const platformFeesRelations = relations(platformFees, ({ one }) => ({
  store: one(stores, {
    fields: [platformFees.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [platformFees.reservationId],
    references: [reservations.id],
  }),
  invoice: one(payAsYouGoInvoices, {
    fields: [platformFees.invoiceId],
    references: [payAsYouGoInvoices.id],
  }),
}));

export const payAsYouGoInvoicesRelations = relations(payAsYouGoInvoices, ({ one, many }) => ({
  store: one(stores, {
    fields: [payAsYouGoInvoices.storeId],
    references: [stores.id],
  }),
  fees: many(platformFees),
}));

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
    relationName: "addedByUser",
  }),
}));

export const storeInvitationsRelations = relations(storeInvitations, ({ one }) => ({
  store: one(stores, {
    fields: [storeInvitations.storeId],
    references: [stores.id],
  }),
  invitedByUser: one(users, {
    fields: [storeInvitations.invitedBy],
    references: [users.id],
  }),
}));

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
    relationName: "referrals",
  }),
  referrals: many(stores, {
    relationName: "referrals",
  }),
  categories: many(categories),
  products: many(products),
  locations: many(storeLocations),
  integrations: many(storeIntegrations),
  marketplaceChannel: one(storeMarketplaceChannels, {
    fields: [stores.id],
    references: [storeMarketplaceChannels.storeId],
  }),
  marketplaceCategoryMappings: many(storeMarketplaceCategoryMappings),
  legalProfile: one(storeLegalProfiles, {
    fields: [stores.id],
    references: [storeLegalProfiles.storeId],
  }),
  invoiceSequences: many(invoiceSequences),
  invoices: many(invoices),
  receivedInvoices: many(receivedInvoices),
  customers: many(customers),
  reservations: many(reservations),
  marketplaceBookingAttempts: many(marketplaceBookingAttempts),
  promoCodes: many(promoCodes),
  emailLogs: many(emailLogs),
  smsLogs: many(smsLogs),
}));

export const storeIntegrationsRelations = relations(storeIntegrations, ({ one, many }) => ({
  store: one(stores, {
    fields: [storeIntegrations.storeId],
    references: [stores.id],
  }),
  connectedByUser: one(users, {
    fields: [storeIntegrations.connectedByUserId],
    references: [users.id],
  }),
  credentials: one(integrationCredentials, {
    fields: [storeIntegrations.id],
    references: [integrationCredentials.integrationId],
  }),
  calendarSettings: one(storeCalendarIntegrations, {
    fields: [storeIntegrations.id],
    references: [storeCalendarIntegrations.integrationId],
  }),
  tulipSettings: one(storeTulipIntegrations, {
    fields: [storeIntegrations.id],
    references: [storeTulipIntegrations.integrationId],
  }),
  superPdpSettings: one(storeSuperPdpIntegrations, {
    fields: [storeIntegrations.id],
    references: [storeSuperPdpIntegrations.integrationId],
  }),
  calendarEvents: many(reservationCalendarEvents),
}));

export const storeLegalProfilesRelations = relations(storeLegalProfiles, ({ one }) => ({
  store: one(stores, {
    fields: [storeLegalProfiles.storeId],
    references: [stores.id],
  }),
}));

export const integrationCredentialsRelations = relations(integrationCredentials, ({ one }) => ({
  integration: one(storeIntegrations, {
    fields: [integrationCredentials.integrationId],
    references: [storeIntegrations.id],
  }),
}));

export const storeCalendarIntegrationsRelations = relations(
  storeCalendarIntegrations,
  ({ one }) => ({
    integration: one(storeIntegrations, {
      fields: [storeCalendarIntegrations.integrationId],
      references: [storeIntegrations.id],
    }),
  }),
);

export const storeTulipIntegrationsRelations = relations(storeTulipIntegrations, ({ one }) => ({
  integration: one(storeIntegrations, {
    fields: [storeTulipIntegrations.integrationId],
    references: [storeIntegrations.id],
  }),
}));

export const storeMarketplaceChannelsRelations = relations(storeMarketplaceChannels, ({ one }) => ({
  store: one(stores, {
    fields: [storeMarketplaceChannels.storeId],
    references: [stores.id],
  }),
}));

export const storeMarketplaceCategoryMappingsRelations = relations(
  storeMarketplaceCategoryMappings,
  ({ one }) => ({
    store: one(stores, {
      fields: [storeMarketplaceCategoryMappings.storeId],
      references: [stores.id],
    }),
    category: one(categories, {
      fields: [storeMarketplaceCategoryMappings.categoryId],
      references: [categories.id],
    }),
  }),
);

export const storeSuperPdpIntegrationsRelations = relations(
  storeSuperPdpIntegrations,
  ({ one }) => ({
    integration: one(storeIntegrations, {
      fields: [storeSuperPdpIntegrations.integrationId],
      references: [storeIntegrations.id],
    }),
  }),
);

export const storeLocationsRelations = relations(storeLocations, ({ one }) => ({
  store: one(stores, {
    fields: [storeLocations.storeId],
    references: [stores.id],
  }),
}));

export const promoCodesRelations = relations(promoCodes, ({ one }) => ({
  store: one(stores, {
    fields: [promoCodes.storeId],
    references: [stores.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  store: one(stores, {
    fields: [categories.storeId],
    references: [stores.id],
  }),
  products: many(products),
  productLinks: many(productCategories),
  marketplaceMappings: many(storeMarketplaceCategoryMappings),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, {
    fields: [products.storeId],
    references: [stores.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  categoryLinks: many(productCategories),
  reservationItems: many(reservationItems),
  pricingTiers: many(productPricingTiers),
  seasonalPricings: many(productSeasonalPricing),
  units: many(productUnits),
  accessories: many(productAccessories, { relationName: "productAccessories" }),
  accessoryOf: many(productAccessories, { relationName: "accessoryOf" }),
  tulipMapping: one(productsTulip, {
    fields: [products.id],
    references: [productsTulip.productId],
  }),
}));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, {
    fields: [productCategories.productId],
    references: [products.id],
  }),
  category: one(categories, {
    fields: [productCategories.categoryId],
    references: [categories.id],
  }),
}));

export const variantDefinitionsRelations = relations(variantDefinitions, ({ one, many }) => ({
  store: one(stores, {
    fields: [variantDefinitions.storeId],
    references: [stores.id],
  }),
  values: many(variantValues),
}));

export const variantValuesRelations = relations(variantValues, ({ one }) => ({
  definition: one(variantDefinitions, {
    fields: [variantValues.definitionId],
    references: [variantDefinitions.id],
  }),
}));

export const productsTulipRelations = relations(productsTulip, ({ one }) => ({
  product: one(products, {
    fields: [productsTulip.productId],
    references: [products.id],
  }),
}));

export const productPricingTiersRelations = relations(productPricingTiers, ({ one }) => ({
  product: one(products, {
    fields: [productPricingTiers.productId],
    references: [products.id],
  }),
}));

export const productSeasonalPricingRelations = relations(
  productSeasonalPricing,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productSeasonalPricing.productId],
      references: [products.id],
    }),
    tiers: many(productSeasonalPricingTiers),
  }),
);

export const productSeasonalPricingTiersRelations = relations(
  productSeasonalPricingTiers,
  ({ one }) => ({
    seasonalPricing: one(productSeasonalPricing, {
      fields: [productSeasonalPricingTiers.seasonalPricingId],
      references: [productSeasonalPricing.id],
    }),
  }),
);

// ============================================================================
// Product Units (Individual Unit Tracking)
// ============================================================================

export const unitLifecycleStatus = mysqlEnum("lifecycle_status", ["active", "retired"]);

export const unitRetirementReason = mysqlEnum("retirement_reason", [
  "sold",
  "lost",
  "broken",
  "other",
]);

export const unitDowntimeReason = mysqlEnum("reason", ["maintenance", "repair", "other"]);

export const unitEventType = mysqlEnum("type", [
  "created",
  "deleted",
  "downtime_declared",
  "downtime_updated",
  "downtime_closed",
  "downtime_deleted",
  "retired",
  "reinstated",
  "assigned",
  "unassigned",
  "updated",
]);

export const productUnits = mysqlTable(
  "product_units",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 }).notNull(),

    // User-defined identifier (serial number, asset tag, etc.)
    identifier: varchar("identifier", { length: 255 }).notNull(),

    // Optional internal notes (e.g., "Blue frame", "New battery 2025")
    notes: text("notes"),

    // Unit-specific photos (URLs), shown alongside the product images
    images: json("images").$type<string[]>().default([]),

    // Flexible attributes for the unit (size/color/etc)
    attributes: json("attributes").$type<UnitAttributes>(),

    // Canonical key derived from product booking axes + unit attributes
    // "__default" is used when no booking axes are configured
    combinationKey: varchar("combination_key", { length: 255 }).notNull().default("__default"),

    // Unit lifecycle status
    // Note: downtime and rental state are derived from dedicated records.
    lifecycleStatus: unitLifecycleStatus.default("active").notNull(),
    retiredAt: timestamp("retired_at", { mode: "date" }),
    retirementReason: unitRetirementReason,
    retirementNote: text("retirement_note"),
    purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }),
    purchasedAt: timestamp("purchased_at", { mode: "date" }),

    // Metadata
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("product_units_product_idx").on(table.productId),
    // Enforce unique identifier per product (same identifier can exist on different products)
    uniqueIdentifierPerProduct: unique("product_units_unique_identifier").on(
      table.productId,
      table.identifier,
    ),
    // For quick lookups of active units
    lifecycleStatusIdx: index("product_units_lifecycle_status_idx").on(
      table.productId,
      table.lifecycleStatus,
    ),
    lifecycleStatusCombinationIdx: index("product_units_lifecycle_status_combination_idx").on(
      table.productId,
      table.lifecycleStatus,
      table.combinationKey,
    ),
  }),
);

export const productUnitDowntimes = mysqlTable(
  "product_unit_downtimes",
  {
    id: id(),
    productUnitId: varchar("product_unit_id", { length: 21 })
      .notNull()
      .references(() => productUnits.id, { onDelete: "cascade" }),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    reason: unitDowntimeReason.notNull(),
    startsAt: timestamp("starts_at", { mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "date" }),
    note: text("note"),
    createdByUserId: varchar("created_by_user_id", { length: 21 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    unitStartsAtIdx: index("product_unit_downtimes_unit_starts_at_idx").on(
      table.productUnitId,
      table.startsAt,
    ),
    storeIdx: index("product_unit_downtimes_store_idx").on(table.storeId),
    activeAtIdx: index("product_unit_downtimes_active_at_idx").on(
      table.storeId,
      table.startsAt,
      table.endsAt,
    ),
  }),
);

export const productUnitDowntimesRelations = relations(productUnitDowntimes, ({ one }) => ({
  unit: one(productUnits, {
    fields: [productUnitDowntimes.productUnitId],
    references: [productUnits.id],
  }),
}));

export const productUnitEvents = mysqlTable(
  "product_unit_events",
  {
    id: id(),
    productUnitId: varchar("product_unit_id", { length: 21 }).references(() => productUnits.id, {
      onDelete: "set null",
    }),
    identifierSnapshot: varchar("identifier_snapshot", { length: 255 }),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    type: unitEventType.notNull(),
    actorUserId: varchar("actor_user_id", { length: 21 }),
    payload: json("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    unitCreatedAtIdx: index("product_unit_events_unit_created_at_idx").on(
      table.productUnitId,
      table.createdAt,
    ),
  }),
);

export const productUnitEventsRelations = relations(productUnitEvents, ({ one }) => ({
  unit: one(productUnits, {
    fields: [productUnitEvents.productUnitId],
    references: [productUnits.id],
  }),
}));

export const productUnitsRelations = relations(productUnits, ({ one, many }) => ({
  product: one(products, {
    fields: [productUnits.productId],
    references: [products.id],
  }),
  downtimes: many(productUnitDowntimes),
  events: many(productUnitEvents),
  reservationAssignments: many(reservationItemUnits),
}));

// ============================================================================
// Reservation Item Units (Unit Assignment to Reservations)
// ============================================================================

export const reservationItemUnits = mysqlTable(
  "reservation_item_units",
  {
    id: id(),
    reservationItemId: varchar("reservation_item_id", {
      length: 21,
    }).notNull(),
    productUnitId: varchar("product_unit_id", { length: 21 }),

    // Snapshot of identifier at assignment time (for contract/history accuracy
    // even if the unit is renamed later)
    identifierSnapshot: varchar("identifier_snapshot", {
      length: 255,
    }).notNull(),

    // When the unit was assigned
    assignedAt: timestamp("assigned_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    reservationItemIdx: index("reservation_item_units_item_idx").on(table.reservationItemId),
    productUnitIdx: index("reservation_item_units_unit_idx").on(table.productUnitId),
    // Prevent assigning the same unit twice to the same reservation item
    uniqueAssignment: unique("reservation_item_units_unique").on(
      table.reservationItemId,
      table.productUnitId,
    ),
    reservationItemFk: foreignKey({
      name: "riu_reservation_item_fk",
      columns: [table.reservationItemId],
      foreignColumns: [reservationItems.id],
    }).onDelete("cascade"),
    productUnitFk: foreignKey({
      name: "riu_product_unit_fk",
      columns: [table.productUnitId],
      foreignColumns: [productUnits.id],
    }).onDelete("set null"),
  }),
);

export const reservationItemUnitsRelations = relations(reservationItemUnits, ({ one }) => ({
  reservationItem: one(reservationItems, {
    fields: [reservationItemUnits.reservationItemId],
    references: [reservationItems.id],
  }),
  productUnit: one(productUnits, {
    fields: [reservationItemUnits.productUnitId],
    references: [productUnits.id],
  }),
}));

// ============================================================================
// Product Accessories (Upsell/Cross-sell)
// ============================================================================

export const productAccessories = mysqlTable(
  "product_accessories",
  {
    id: id(),
    productId: varchar("product_id", { length: 21 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    accessoryId: varchar("accessory_id", { length: 21 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    required: boolean("required").notNull().default(false),
    quantity: int("quantity").notNull().default(1),
    displayOrder: int("display_order").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    productIdx: index("product_accessories_product_idx").on(table.productId),
    accessoryIdx: index("product_accessories_accessory_idx").on(table.accessoryId),
    uniqueProductAccessory: unique("product_accessories_unique").on(
      table.productId,
      table.accessoryId,
    ),
  }),
);

export const productAccessoriesRelations = relations(productAccessories, ({ one }) => ({
  product: one(products, {
    fields: [productAccessories.productId],
    references: [products.id],
    relationName: "productAccessories",
  }),
  accessory: one(products, {
    fields: [productAccessories.accessoryId],
    references: [products.id],
    relationName: "accessoryOf",
  }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  store: one(stores, {
    fields: [customers.storeId],
    references: [stores.id],
  }),
  reservations: many(reservations),
  invoices: many(invoices),
  sessions: many(customerSessions),
}));

export const customerSessionsRelations = relations(customerSessions, ({ one }) => ({
  customer: one(customers, {
    fields: [customerSessions.customerId],
    references: [customers.id],
  }),
}));

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  store: one(stores, {
    fields: [reservations.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [reservations.customerId],
    references: [customers.id],
  }),
  marketplaceBookingAttempt: one(marketplaceBookingAttempts, {
    fields: [reservations.id],
    references: [marketplaceBookingAttempts.reservationId],
  }),
  promoCode: one(promoCodes, {
    fields: [reservations.promoCodeId],
    references: [promoCodes.id],
  }),
  items: many(reservationItems),
  payments: many(payments),
  documents: many(documents),
  activity: many(reservationActivity),
  calendarEvents: many(reservationCalendarEvents),
  invoices: many(invoices),
}));

export const marketplaceBookingAttemptsRelations = relations(
  marketplaceBookingAttempts,
  ({ one }) => ({
    store: one(stores, {
      fields: [marketplaceBookingAttempts.storeId],
      references: [stores.id],
    }),
    reservation: one(reservations, {
      fields: [marketplaceBookingAttempts.reservationId],
      references: [reservations.id],
    }),
  }),
);

export const reservationCalendarEventsRelations = relations(
  reservationCalendarEvents,
  ({ one }) => ({
    reservation: one(reservations, {
      fields: [reservationCalendarEvents.reservationId],
      references: [reservations.id],
    }),
    integration: one(storeIntegrations, {
      fields: [reservationCalendarEvents.integrationId],
      references: [storeIntegrations.id],
    }),
  }),
);

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
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  reservation: one(reservations, {
    fields: [payments.reservationId],
    references: [reservations.id],
  }),
  invoiceLinks: many(invoicePayments),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  reservation: one(reservations, {
    fields: [documents.reservationId],
    references: [reservations.id],
  }),
  invoice: one(invoices, {
    fields: [documents.id],
    references: [invoices.documentId],
  }),
  receivedInvoice: one(receivedInvoices, {
    fields: [documents.id],
    references: [receivedInvoices.documentId],
  }),
}));

export const invoiceSequencesRelations = relations(invoiceSequences, ({ one }) => ({
  store: one(stores, {
    fields: [invoiceSequences.storeId],
    references: [stores.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  store: one(stores, {
    fields: [invoices.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [invoices.reservationId],
    references: [reservations.id],
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  document: one(documents, {
    fields: [invoices.documentId],
    references: [documents.id],
  }),
  precedingInvoice: one(invoices, {
    fields: [invoices.precedingInvoiceId],
    references: [invoices.id],
    relationName: "invoiceCorrections",
  }),
  corrections: many(invoices, {
    relationName: "invoiceCorrections",
  }),
  paymentLinks: many(invoicePayments),
}));

export const invoicePaymentsRelations = relations(invoicePayments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoicePayments.invoiceId],
    references: [invoices.id],
  }),
  payment: one(payments, {
    fields: [invoicePayments.paymentId],
    references: [payments.id],
  }),
}));

export const receivedInvoicesRelations = relations(receivedInvoices, ({ one }) => ({
  store: one(stores, {
    fields: [receivedInvoices.storeId],
    references: [stores.id],
  }),
  document: one(documents, {
    fields: [receivedInvoices.documentId],
    references: [documents.id],
  }),
}));

export const reservationActivityRelations = relations(reservationActivity, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationActivity.reservationId],
    references: [reservations.id],
  }),
  user: one(users, {
    fields: [reservationActivity.userId],
    references: [users.id],
  }),
}));

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
}));

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
}));

export const discordLogsRelations = relations(discordLogs, ({ one }) => ({
  store: one(stores, {
    fields: [discordLogs.storeId],
    references: [stores.id],
  }),
  reservation: one(reservations, {
    fields: [discordLogs.reservationId],
    references: [reservations.id],
  }),
}));

export const smsCreditsRelations = relations(smsCredits, ({ one }) => ({
  store: one(stores, {
    fields: [smsCredits.storeId],
    references: [stores.id],
  }),
}));

export const smsTopupTransactionsRelations = relations(smsTopupTransactions, ({ one }) => ({
  store: one(stores, {
    fields: [smsTopupTransactions.storeId],
    references: [stores.id],
  }),
}));

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
}));

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
}));

// ============================================================================
// Analytics Tables
// ============================================================================

export const pageType = mysqlEnum("page_type", [
  "home",
  "catalog",
  "product",
  "cart",
  "checkout",
  "confirmation",
  "account",
  "rental",
]);

export const deviceType = mysqlEnum("device_type", ["mobile", "tablet", "desktop"]);

export const pageViews = mysqlTable(
  "page_views",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    sessionId: varchar("session_id", { length: 36 }).notNull(), // UUID for anonymous tracking
    page: pageType.notNull(),
    productId: varchar("product_id", { length: 21 }), // If viewing a product page
    categoryId: varchar("category_id", { length: 21 }), // If filtering by category
    referrer: varchar("referrer", { length: 500 }), // Where the user came from
    device: deviceType.default("desktop"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("page_views_store_idx").on(table.storeId),
    sessionIdx: index("page_views_session_idx").on(table.sessionId),
    storeCreatedIdx: index("page_views_store_created_idx").on(table.storeId, table.createdAt),
    productIdx: index("page_views_product_idx").on(table.productId),
  }),
);

export const storefrontEventType = mysqlEnum("storefront_event_type", [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "update_quantity",
  "checkout_started",
  "checkout_completed",
  "checkout_abandoned",
  "payment_initiated",
  "payment_completed",
  "payment_failed",
  "login_requested",
  "login_completed",
]);

export const storefrontEvents = mysqlTable(
  "storefront_events",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    customerId: varchar("customer_id", { length: 21 }), // If logged in
    eventType: storefrontEventType.notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(), // productId, quantity, amount, etc.
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("storefront_events_store_idx").on(table.storeId),
    sessionIdx: index("storefront_events_session_idx").on(table.sessionId),
    storeCreatedIdx: index("storefront_events_store_created_idx").on(
      table.storeId,
      table.createdAt,
    ),
    eventTypeIdx: index("storefront_events_type_idx").on(table.eventType),
  }),
);

export const dailyStats = mysqlTable(
  "daily_stats",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    date: timestamp("date", { mode: "date" }).notNull(), // Day at 00:00:00
    pageViews: int("page_views").default(0).notNull(),
    uniqueVisitors: int("unique_visitors").default(0).notNull(),
    productViews: int("product_views").default(0).notNull(),
    cartAdditions: int("cart_additions").default(0).notNull(),
    checkoutStarted: int("checkout_started").default(0).notNull(),
    checkoutCompleted: int("checkout_completed").default(0).notNull(),
    reservationsCreated: int("reservations_created").default(0).notNull(),
    reservationsConfirmed: int("reservations_confirmed").default(0).notNull(),
    revenue: decimal("revenue", { precision: 10, scale: 2 }).default("0").notNull(),
    averageCartValue: decimal("average_cart_value", {
      precision: 10,
      scale: 2,
    }).default("0"),
    mobileVisitors: int("mobile_visitors").default(0).notNull(),
    tabletVisitors: int("tablet_visitors").default(0).notNull(),
    desktopVisitors: int("desktop_visitors").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueStoreDate: unique("daily_stats_unique_store_date").on(table.storeId, table.date),
    storeIdx: index("daily_stats_store_idx").on(table.storeId),
    dateIdx: index("daily_stats_date_idx").on(table.date),
    storeDateIdx: index("daily_stats_store_date_idx").on(table.storeId, table.date),
  }),
);

export const productStats = mysqlTable(
  "product_stats",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    productId: varchar("product_id", { length: 21 }).notNull(),
    date: timestamp("date", { mode: "date" }).notNull(),
    views: int("views").default(0).notNull(),
    cartAdditions: int("cart_additions").default(0).notNull(),
    reservations: int("reservations").default(0).notNull(),
    revenue: decimal("revenue", { precision: 10, scale: 2 }).default("0").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueProductDate: unique("product_stats_unique").on(
      table.storeId,
      table.productId,
      table.date,
    ),
    storeIdx: index("product_stats_store_idx").on(table.storeId),
    productIdx: index("product_stats_product_idx").on(table.productId),
    dateIdx: index("product_stats_date_idx").on(table.date),
  }),
);

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
}));

export const storefrontEventsRelations = relations(storefrontEvents, ({ one }) => ({
  store: one(stores, {
    fields: [storefrontEvents.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [storefrontEvents.customerId],
    references: [customers.id],
  }),
}));

export const dailyStatsRelations = relations(dailyStats, ({ one }) => ({
  store: one(stores, {
    fields: [dailyStats.storeId],
    references: [stores.id],
  }),
}));

export const productStatsRelations = relations(productStats, ({ one }) => ({
  store: one(stores, {
    fields: [productStats.storeId],
    references: [stores.id],
  }),
  product: one(products, {
    fields: [productStats.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// Inspection Tables (Etat des lieux)
// ============================================================================

/**
 * Inspection template scope determines inheritance:
 * - store: Default template for all products in the store
 * - category: Template for products in a specific category
 * - product: Template for a specific product (highest priority)
 */
export const inspectionTemplateScope = mysqlEnum("inspection_template_scope", [
  "store",
  "category",
  "product",
]);

/**
 * Field types for inspection template fields
 */
export const inspectionFieldType = mysqlEnum("inspection_field_type", [
  "checkbox", // Simple yes/no (e.g., "Brakes working")
  "rating", // 1-5 scale (e.g., "Tire condition")
  "text", // Free text notes
  "number", // Numeric value (e.g., "Operating hours: 150")
  "select", // Dropdown options (e.g., "Good/Fair/Poor")
]);

/**
 * Inspection type: departure (pickup) or return
 */
export const inspectionType = mysqlEnum("inspection_type", [
  "departure", // Check-out inspection when customer picks up
  "return", // Check-in inspection when customer returns
]);

/**
 * Inspection status workflow
 */
export const inspectionStatus = mysqlEnum("inspection_status", [
  "draft", // In progress, not yet completed
  "completed", // Inspection finished by staff
  "signed", // Customer signed the inspection
]);

/**
 * Overall condition rating for quick assessment
 */
export const conditionRating = mysqlEnum("condition_rating", [
  "excellent", // Perfect condition
  "good", // Minor wear, acceptable
  "fair", // Noticeable wear, still functional
  "damaged", // Damage detected, needs attention
]);

/**
 * Inspection templates define what points to check for products
 */
export const inspectionTemplates = mysqlTable(
  "inspection_templates",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    scope: inspectionTemplateScope.notNull(),
    categoryId: varchar("category_id", { length: 21 }), // If scope = 'category'
    productId: varchar("product_id", { length: 21 }), // If scope = 'product'
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: int("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("inspection_templates_store_idx").on(table.storeId),
    categoryIdx: index("inspection_templates_category_idx").on(table.categoryId),
    productIdx: index("inspection_templates_product_idx").on(table.productId),
    // One template per scope/target combination
    uniqueScope: unique("inspection_templates_unique_scope").on(
      table.storeId,
      table.scope,
      table.categoryId,
      table.productId,
    ),
  }),
);

/**
 * Individual inspection points within a template
 */
export const inspectionTemplateFields = mysqlTable(
  "inspection_template_fields",
  {
    id: id(),
    templateId: varchar("template_id", { length: 21 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    fieldType: inspectionFieldType.notNull(),
    options: json("options").$type<string[]>(), // For 'select' type
    ratingMin: int("rating_min").default(1), // For 'rating' type
    ratingMax: int("rating_max").default(5), // For 'rating' type
    numberUnit: varchar("number_unit", { length: 50 }), // For 'number' type (e.g., "hours", "km")
    isRequired: boolean("is_required").default(false).notNull(),
    sectionName: varchar("section_name", { length: 100 }), // Optional grouping
    displayOrder: int("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    templateIdx: index("inspection_template_fields_template_idx").on(table.templateId),
    orderIdx: index("inspection_template_fields_order_idx").on(
      table.templateId,
      table.displayOrder,
    ),
  }),
);

/**
 * Inspection records for reservations
 */
export const inspections = mysqlTable(
  "inspections",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    reservationId: varchar("reservation_id", { length: 21 }).notNull(),
    type: inspectionType.notNull(),
    status: inspectionStatus.default("draft").notNull(),
    // Template reference (snapshot stored for historical accuracy)
    templateId: varchar("template_id", { length: 21 }),
    templateSnapshot: json("template_snapshot").$type<{
      id: string;
      name: string;
      fields: Array<{
        id: string;
        name: string;
        fieldType: string;
        options?: string[];
        ratingMin?: number;
        ratingMax?: number;
        numberUnit?: string;
        isRequired: boolean;
        sectionName?: string;
      }>;
    }>(),
    // General notes
    notes: text("notes"),
    // Performed by
    performedById: varchar("performed_by_id", { length: 21 }),
    performedAt: timestamp("performed_at", { mode: "date" }),
    // Customer signature
    customerSignature: longtext("customer_signature"), // Base64 signature image
    signedAt: timestamp("signed_at", { mode: "date" }),
    signatureIp: varchar("signature_ip", { length: 50 }),
    // Damage assessment
    hasDamage: boolean("has_damage").default(false).notNull(),
    damageDescription: text("damage_description"),
    estimatedDamageCost: decimal("estimated_damage_cost", {
      precision: 10,
      scale: 2,
    }),
    damagePaymentId: varchar("damage_payment_id", { length: 21 }), // Link to payment if charged
    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("inspections_store_idx").on(table.storeId),
    reservationIdx: index("inspections_reservation_idx").on(table.reservationId),
    // One inspection per type per reservation
    uniqueTypePerReservation: unique("inspections_unique_type").on(table.reservationId, table.type),
  }),
);

/**
 * Per-item inspection within a reservation
 */
export const inspectionItems = mysqlTable(
  "inspection_items",
  {
    id: id(),
    inspectionId: varchar("inspection_id", { length: 21 }).notNull(),
    reservationItemId: varchar("reservation_item_id", { length: 21 }).notNull(),
    productUnitId: varchar("product_unit_id", { length: 21 }), // If unit tracking enabled
    // Product snapshot for historical reference
    productSnapshot: json("product_snapshot")
      .$type<{
        name: string;
        unitIdentifier?: string;
      }>()
      .notNull(),
    // Overall quick assessment
    overallCondition: conditionRating,
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    inspectionIdx: index("inspection_items_inspection_idx").on(table.inspectionId),
    reservationItemIdx: index("inspection_items_reservation_item_idx").on(table.reservationItemId),
    unitIdx: index("inspection_items_unit_idx").on(table.productUnitId),
  }),
);

/**
 * Field values recorded during inspection
 */
export const inspectionFieldValues = mysqlTable(
  "inspection_field_values",
  {
    id: id(),
    inspectionItemId: varchar("inspection_item_id", { length: 21 }).notNull(),
    templateFieldId: varchar("template_field_id", { length: 21 }).notNull(),
    // Field snapshot for historical reference
    fieldSnapshot: json("field_snapshot")
      .$type<{
        name: string;
        fieldType: string;
        sectionName?: string;
      }>()
      .notNull(),
    // Values (only one used based on type)
    checkboxValue: boolean("checkbox_value"),
    ratingValue: int("rating_value"),
    textValue: text("text_value"),
    numberValue: decimal("number_value", { precision: 15, scale: 4 }),
    selectValue: varchar("select_value", { length: 255 }),
    // Quick flag for filtering issues
    hasIssue: boolean("has_issue").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index("inspection_field_values_item_idx").on(table.inspectionItemId),
    fieldIdx: index("inspection_field_values_field_idx").on(table.templateFieldId),
    issueIdx: index("inspection_field_values_issue_idx").on(table.inspectionItemId, table.hasIssue),
  }),
);

/**
 * Photos taken during inspection
 */
export const inspectionPhotos = mysqlTable(
  "inspection_photos",
  {
    id: id(),
    inspectionItemId: varchar("inspection_item_id", { length: 21 }).notNull(),
    fieldValueId: varchar("field_value_id", { length: 21 }), // Optional link to specific field
    // R2/S3 storage keys
    photoKey: varchar("photo_key", { length: 255 }).notNull(),
    photoUrl: text("photo_url").notNull(),
    thumbnailKey: varchar("thumbnail_key", { length: 255 }),
    thumbnailUrl: text("thumbnail_url"),
    // Metadata
    caption: text("caption"),
    displayOrder: int("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index("inspection_photos_item_idx").on(table.inspectionItemId),
    fieldValueIdx: index("inspection_photos_field_value_idx").on(table.fieldValueId),
  }),
);

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
}));

export const inspectionTemplateFieldsRelations = relations(inspectionTemplateFields, ({ one }) => ({
  template: one(inspectionTemplates, {
    fields: [inspectionTemplateFields.templateId],
    references: [inspectionTemplates.id],
  }),
}));

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
}));

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
}));

export const inspectionFieldValuesRelations = relations(inspectionFieldValues, ({ one, many }) => ({
  inspectionItem: one(inspectionItems, {
    fields: [inspectionFieldValues.inspectionItemId],
    references: [inspectionItems.id],
  }),
  templateField: one(inspectionTemplateFields, {
    fields: [inspectionFieldValues.templateFieldId],
    references: [inspectionTemplateFields.id],
  }),
  photos: many(inspectionPhotos),
}));

export const inspectionPhotosRelations = relations(inspectionPhotos, ({ one }) => ({
  inspectionItem: one(inspectionItems, {
    fields: [inspectionPhotos.inspectionItemId],
    references: [inspectionItems.id],
  }),
  fieldValue: one(inspectionFieldValues, {
    fields: [inspectionPhotos.fieldValueId],
    references: [inspectionFieldValues.id],
  }),
}));

// ============================================================================
// API Keys (for MCP Server & future REST API)
// ============================================================================

export type ApiKeyPermissions = {
  reservations: "none" | "read" | "write";
  products: "none" | "read" | "write";
  customers: "none" | "read" | "write";
  categories: "none" | "read" | "write";
  payments: "none" | "read" | "write";
  analytics: "none" | "read";
  settings: "none" | "read" | "write";
};

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    userId: varchar("user_id", { length: 21 }).notNull(),

    name: varchar("name", { length: 100 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),

    permissions: json("permissions").$type<ApiKeyPermissions>().notNull(),

    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("api_keys_store_idx").on(table.storeId),
    keyHashUnique: unique("api_keys_key_hash_unique").on(table.keyHash),
    prefixIdx: index("api_keys_prefix_idx").on(table.keyPrefix),
  }),
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  store: one(stores, {
    fields: [apiKeys.storeId],
    references: [stores.id],
  }),
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// Web Push device subscriptions. One row per browser/device, owned by a user
// (a user can belong to many stores via store_members; send-time fan-out
// resolves the target devices from store membership, not from storeId here).
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: id(),
    userId: varchar("user_id", { length: 21 }).notNull(),
    // Optional hint of the store the device subscribed from (not used for routing).
    storeId: varchar("store_id", { length: 21 }),

    endpoint: text("endpoint").notNull(),
    // MySQL cannot UNIQUE a TEXT column, so dedupe on a sha-256 hex of the
    // endpoint (mirrors api_keys.key_hash).
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    userAgent: text("user_agent"),

    failureCount: int("failure_count").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    endpointUnique: unique("push_subscriptions_endpoint_unique").on(table.endpointHash),
    userIdx: index("push_subscriptions_user_idx").on(table.userId),
    storeIdx: index("push_subscriptions_store_idx").on(table.storeId),
  }),
);

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
  store: one(stores, {
    fields: [pushSubscriptions.storeId],
    references: [stores.id],
  }),
}));

// ============================================================================
// AI Chat
// ============================================================================

export const aiChats = mysqlTable(
  "ai_chats",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    userId: varchar("user_id", { length: 21 }).notNull(),
    title: varchar("title", { length: 255 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeUserIdx: index("ai_chats_store_user_idx").on(table.storeId, table.userId),
  }),
);

export const aiChatMessages = mysqlTable(
  "ai_chat_messages",
  {
    id: id(),
    chatId: varchar("chat_id", { length: 21 }).notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system", "tool"]).notNull(),
    content: longtext("content"),
    toolInvocations: json("tool_invocations").$type<unknown[]>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    chatIdx: index("ai_chat_messages_chat_idx").on(table.chatId),
  }),
);

export const aiChatsRelations = relations(aiChats, ({ one, many }) => ({
  store: one(stores, {
    fields: [aiChats.storeId],
    references: [stores.id],
  }),
  user: one(users, {
    fields: [aiChats.userId],
    references: [users.id],
  }),
  messages: many(aiChatMessages),
}));

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one }) => ({
  chat: one(aiChats, {
    fields: [aiChatMessages.chatId],
    references: [aiChats.id],
  }),
}));

// ============================================================================
// AI Advisor (storefront customer-facing assistant)
// ============================================================================

export const aiAdvisorConversations = mysqlTable(
  "ai_advisor_conversations",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    // Linked when a logged-in customer chats; set null if the customer is
    // deleted (conversation is kept, anonymized).
    customerId: varchar("customer_id", { length: 21 }),
    // Set inside the checkout transaction when the conversation converts.
    reservationId: varchar("reservation_id", { length: 21 }),

    // Set by the record_qualification tool once the advisor has verified the
    // customer's constraints against the cart.
    validatedAt: timestamp("validated_at", { mode: "date" }),
    // Cart snapshot (items, quantities, rental period) frozen at validation
    // time, server-derived. Checkout in 'required' mode rejects reservations
    // that do not match it exactly.
    validatedCart: json("validated_cart").$type<AdvisorValidatedCart>(),
    // Facts gathered by the advisor (e.g. vehicle model, licence type).
    collectedData: json("collected_data").$type<Record<string, string>>(),

    // Accrued AI-credit consumption for this conversation, in micro-credits
    // (1 credit = 1_000_000). Capped at 1 credit so a long conversation never
    // costs more than one credit. Only used when the credit layer is enabled.
    accruedCreditsMicro: bigint("accrued_credits_micro", { mode: "number" }).notNull().default(0),

    locale: varchar("locale", { length: 10 }),

    // Channel the conversation happened on. 'web' = storefront chat widget,
    // 'phone' = inbound AI receptionist call. Defaults to 'web' so every
    // existing row keeps its meaning after the migration.
    channel: mysqlEnum("channel", ["web", "phone"]).notNull().default("web"),
    // Phone-only metadata (null for web conversations).
    callerPhone: varchar("caller_phone", { length: 32 }),
    providerCallId: varchar("provider_call_id", { length: 64 }),
    durationSeconds: int("duration_seconds"),
    // Call recording (opt-in per store). Only the provider recording id is
    // stored, never a URL — playback is proxied through the app with the
    // provider credentials, so no recording is ever publicly reachable.
    recordingSid: varchar("recording_sid", { length: 64 }),
    recordingDurationSeconds: int("recording_duration_seconds"),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeCreatedIdx: index("ai_advisor_conversations_store_created_idx").on(
      table.storeId,
      table.createdAt,
    ),
    customerIdx: index("ai_advisor_conversations_customer_idx").on(table.customerId),
    // Phone status-callback lookup: resolve a call by its provider id.
    providerCallIdx: index("ai_advisor_conversations_provider_call_idx").on(table.providerCallId),
    // One conversation per reservation (MySQL allows multiple NULLs).
    reservationUnique: unique("ai_advisor_conversations_reservation_unique").on(
      table.reservationId,
    ),
  }),
);

export const aiAdvisorMessages = mysqlTable(
  "ai_advisor_messages",
  {
    id: id(),
    conversationId: varchar("conversation_id", { length: 21 }).notNull(),
    // Denormalized from the conversation so per-store rate limiting is a
    // single indexed count on the hot path (no join per chat request).
    storeId: varchar("store_id", { length: 21 }).notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system", "tool"]).notNull(),
    content: longtext("content"),
    toolInvocations: json("tool_invocations").$type<unknown[]>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("ai_advisor_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    storeCreatedIdx: index("ai_advisor_messages_store_created_idx").on(
      table.storeId,
      table.createdAt,
    ),
  }),
);

export const aiAdvisorConversationsRelations = relations(
  aiAdvisorConversations,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [aiAdvisorConversations.storeId],
      references: [stores.id],
    }),
    customer: one(customers, {
      fields: [aiAdvisorConversations.customerId],
      references: [customers.id],
    }),
    reservation: one(reservations, {
      fields: [aiAdvisorConversations.reservationId],
      references: [reservations.id],
    }),
    messages: many(aiAdvisorMessages),
  }),
);

export const aiAdvisorMessagesRelations = relations(aiAdvisorMessages, ({ one }) => ({
  conversation: one(aiAdvisorConversations, {
    fields: [aiAdvisorMessages.conversationId],
    references: [aiAdvisorConversations.id],
  }),
}));

// ============================================================================
// AI advisor credits — prepaid balance + priced consumption ledger
// Micro-credit unit: 1 credit = 1_000_000 micro-credits (integer, no float drift).
// ============================================================================

/**
 * Prepaid AI-credit balance per store (never-resetting). Mirrors `sms_credits`.
 * The monthly INCLUDED allowance (per plan) is separate and DERIVED from the
 * debit ledger, not stored here. Off-session auto-top-up config lives here too.
 */
export const aiCredits = mysqlTable(
  "ai_credits",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull().unique(),

    balanceMicro: bigint("balance_micro", { mode: "number" }).notNull().default(0),
    totalGrantedMicro: bigint("total_granted_micro", { mode: "number" }).notNull().default(0),
    totalPurchasedMicro: bigint("total_purchased_micro", { mode: "number" }).notNull().default(0),
    totalUsedMicro: bigint("total_used_micro", { mode: "number" }).notNull().default(0),

    // Off-session auto-top-up, configured by the merchant.
    autoTopupEnabled: boolean("auto_topup_enabled").notNull().default(false),
    autoTopupThresholdMicro: bigint("auto_topup_threshold_micro", {
      mode: "number",
    }),
    autoTopupCredits: int("auto_topup_credits"),
    autoTopupPriceCents: int("auto_topup_price_cents"),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("ai_credits_store_idx").on(table.storeId),
  }),
);

export const aiCreditTransactionType = mysqlEnum("ai_credit_txn_type", [
  "grant", // free welcome allowance
  "topup", // one-off Stripe purchase
  "auto_topup", // off-session auto recharge
  "adjustment", // manual admin correction
]);

export const aiCreditTransactionStatus = mysqlEnum("ai_credit_txn_status", [
  "pending",
  "completed",
  "failed",
]);

/**
 * Ledger of credit ACQUISITIONS (grants + purchases). Mirrors
 * `sms_topup_transactions`, with a UNIQUE `dedupKey` for exactly-once webhook
 * crediting (`checkout:<sessionId>` / `invoice:<id>` / `grant:<storeId>`).
 */
export const aiCreditTransactions = mysqlTable(
  "ai_credit_transactions",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    type: aiCreditTransactionType.notNull(),

    creditsMicro: bigint("credits_micro", { mode: "number" }).notNull(),
    amountCents: int("amount_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("eur"),

    dedupKey: varchar("dedup_key", { length: 120 }).unique(),

    stripeSessionId: varchar("stripe_session_id", { length: 255 }),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),

    status: aiCreditTransactionStatus.default("pending").notNull(),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => ({
    storeIdx: index("ai_credit_txn_store_idx").on(table.storeId),
    statusIdx: index("ai_credit_txn_status_idx").on(table.status),
    stripeSessionIdx: index("ai_credit_txn_stripe_session_idx").on(table.stripeSessionId),
  }),
);

/**
 * Append-only ledger of credit CONSUMPTION — one row per model run. Idempotent
 * via `dedupKey` (`run:<assistantMessageId>`); amounts are frozen at write time.
 * `costMicroUsd` records the real token cost for audit; the debit is split into
 * `fromMonthlyMicro` (plan's included allowance) and `fromPrepaidMicro` (prepaid
 * balance) so monthly usage this period = SUM(fromMonthlyMicro).
 */
export const aiCreditDebits = mysqlTable(
  "ai_credit_debits",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    // Null for debits not tied to a conversation (e.g. phone-number rental).
    conversationId: varchar("conversation_id", { length: 21 }),
    // What the debit pays for: AI usage (tokens/audio), the monthly rental of
    // the store's provisioned phone number, or one AI product-image enhancement
    // (flat tariff). Keeps cost-vs-billed reporting trivially segmentable per
    // revenue line.
    kind: mysqlEnum("kind", ["usage", "number_rental", "image_enhancement"])
      .notNull()
      .default("usage"),
    // Generated product-image artifact associated with an image debit. Stored
    // as a key (not a deployment-specific public URL) so reads can resolve it
    // through the current storage adapter.
    imageKey: varchar("image_key", { length: 500 }),

    dedupKey: varchar("dedup_key", { length: 120 }).notNull().unique(),

    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    cachedInputTokens: int("cached_input_tokens").notNull().default(0),
    // Voice channel only: billed audio duration for this debit (telephony +
    // STT + TTS). 0 for text-advisor debits. Priced via AI_VOICE_AUDIO_USD_PER_MIN.
    audioSeconds: int("audio_seconds").notNull().default(0),
    // Frozen real cost in micro-USD (1 USD = 1_000_000), for audit/reporting.
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    // Total credits debited (micro-credits), after the per-conversation cap.
    debitedMicro: bigint("debited_micro", { mode: "number" }).notNull().default(0),
    // Split of `debitedMicro` across the two pockets.
    fromMonthlyMicro: bigint("from_monthly_micro", { mode: "number" }).notNull().default(0),
    fromPrepaidMicro: bigint("from_prepaid_micro", { mode: "number" }).notNull().default(0),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    // Hot path: sum a store's monthly-pocket usage within the period.
    storeCreatedIdx: index("ai_credit_debits_store_created_idx").on(table.storeId, table.createdAt),
    conversationIdx: index("ai_credit_debits_conversation_idx").on(table.conversationId),
  }),
);

export const aiCreditsRelations = relations(aiCredits, ({ one }) => ({
  store: one(stores, {
    fields: [aiCredits.storeId],
    references: [stores.id],
  }),
}));

export const aiCreditTransactionsRelations = relations(aiCreditTransactions, ({ one }) => ({
  store: one(stores, {
    fields: [aiCreditTransactions.storeId],
    references: [stores.id],
  }),
}));

export const aiCreditDebitsRelations = relations(aiCreditDebits, ({ one }) => ({
  store: one(stores, {
    fields: [aiCreditDebits.storeId],
    references: [stores.id],
  }),
  conversation: one(aiAdvisorConversations, {
    fields: [aiCreditDebits.conversationId],
    references: [aiAdvisorConversations.id],
  }),
}));

// ============================================================================
// AI Phone receptionist — inbound number binding
// One phone number → one store. Inbound calls resolve the store by the called
// (`To`) number. The number is provisioned with the telephony provider and its
// voice webhook is pointed at the app; the merchant registers the E.164 here.
// ============================================================================

export const storePhoneNumbers = mysqlTable(
  "store_phone_numbers",
  {
    id: id(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    // E.164, e.g. '+33123456789'. Globally unique so an inbound `To` maps to
    // exactly one store.
    e164: varchar("e164", { length: 32 }).notNull().unique(),
    // Telephony provider that owns the number (matches VOICE_PROVIDER).
    provider: varchar("provider", { length: 20 }).notNull().default("twilio"),
    // Provider-side identifier (e.g. Twilio phone-number SID), when known.
    providerNumberId: varchar("provider_number_id", { length: 64 }),
    status: mysqlEnum("status", ["active", "pending", "released"]).notNull().default("active"),
    // Monthly rental billing cycle (provisioned numbers only; null for linked
    // numbers, which the merchant pays for directly). The renewal job debits
    // the rental in AI credits each cycle and advances this anchor.
    nextRenewalAt: timestamp("next_renewal_at", { mode: "date" }),
    // Pre-renewal low-balance warning sent for the current cycle (reset on a
    // successful renewal).
    renewalWarnedAt: timestamp("renewal_warned_at", { mode: "date" }),
    // First failed renewal attempt of the current cycle — starts the grace
    // window at the end of which the number is released.
    renewalFailedAt: timestamp("renewal_failed_at", { mode: "date" }),
    // Mid-grace reminder sent (reset on a successful renewal).
    renewalRemindedAt: timestamp("renewal_reminded_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index("store_phone_numbers_store_idx").on(table.storeId),
  }),
);

export const storePhoneNumbersRelations = relations(storePhoneNumbers, ({ one }) => ({
  store: one(stores, {
    fields: [storePhoneNumbers.storeId],
    references: [stores.id],
  }),
}));
