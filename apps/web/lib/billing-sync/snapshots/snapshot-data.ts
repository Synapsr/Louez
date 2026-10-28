import type { PaymentKind } from "@/lib/billing-sync/fee-metadata";

// The `data` of each snapshot event, field for field as the contract defines it
// (louez-billing docs/api, openapi.yaml: StoreSnapshotV1, ReservationSnapshotV1,
// LegacyStoreSnapshotV1, LegacyMonthSnapshotV1). Every field is always present:
// unknown is null, never a missing key. The enums are the contract's own lists, so
// a value Louez adds to a database enum fails to compile here instead of reaching
// the service (README §13).

export type MarketplaceStatus = "setup_required" | "pending" | "published" | "paused" | "disabled";

/** openapi.yaml StorePlan: a Louez plan in force (README §8.7). */
export type StorePlanSnapshot = {
  readonly slug: "pro" | "ultra";
  readonly status: "active" | "trialing" | "past_due";
  readonly stripeCustomerId: string | null;
};

export type StoreSnapshotData = {
  readonly deleted: boolean;
  readonly slug: string | null;
  readonly createdAt: string;
  readonly onboardingCompleted: boolean;
  readonly currency: string;
  readonly country: string | null;
  readonly timezone: string | null;
  readonly ownerUserIds: readonly string[];
  readonly legalCountry: string | null;
  readonly stripeConnect: {
    readonly accountId: string | null;
    readonly chargesEnabled: boolean;
    readonly onboardingComplete: boolean;
  };
  readonly marketplace: {
    readonly status: MarketplaceStatus | null;
    readonly firstPublishedAt: string | null;
    readonly cohortRank: number | null;
    readonly lifetimeFeeWaiverAt: string | null;
  };
  readonly referral: {
    readonly referredByStoreId: string | null;
    readonly referredByUserId: string | null;
    readonly signupOrigin: string | null;
  };
  /** Only on the final snapshot of an account deletion (PR c). */
  readonly finalReservations: ReadonlyArray<{
    readonly aggregateId: string;
    readonly version: number;
  }> | null;
  /**
   * The Louez plan in force, or null when none is (1.1.0). Unlike the other fields, a
   * snapshot without it says nothing of the plan (README §13), so Louez always sends it.
   */
  readonly plan: StorePlanSnapshot | null;
};

export type ReservationStatus =
  | "pending"
  | "quote"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "declined";

export type PaymentMethod = "stripe" | "cash" | "card" | "transfer" | "check" | "other";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";

export type RefundSnapshot = {
  /** The Stripe refund id for `stripe`, the Louez refund row id for `manual`. */
  readonly refundId: string;
  readonly amountMinor: number;
  readonly refundedAt: string;
  readonly via: "stripe" | "manual";
  readonly stripeRefundId: string | null;
};

export type DisputeSnapshot = {
  readonly disputeId: string;
  readonly amountMinor: number;
  readonly status: "open" | "won" | "lost";
  /** When Stripe withdrew the funds. */
  readonly openedAt: string;
  readonly closedAt: string | null;
};

export type StripePaymentRefs = {
  readonly accountId: string | null;
  readonly paymentIntentId: string | null;
  readonly chargeId: string | null;
  readonly checkoutSessionId: string | null;
};

export type AppFeeSnapshot = {
  readonly totalMinor: number;
  readonly reservationMinor: number;
  readonly marketplaceMinor: number;
  readonly baseMinor: number;
  /** Null when the legacy planner computed the fee or the store failed closed. */
  readonly policy: { readonly scope: "store" | "default"; readonly version: number } | null;
  readonly metadataVersion: 3 | 4;
};

export type PaymentSnapshot = {
  readonly paymentId: string;
  readonly kind: PaymentKind;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly currency: string;
  /** Before any refund. Negative only for `adjustment`. */
  readonly grossMinor: number;
  readonly insuranceShareMinor: number;
  readonly paidAt: string | null;
  readonly refunds: readonly RefundSnapshot[];
  readonly disputes: readonly DisputeSnapshot[];
  readonly stripe: StripePaymentRefs | null;
  readonly appFee: AppFeeSnapshot | null;
};

export type ReservationSnapshotData = {
  readonly deleted: boolean;
  readonly number: string;
  readonly status: ReservationStatus;
  readonly source: string | null;
  readonly createdAt: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly billableAt: string | null;
  readonly withdrawnAt: string | null;
  readonly currency: string;
  readonly totalInclTaxMinor: number;
  readonly insuranceMinor: number;
  readonly payments: readonly PaymentSnapshot[];
};

export type ReferralRewardSnapshot = {
  readonly id: string;
  readonly referredStoreId: string;
  readonly kind: "free_reservations" | "invoice_credit";
  readonly freeReservations: number;
  readonly creditMinor: number;
  readonly currency: string;
  readonly grantedMonth: string;
  readonly status: "granted" | "clawed_back";
  readonly clawedBackAt: string | null;
};

export type LegacyStoreSnapshotData = {
  readonly billingMode: "subscription" | "pay_as_you_go" | null;
  readonly planSlug: string | null;
  readonly subscriptionStatus: "active" | "cancelled" | "past_due" | "trialing" | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripeCustomerId: string | null;
  /** Verbatim from `subscriptions.pay_as_you_go_config`. */
  readonly payAsYouGoConfig: Readonly<Record<string, unknown>> | null;
  readonly pricingVersion: string | null;
  readonly freeReservationsGranted: number;
  readonly freeReservationsUsed: number;
  readonly trialDays: number;
  readonly discountPercent: number;
  readonly discountDurationMonths: number;
  readonly stripeCouponId: string | null;
  readonly referralRewards: readonly ReferralRewardSnapshot[];
};

export type LegacyFeeRowSnapshot = {
  readonly id: string;
  readonly reservationId: string;
  readonly paymentId: string | null;
  readonly dedupKey: string;
  readonly source:
    | "online"
    | "manual"
    | "free"
    | "marketplace_online"
    | "marketplace_manual"
    | "marketplace_waived";
  readonly status: "pending" | "collected" | "billed" | "voided" | "reversed";
  readonly amountMinor: number;
  readonly amountReversedMinor: number;
  readonly currency: string;
  readonly billingMonth: string;
  readonly monthlyIndex: number | null;
  readonly stripePaymentIntentId: string | null;
  readonly stripeApplicationFeeId: string | null;
  readonly invoiceId: string | null;
  readonly createdAt: string;
  readonly billedAt: string | null;
};

export type LegacyMonthInvoiceSnapshot = {
  readonly id: string;
  readonly status: "draft" | "open" | "paid" | "failed" | "void";
  readonly locationCount: number;
  readonly grossAmountMinor: number;
  readonly collectedAtSourceMinor: number;
  readonly invoicedAmountMinor: number;
  readonly usageLocationCount: number;
  readonly usageFeeAmountMinor: number;
  readonly marketplaceReservationCount: number;
  readonly marketplaceFeeAmountMinor: number;
  readonly currency: string;
  readonly stripeInvoiceId: string | null;
  readonly createdAt: string;
  readonly paidAt: string | null;
};

export type LegacyMonthSnapshotData = {
  readonly period: string;
  readonly fees: readonly LegacyFeeRowSnapshot[];
  readonly invoice: LegacyMonthInvoiceSnapshot | null;
};

export type SnapshotData =
  | StoreSnapshotData
  | ReservationSnapshotData
  | LegacyStoreSnapshotData
  | LegacyMonthSnapshotData;
