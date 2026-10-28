import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type Database,
  type DatabaseOnConnection,
  type PolicyExecutor,
  db,
  isBillingSyncEnabled,
  isDuplicateKeyError,
  legacyBilledStoreIds,
  legacyBillingAppliesAt,
  markBillingDirty,
  type MarkExecutor,
  type PolicyInvoicing,
  type PolicySource,
} from "@louez/db";
import {
  payAsYouGoInvoices,
  payments,
  platformFees,
  reservations,
  storeMarketplaceChannels,
  stores,
  subscriptions,
} from "@louez/db";
import type { BillingMode } from "@louez/types";

import { type FeeCharge, feeAtSource } from "@/lib/billing/fees";
import { isBillingEnabled } from "@/lib/billing/mode";
import { getCachedPolicy, getEffectivePolicy } from "@/lib/billing/policy";
import {
  buildFeeMetadataV4,
  type FeeAtSource,
  readFeeMetadata,
  type FeeMetadataV4Input,
} from "@/lib/billing-sync/fee-metadata";
import { log } from "@/lib/evlog";

import { billingMonthEnd } from "./billing-core";
import {
  type ResolvedPayAsYouGoConfig,
  priceForLocationIndex,
  summarizePayAsYouGoBands,
} from "./config";
import { splitFeeRefund } from "./fee-refund-core";
import { resolveStorePricing } from "./pricing-lock-core";
import {
  MARKETPLACE_FEE_CENTS,
  decideMarketplaceFeeRecord,
  type MarketplaceFeeCollectionSource,
} from "./marketplace-fee-core";

/** Fee statuses that count toward a store's owed/collected totals (not voided/reversed). */
export const ACTIVE_FEE_STATUSES = ["pending", "collected", "billed"] as const;

/** Idempotency key for the ledger (unique `dedup_key`): one row per reservation. */
const reservationFeeKey = (reservationId: string) => `res:${reservationId}`;
const marketplaceFeeKey = (reservationId: string) => `mkt:${reservationId}`;

export interface StoreBilling {
  billingMode: BillingMode;
  /** Reservation-fee pricing (pay-as-you-go ladder / flat rate). */
  config: ResolvedPayAsYouGoConfig;
  /** Free reservations gifted at account creation (welcome allowance). */
  freeReservationsGranted: number;
  /** Free reservations still available = granted − used (waived rentals). */
  freeReservationsRemaining: number;
}

/** Count of free-reservation credits a store has already used (non-voided `free` rows). */
async function countFreeReservationsUsed(storeId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.storeId, storeId),
        eq(platformFees.source, "free"),
        ne(platformFees.status, "voided"),
      ),
    );
  return Number(value) || 0;
}

export interface StoreBillingPreferences {
  currency: string;
  country: string | null;
}

/** Store locale/currency inputs fetched together for billing and invoice copy. */
export async function getStoreBillingPreferences(
  storeId: string,
): Promise<StoreBillingPreferences> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true },
  });
  return {
    currency: (store?.settings?.currency || "eur").toLowerCase().slice(0, 3),
    country: store?.settings?.country ?? null,
  };
}

/**
 * A store's own currency (ISO 4217, lowercase 3-char), from its settings.
 * Defaults to `eur` when unset. Pay-as-you-go pricing is currency-agnostic (identical
 * numbers in every currency) — the commission is always charged, displayed and invoiced
 * in this currency, so it must follow the store rather than a stored config field.
 */
export async function getStoreCurrency(storeId: string): Promise<string> {
  const { currency } = await getStoreBillingPreferences(storeId);
  return currency;
}

/** Stores already reported as unfrozen, so the error is logged once per process. */
const reportedUnfrozenStores = new Set<string>();

/**
 * Resolve a store's billing mode and pay-as-you-go pricing from its own subscription row.
 * The env offer for new stores is never read here: a store without a row or without a
 * stored config (the pricing freeze has not reached it) gets the frozen legacy terms, and
 * an error is logged. The PAYG pricing currency always follows the store's own currency
 * (same tariff in EUR/USD/…).
 */
export async function getStoreBilling(storeId: string): Promise<StoreBilling> {
  const [subscription, currency, freeUsed] = await Promise.all([
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, storeId),
      columns: {
        billingMode: true,
        payAsYouGoConfig: true,
        freeReservationsGranted: true,
      },
    }),
    getStoreCurrency(storeId),
    countFreeReservationsUsed(storeId),
  ]);

  const pricing = resolveStorePricing(subscription, currency);
  // Only an instance that bills its stores freezes their pricing: without billing, new
  // stores get no row and nothing is charged, so there is nothing to report.
  if (!pricing.frozen && isBillingEnabled() && !reportedUnfrozenStores.has(storeId)) {
    reportedUnfrozenStores.add(storeId);
    log.error(
      "billing",
      `store ${storeId} has no frozen pay-as-you-go pricing (${subscription ? "no config" : "no subscription row"}); using the legacy terms. Run the pricing freeze.`,
    );
  }

  return {
    billingMode: pricing.billingMode,
    config: pricing.config,
    freeReservationsGranted: pricing.freeReservationsGranted,
    freeReservationsRemaining: Math.max(0, pricing.freeReservationsGranted - freeUsed),
  };
}

export async function isPayAsYouGo(storeId: string): Promise<boolean> {
  const { billingMode } = await getStoreBilling(storeId);
  return billingMode === "pay_as_you_go";
}

/** Billing month bucket as `YYYY-MM` (UTC). */
export function billingMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Marks the billing aggregates a fee row write changes: its store's month, its
 * reservation (an older Stripe payment reads its fee taken at source from the row) and,
 * for a free row, the store's free credits. Call it in the write's transaction.
 */
async function markFeeRows(
  executor: MarkExecutor,
  rows: ReadonlyArray<{
    storeId: string;
    reservationId: string;
    billingMonth: string;
    source?: string;
  }>,
): Promise<void> {
  // One statement, so the queue rows are locked in markBillingDirty's fixed order.
  await markBillingDirty(
    executor,
    rows.flatMap((row) => [
      {
        type: "legacy_month" as const,
        aggregateId: `${row.storeId}:${row.billingMonth}`,
        storeId: row.storeId,
      },
      ...(row.source === "free"
        ? [{ type: "legacy_store" as const, aggregateId: row.storeId, storeId: row.storeId }]
        : []),
      { type: "reservation" as const, aggregateId: row.reservationId, storeId: row.storeId },
    ]),
  );
}

/**
 * The fee rows the monthly run bills: those whose store Louez's legacy code bills at
 * the end of the row's month, as the run reads it (monthlyBillingStoreIds, README
 * §8.3). Read in the write's transaction, so a cancellation or a fee refund changes a
 * row the run invoices, also after the billing service took the store over, and keeps
 * any other row as it is.
 */
async function rowsBilledByTheMonthlyRun<
  Row extends { readonly storeId: string; readonly billingMonth: string },
>(executor: PolicyExecutor, rows: readonly Row[]): Promise<Row[]> {
  const kept: Row[] = [];
  for (const billingMonth of new Set(rows.map((row) => row.billingMonth))) {
    const ofMonth = rows.filter((row) => row.billingMonth === billingMonth);
    const legacy = new Set(
      await legacyBilledStoreIds(
        executor,
        [...new Set(ofMonth.map((row) => row.storeId))],
        billingMonthEnd(billingMonth),
      ),
    );
    kept.push(...ofMonth.filter((row) => legacy.has(row.storeId)));
  }
  return kept;
}

// ============================================================================
// Reservation fee (pay-as-you-go per-rental fee)
// ============================================================================

interface RecordReservationFeeInput {
  storeId: string;
  reservationId: string;
  source: "online" | "manual";
  /** Actual reservation fee collected at source (online). Required for `online`. */
  collectedAmountCents?: number;
  paymentId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeApplicationFeeId?: string | null;
  currency?: string | null;
  at?: Date;
  billing?: StoreBilling;
}

/**
 * Idempotently record the reservation commission for a pay-as-you-go rental.
 * - One row per reservation (`dedup_key = res:<id>`); a second call is a no-op.
 * - No-op when the store is not on pay-as-you-go.
 * - While the store has free-reservation credits, the rental is WAIVED: recorded with
 *   `source='free'`, amount 0, outside the graduated ladder.
 * - A manual `pending` row is upgraded to `collected` if the fee is later collected at
 *   source (prevents double billing).
 * - No-op, without touching the database, when platform billing is off.
 * - No-op for a store the billing service bills at `at`, the time of the fact
 *   (louez-billing docs/api, README §8.3).
 */
export async function recordReservationFee(
  input: RecordReservationFeeInput,
): Promise<{ recorded: boolean; reason?: string }> {
  if (!isBillingEnabled()) return { recorded: false, reason: "billing_off" };
  const at = input.at ?? new Date();
  if (!(await legacyBillingAppliesAt(db, input.storeId, at))) {
    return { recorded: false, reason: "not_legacy_billed" };
  }
  const billing = input.billing ?? (await getStoreBilling(input.storeId));
  if (billing.billingMode !== "pay_as_you_go") {
    return { recorded: false, reason: "not_pay_as_you_go" };
  }

  const dedupKey = reservationFeeKey(input.reservationId);
  const existing = await db.query.platformFees.findFirst({
    where: eq(platformFees.dedupKey, dedupKey),
    columns: {
      id: true,
      status: true,
      source: true,
      storeId: true,
      reservationId: true,
      billingMonth: true,
    },
  });
  if (existing) {
    if (
      input.source === "online" &&
      (input.collectedAmountCents ?? 0) > 0 &&
      existing.status === "pending" &&
      existing.source === "manual"
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(platformFees)
          .set({
            source: "online",
            status: "collected",
            amountCents: Math.max(0, Math.round(input.collectedAmountCents ?? 0)),
            paymentId: input.paymentId ?? null,
            stripePaymentIntentId: input.stripePaymentIntentId ?? null,
            stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(platformFees.id, existing.id));
        await markFeeRows(tx, [existing]);
      });
      return { recorded: true, reason: "upgraded_to_collected" };
    }
    return { recorded: false, reason: "already_recorded" };
  }

  const billingMonth = billingMonthOf(at);
  const currency = (input.currency || billing.config.currency || "eur").toLowerCase().slice(0, 3);

  try {
    let recordedFree = false;
    await db.transaction(async (tx) => {
      // Serialize per-store fee numbering: lock the store's subscription row so two
      // concurrent rentals can't read the same counts (shared monthlyIndex / over-spent
      // free credits).
      await tx.execute(
        sql`SELECT id FROM subscriptions WHERE store_id = ${input.storeId} FOR UPDATE`,
      );

      // Free-reservation welcome allowance: while credits remain, waive this rental.
      const [{ value: freeUsed }] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(platformFees)
        .where(
          and(
            eq(platformFees.storeId, input.storeId),
            eq(platformFees.source, "free"),
            ne(platformFees.status, "voided"),
          ),
        );
      const isFree = Number(freeUsed) < billing.freeReservationsGranted;

      if (isFree) {
        await tx.insert(platformFees).values({
          id: nanoid(),
          storeId: input.storeId,
          reservationId: input.reservationId,
          paymentId: input.paymentId ?? null,
          dedupKey,
          amountCents: 0,
          currency,
          source: "free",
          status: "collected", // settled: nothing owed, nothing collected
          billingMonth,
          monthlyIndex: null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
        });
        await markFeeRows(tx, [
          {
            storeId: input.storeId,
            reservationId: input.reservationId,
            billingMonth,
            source: "free",
          },
        ]);
        recordedFree = true;
        return;
      }

      // Paid rental: priced by its position among PAID rentals this month (free rentals
      // do not advance the graduated ladder).
      const [{ value: priorPaid }] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(platformFees)
        .where(
          and(
            eq(platformFees.storeId, input.storeId),
            inArray(platformFees.source, ["online", "manual"]),
            eq(platformFees.billingMonth, billingMonth),
            eq(platformFees.currency, currency),
            inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
          ),
        );
      const monthlyIndex = Number(priorPaid) + 1;

      const amountCents =
        input.source === "online"
          ? Math.max(0, Math.round(input.collectedAmountCents ?? 0))
          : priceForLocationIndex(billing.config, monthlyIndex);

      await tx.insert(platformFees).values({
        id: nanoid(),
        storeId: input.storeId,
        reservationId: input.reservationId,
        paymentId: input.paymentId ?? null,
        dedupKey,
        amountCents,
        currency,
        source: input.source,
        status: input.source === "online" ? "collected" : "pending",
        billingMonth,
        monthlyIndex,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
      });
      await markFeeRows(tx, [
        { storeId: input.storeId, reservationId: input.reservationId, billingMonth },
      ]);
    });
    if (recordedFree) return { recorded: true, reason: "free" };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { recorded: false, reason: "already_recorded" };
    }
    throw error;
  }

  return { recorded: true };
}

/**
 * Void the reservation fee for a cancelled/rejected rental. Voids a not-yet-billed
 * (`pending`) fee, AND a waived (`free`) fee — voiding a free row restores the store's
 * free-reservation credit. Online fees already collected at source are reversed via the
 * refund webhook (the money is real), so they are surfaced rather than voided.
 * No-op when platform billing is off, and for a row the monthly run does not bill: its
 * store is billed by the billing service at the end of the row's month (louez-billing
 * docs/api, README §8.3).
 */
export async function voidReservationFee(reservationId: string): Promise<{ voided: boolean }> {
  if (!isBillingEnabled()) return { voided: false };
  const voidable = and(
    or(
      eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
      eq(platformFees.dedupKey, marketplaceFeeKey(reservationId)),
    ),
    ne(platformFees.status, "voided"),
    or(
      eq(platformFees.status, "pending"),
      eq(platformFees.source, "free"),
      eq(platformFees.source, "marketplace_waived"),
    ),
  );
  // The rows are read first for their store and month, which the marks need.
  const affectedRows = await db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: platformFees.id,
        storeId: platformFees.storeId,
        reservationId: platformFees.reservationId,
        billingMonth: platformFees.billingMonth,
        source: platformFees.source,
      })
      .from(platformFees)
      .where(voidable)
      .for("update");
    const rows = await rowsBilledByTheMonthlyRun(tx, locked);
    if (rows.length === 0) return 0;
    const result = await tx
      .update(platformFees)
      .set({ status: "voided", updatedAt: new Date() })
      .where(
        and(
          inArray(
            platformFees.id,
            rows.map((row) => row.id),
          ),
          voidable,
        ),
      );
    await markFeeRows(tx, rows);
    return result[0]?.affectedRows ?? 0;
  });

  // Nothing voided: if a fee was already collected at source (paid) or billed at
  // month-end, it can't simply be voided. Surface it so a cancellation that also refunds
  // the customer is reconciled via the refund webhook, and isn't silently kept.
  if (affectedRows === 0) {
    const existing = await db.query.platformFees.findFirst({
      where: eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
      columns: { status: true, source: true },
    });
    if (
      existing?.source !== "free" &&
      (existing?.status === "collected" || existing?.status === "billed")
    ) {
      console.warn(
        "[payg] reservation fee not voided — already collected/billed; reverse via a refund if the customer is refunded",
        { reservationId, status: existing?.status },
      );
    }
  }

  return { voided: affectedRows > 0 };
}

/** Whether a (non-voided) reservation fee already exists for this reservation. */
export async function hasReservationFee(reservationId: string): Promise<boolean> {
  const existing = await db.query.platformFees.findFirst({
    where: and(
      eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
      ne(platformFees.status, "voided"),
    ),
    columns: { id: true },
  });
  return Boolean(existing);
}

export interface StripeFeePlan {
  /** Total to set as the Stripe application fee (capped below the charge). */
  applicationFeeCents: number;
  /** The pay-as-you-go reservation commission skimmed at source (= applicationFeeCents). */
  reservationFeeCents: number;
  /** Flat reeent reservation fee skimmed at source. */
  marketplaceFeeCents: number;
}

export async function hasMarketplaceLifetimeFeeWaiver(storeId: string): Promise<boolean> {
  const channel = await db.query.storeMarketplaceChannels.findFirst({
    where: eq(storeMarketplaceChannels.storeId, storeId),
    columns: { lifetimeFeeWaiverAt: true },
  });
  return channel?.lifetimeFeeWaiverAt !== null && channel?.lifetimeFeeWaiverAt !== undefined;
}

export async function hasMarketplaceFee(reservationId: string): Promise<boolean> {
  const existing = await db.query.platformFees.findFirst({
    where: and(
      eq(platformFees.dedupKey, marketplaceFeeKey(reservationId)),
      ne(platformFees.status, "voided"),
    ),
    columns: { id: true },
  });
  return Boolean(existing);
}

export async function recordMarketplaceFee(input: {
  storeId: string;
  reservationId: string;
  source: MarketplaceFeeCollectionSource;
  collectedAmountCents?: number;
  paymentId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeApplicationFeeId?: string | null;
  currency?: string | null;
  at?: Date;
}): Promise<{ recorded: boolean; reason?: string }> {
  if (!isBillingEnabled()) return { recorded: false, reason: "billing_off" };
  // Louez's legacy billing: none for a store the billing service bills at the time of
  // the fact (louez-billing docs/api, README §8.3).
  const at = input.at ?? new Date();
  if (!(await legacyBillingAppliesAt(db, input.storeId, at))) {
    return { recorded: false, reason: "not_legacy_billed" };
  }
  const dedupKey = marketplaceFeeKey(input.reservationId);
  const existing = await db.query.platformFees.findFirst({
    where: eq(platformFees.dedupKey, dedupKey),
    columns: {
      id: true,
      source: true,
      status: true,
      storeId: true,
      reservationId: true,
      billingMonth: true,
    },
  });
  const collectedAmountCents = Math.max(0, Math.round(input.collectedAmountCents ?? 0));
  const initialDecision = decideMarketplaceFeeRecord({
    existing: existing ?? null,
    hasLifetimeWaiver: false,
    source: input.source,
    collectedAmountCents,
  });

  if (initialDecision.action === "skip") {
    return { recorded: false, reason: initialDecision.reason };
  }
  if (initialDecision.action === "upgrade" && existing) {
    await db.transaction(async (tx) => {
      await tx
        .update(platformFees)
        .set({
          source: "marketplace_online",
          status: "collected",
          amountCents: MARKETPLACE_FEE_CENTS,
          paymentId: input.paymentId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(platformFees.id, existing.id));
      await markFeeRows(tx, [existing]);
    });
    return { recorded: true, reason: "upgraded_to_collected" };
  }

  const currency = (input.currency || (await getStoreCurrency(input.storeId)) || "eur")
    .toLowerCase()
    .slice(0, 3);

  try {
    let reason: string | undefined;
    await db.transaction(async (tx) => {
      const channel = await tx.query.storeMarketplaceChannels.findFirst({
        where: eq(storeMarketplaceChannels.storeId, input.storeId),
        columns: { lifetimeFeeWaiverAt: true },
      });
      const decision = decideMarketplaceFeeRecord({
        existing: null,
        hasLifetimeWaiver: channel?.lifetimeFeeWaiverAt != null,
        source: input.source,
        collectedAmountCents,
      });
      if (decision.action !== "insert") return;
      reason = decision.reason;
      const billingMonth = billingMonthOf(at);
      await tx.insert(platformFees).values({
        id: nanoid(),
        storeId: input.storeId,
        reservationId: input.reservationId,
        paymentId: input.paymentId ?? null,
        dedupKey,
        amountCents: decision.amountCents,
        currency,
        source: decision.source,
        status: decision.status,
        billingMonth,
        monthlyIndex: null,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
      });
      await markFeeRows(tx, [
        { storeId: input.storeId, reservationId: input.reservationId, billingMonth },
      ]);
    });
    return { recorded: true, reason };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { recorded: false, reason: "already_recorded" };
    }
    throw error;
  }
}

/**
 * Compute the pay-as-you-go reservation commission to skim from a Stripe rental payment
 * via the application fee. Skimmed only for PAYG stores, only if not already recorded
 * for this reservation (a balance payment must not re-charge it), and waived to 0 while
 * the store still has free-reservation credits. Capped below the charge amount.
 * (With Stripe Standard accounts the connected account bears Stripe's processing fees,
 * so there is no separate platform payment fee.) No fee at all, reeent's included, when
 * platform billing is off, or for a store the billing service bills when the Stripe
 * session is created (`reference`, louez-billing docs/api, README §8.3).
 */
export async function planStripeFees(opts: {
  storeId: string;
  reservationId: string;
  chargeCents: number;
  billing?: StoreBilling;
  reference?: Date;
  includeMarketplaceFee?: boolean;
}): Promise<StripeFeePlan> {
  const noFee = { applicationFeeCents: 0, reservationFeeCents: 0, marketplaceFeeCents: 0 };
  if (!isBillingEnabled()) return noFee;
  if (!(await legacyBillingAppliesAt(db, opts.storeId, opts.reference ?? new Date()))) {
    return noFee;
  }
  const billing = opts.billing ?? (await getStoreBilling(opts.storeId));
  const maxFee = Math.max(0, opts.chargeCents - 1);

  let marketplaceFeeCents = 0;
  if (opts.includeMarketplaceFee && maxFee >= MARKETPLACE_FEE_CENTS) {
    const [alreadyRecorded, hasLifetimeWaiver] = await Promise.all([
      hasMarketplaceFee(opts.reservationId),
      hasMarketplaceLifetimeFeeWaiver(opts.storeId),
    ]);
    if (!alreadyRecorded && !hasLifetimeWaiver) {
      marketplaceFeeCents = MARKETPLACE_FEE_CENTS;
    }
  }

  let reservationFeeCents = 0;
  if (billing.billingMode === "pay_as_you_go" && billing.freeReservationsRemaining <= 0) {
    const alreadyRecorded = await hasReservationFee(opts.reservationId);
    if (!alreadyRecorded) {
      reservationFeeCents = await projectedNextReservationFeeCents(
        opts.storeId,
        opts.reference ?? new Date(),
        billing,
      );
    }
  }

  // Reserve the flat marketplace fee first; a PAYG fee that does not fit is accrued
  // through the normal monthly rail by the webhook instead of being partially skimmed.
  const remainingForReservationFee = maxFee - marketplaceFeeCents;
  if (reservationFeeCents > remainingForReservationFee) reservationFeeCents = 0;

  return {
    applicationFeeCents: reservationFeeCents + marketplaceFeeCents,
    reservationFeeCents,
    marketplaceFeeCents,
  };
}

// ============================================================================
// The fee at source in shadow (louez-billing docs/api, fees.md §5 and §8)
// ============================================================================

export interface ApplicationFeeInput {
  storeId: string;
  reservationId: string;
  kind: FeeMetadataV4Input["paymentKind"];
  /** The Stripe charge, in minor units. */
  chargeMinor: number;
  currency: string;
  /** fees.md §4, read when the session is created; 0 when it could not be computed. */
  insuranceShareMinor: number;
  /** Today's planner takes the marketplace fee in customer sessions only (fees.md §5). */
  includeMarketplaceFee?: boolean;
}

/** The facts of fees.md §8, "Inputs", that Louez reads from its own tables. */
export type FeeAtSourceFacts = Pick<
  FeeCharge,
  | "isMarketplace"
  | "marketplaceWaived"
  | "marketplaceAlreadyTaken"
  | "reservationAlreadyBillable"
  | "reservationFeeAlreadyTaken"
>;

interface FeeShadow {
  policySource: PolicySource;
  policyVersion: number | null;
  /** The policy's own `invoicing`; the shadow reads `louez_legacy` as `service`. */
  invoicing: PolicyInvoicing;
  /** Null for a store with no policy (`legacy`): there is nothing to evaluate. */
  facts: FeeAtSourceFacts | null;
  fee: FeeAtSource | null;
}

const NO_STRIPE_FEE: StripeFeePlan = {
  applicationFeeCents: 0,
  reservationFeeCents: 0,
  marketplaceFeeCents: 0,
};

/**
 * The application fee of a Stripe charge Louez is about to create: what the legacy
 * planner returns, which is nothing for a store the billing service bills, and nothing
 * for a custom payment request, as before. In service mode it also runs fees.md §8 on the store's cached
 * policy, a `louez_legacy` one as if the service invoiced the store, and logs both,
 * one line per payment. Expect constant differences (fees.md §5): the lines help debug
 * the service's prices and count nothing. The shadow never changes the fee, and its
 * failure never fails the payment.
 */
export async function planApplicationFee(input: ApplicationFeeInput): Promise<StripeFeePlan> {
  const at = new Date();
  const charged =
    input.kind === "custom_request"
      ? Promise.resolve(NO_STRIPE_FEE)
      : planStripeFees({
          storeId: input.storeId,
          reservationId: input.reservationId,
          chargeCents: input.chargeMinor,
          includeMarketplaceFee: input.includeMarketplaceFee,
        });
  if (!isBillingEnabled() || !isBillingSyncEnabled()) return charged;

  const [plan, shadow] = await Promise.all([
    charged,
    shadowApplicationFee(input, at).catch((error: unknown) => {
      log.warn({
        billing: {
          event: "fee_shadow_failed",
          storeId: input.storeId,
          reservationId: input.reservationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }),
  ]);
  if (shadow) {
    log.info({
      billing: {
        event: "fee_shadow",
        storeId: input.storeId,
        reservationId: input.reservationId,
        kind: input.kind,
        chargeMinor: input.chargeMinor,
        currency: input.currency,
        insuranceShareMinor: input.insuranceShareMinor,
        policy: {
          source: shadow.policySource,
          version: shadow.policyVersion,
          invoicing: shadow.invoicing,
        },
        facts: shadow.facts,
        charged: {
          totalMinor: plan.applicationFeeCents,
          reservationMinor: plan.reservationFeeCents,
          marketplaceMinor: plan.marketplaceFeeCents,
        },
        shadow: shadow.fee,
        ...compareFeeShadow(plan, shadow.fee),
      },
    });
  }
  return plan;
}

/** Whether the shadow fee equals what is charged, part by part. */
function compareFeeShadow(
  charged: StripeFeePlan,
  shadow: FeeAtSource | null,
): { outcome: "same" | "differs" | "no_policy"; differenceMinor: number | null } {
  if (!shadow) return { outcome: "no_policy", differenceMinor: null };
  const same =
    shadow.totalMinor === charged.applicationFeeCents &&
    shadow.reservationMinor === charged.reservationFeeCents &&
    shadow.marketplaceMinor === charged.marketplaceFeeCents;
  return {
    outcome: same ? "same" : "differs",
    differenceMinor: shadow.totalMinor - charged.applicationFeeCents,
  };
}

/**
 * fees.md §8 on the store's policy at `at`, the time the session is created, read as
 * if the service invoiced the store. In service mode only.
 */
async function shadowApplicationFee(
  input: ApplicationFeeInput,
  at: Date,
): Promise<FeeShadow | null> {
  const effective = await getEffectivePolicy(input.storeId, at);
  const source = effective.source;
  if (source === "built_in") return null;
  const { terms } = effective;
  if (source === "legacy") {
    return {
      policySource: source,
      policyVersion: null,
      invoicing: terms.invoicing,
      facts: null,
      fee: null,
    };
  }
  const facts = await readFeeAtSourceFacts(input.storeId, input.reservationId);
  const fee = feeAtSource(
    { ...terms, invoicing: terms.invoicing === "louez_legacy" ? "service" : terms.invoicing },
    {
      chargeMinor: input.chargeMinor,
      currency: input.currency,
      kind: input.kind,
      insuranceShareMinor: input.insuranceShareMinor,
      ...facts,
    },
  );
  return {
    policySource: source,
    policyVersion: effective.version,
    invoicing: terms.invoicing,
    facts,
    fee,
  };
}

/**
 * fees.md §8 "Inputs", read before the session is created. Taken fees count from the
 * reservation's completed and refunded payments, so an unpaid session never counts and a
 * later refund never resets one, and, until M6, from its legacy rows that are not voided.
 */
export async function readFeeAtSourceFacts(
  storeId: string,
  reservationId: string,
): Promise<FeeAtSourceFacts> {
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    columns: { source: true, billableAt: true },
  });
  if (!reservation) throw new Error(`reservation ${reservationId} is not in store ${storeId}`);

  const reservationKey = reservationFeeKey(reservationId);
  const marketplaceKey = marketplaceFeeKey(reservationId);
  const legacyRows = await db
    .select({ dedupKey: platformFees.dedupKey })
    .from(platformFees)
    .where(
      and(
        inArray(platformFees.dedupKey, [reservationKey, marketplaceKey]),
        ne(platformFees.status, "voided"),
      ),
    );
  const takenAtSource = await db
    .select({
      origin: payments.origin,
      reservationMinor: payments.appFeeReservationMinor,
      marketplaceMinor: payments.appFeeMarketplaceMinor,
      policyScope: payments.appFeePolicyScope,
      policyVersion: payments.appFeePolicyVersion,
    })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        inArray(payments.status, ["completed", "refunded"]),
        or(gt(payments.appFeeReservationMinor, 0), gt(payments.appFeeMarketplaceMinor, 0)),
      ),
    );

  let reservationFeeAlreadyTaken = legacyRows.some((row) => row.dedupKey === reservationKey);
  for (const payment of takenAtSource) {
    if (reservationFeeAlreadyTaken) break;
    // Extension payments never count (contract Q22).
    if (payment.origin === "extension" || (payment.reservationMinor ?? 0) <= 0) continue;
    reservationFeeAlreadyTaken = await tookPerReservationFee(storeId, payment);
  }

  return {
    isMarketplace: reservation.source === "marketplace",
    marketplaceWaived: await hasMarketplaceLifetimeFeeWaiver(storeId),
    marketplaceAlreadyTaken:
      legacyRows.some((row) => row.dedupKey === marketplaceKey) ||
      takenAtSource.some((payment) => (payment.marketplaceMinor ?? 0) > 0),
    // Read before the session exists, so a time set at all was set before it.
    reservationAlreadyBillable: reservation.billableAt !== null,
    reservationFeeAlreadyTaken,
  };
}

/**
 * Whether a payment's reservation part was a `per_reservation` fee, from the policy its
 * fee metadata names. A legacy fee counts through its `res:` row instead. A policy Louez
 * no longer holds counts as one, so a reservation never pays that fee twice at source.
 */
async function tookPerReservationFee(
  storeId: string,
  payment: {
    readonly policyScope: PolicySource | null;
    readonly policyVersion: number | null;
  },
): Promise<boolean> {
  const scope = payment.policyScope;
  if (scope !== "store" && scope !== "default") return false;
  if (payment.policyVersion === null) return true;
  const policy = await getCachedPolicy(storeId, scope, payment.policyVersion);
  return policy === null || policy.applicationFee.kind === "per_reservation";
}

export type LegacyFeeMetadataInput = Pick<
  FeeMetadataV4Input,
  "insuranceShareMinor" | "paymentKind" | "reservationId" | "storeId"
>;

/**
 * Fee metadata v4 (louez-billing fees.md §8) for a fee the legacy planner computed, for
 * the session and its PaymentIntent. Written in cloud mode on every session of a payment
 * that can carry a fee, fee or no fee (`plan` is null when no fee was planned); empty
 * when platform billing is off. The webhook records the legacy fee rows from it.
 */
export function buildLegacyFeeMetadata(
  plan: StripeFeePlan | null,
  payment: LegacyFeeMetadataInput,
): Record<string, string> {
  if (!isBillingEnabled()) return {};
  return buildFeeMetadataV4({
    totalMinor: plan?.applicationFeeCents ?? 0,
    reservationMinor: plan?.reservationFeeCents ?? 0,
    marketplaceMinor: plan?.marketplaceFeeCents ?? 0,
    baseMinor: 0,
    policyScope: "legacy",
    policyVersion: 0,
    ...payment,
  });
}

/**
 * Read the legacy fee parts back from PaymentIntent metadata, v4 or the v3 keys of
 * sessions created before it. `hasBreakdown` is false when neither is there (an older
 * session, or stripped metadata), so the webhook can fall back safely.
 */
export function parseFeeMetadata(metadata: Record<string, string> | null | undefined): {
  reservationFeeCents: number;
  marketplaceFeeCents: number;
  hasBreakdown: boolean;
} {
  const facts = readFeeMetadata(metadata);
  return {
    reservationFeeCents: Math.max(0, facts?.reservationMinor ?? 0),
    marketplaceFeeCents: Math.max(0, facts?.marketplaceMinor ?? 0),
    hasBreakdown: facts !== null,
  };
}

// ============================================================================
// Application fee refunds (the fee taken at source on a payment)
// ============================================================================

/** Legacy sources whose fee Stripe took on the charge. The others are billed at month end. */
const TAKEN_AT_SOURCE = ["online", "marketplace_online"] as const;

/**
 * Records Stripe's refunded amount of an application fee on the legacy rows Stripe
 * took that fee for (louez-billing docs/api, fees.md §9): the `online` and
 * `marketplace_online` rows of its charge, matched by the fee id, or by the
 * PaymentIntent for rows that predate it. A manual row can carry the PaymentIntent
 * too, when its fee did not fit the charge: Stripe took nothing for it, so a refund
 * never reverses it, billed or not. Called by the reversal at source after its Stripe
 * calls, with Drizzle on the connection that holds its lock; the amount is Stripe's,
 * so a repeat writes nothing. No-op when platform billing is off, and for a row the
 * monthly run does not bill, as voidReservationFee (louez-billing docs/api, README §8.3).
 */
export async function recordApplicationFeeRefund(
  input: {
    readonly applicationFeeId: string;
    readonly paymentIntentId: string | null;
    /** Stripe's `fee.amount_refunded`, cumulative. */
    readonly feeRefundedMinor: number;
  },
  executor: Database | DatabaseOnConnection,
): Promise<void> {
  if (!isBillingEnabled()) return;
  const sameCharge = input.paymentIntentId
    ? or(
        eq(platformFees.stripeApplicationFeeId, input.applicationFeeId),
        and(
          isNull(platformFees.stripeApplicationFeeId),
          eq(platformFees.stripePaymentIntentId, input.paymentIntentId),
        ),
      )
    : eq(platformFees.stripeApplicationFeeId, input.applicationFeeId);
  await executor.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: platformFees.id,
        storeId: platformFees.storeId,
        reservationId: platformFees.reservationId,
        billingMonth: platformFees.billingMonth,
        amountCents: platformFees.amountCents,
        amountReversedCents: platformFees.amountReversedCents,
        status: platformFees.status,
      })
      .from(platformFees)
      .where(
        and(
          sameCharge,
          inArray(platformFees.source, [...TAKEN_AT_SOURCE]),
          inArray(platformFees.status, ["collected", "reversed"]),
        ),
      )
      .orderBy(asc(platformFees.createdAt), asc(platformFees.id))
      .for("update");
    const rows = await rowsBilledByTheMonthlyRun(tx, locked);

    const changed: typeof rows = [];
    for (const { row, amountReversedCents, fullyReversed } of splitFeeRefund(
      rows,
      input.feeRefundedMinor,
    )) {
      const status = fullyReversed ? "reversed" : "collected";
      if (row.amountReversedCents === amountReversedCents && row.status === status) continue;
      await tx
        .update(platformFees)
        .set({ amountReversedCents, status, updatedAt: new Date() })
        .where(eq(platformFees.id, row.id));
      changed.push(row);
    }
    if (changed.length > 0) await markFeeRows(tx, changed);
  });
}

// ============================================================================
// Pay-as-you-go dashboard read models
// ============================================================================

export interface CurrentMonthUsage {
  billingMonth: string;
  locationCount: number;
  grossCents: number;
  collectedAtSourceCents: number;
  dueCents: number;
  currency: string;
  bands: ReturnType<typeof summarizePayAsYouGoBands>;
  config: ResolvedPayAsYouGoConfig;
}

/**
 * Live month-to-date RESERVATION-fee snapshot for the pay-as-you-go dashboard.
 * `dueCents` is what would be invoiced if the month closed now.
 */
export async function getCurrentMonthUsage(
  storeId: string,
  reference: Date = new Date(),
  billing?: StoreBilling,
): Promise<CurrentMonthUsage> {
  const resolved = billing ?? (await getStoreBilling(storeId));
  const billingMonth = billingMonthOf(reference);

  const rows = await db
    .select({
      status: platformFees.status,
      amountCents: platformFees.amountCents,
    })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.storeId, storeId),
        eq(platformFees.billingMonth, billingMonth),
        eq(platformFees.currency, resolved.config.currency),
      ),
    );

  // Stored amounts are the immutable ground truth — each rental keeps the price it was
  // recorded at, so totals are SUMMED, never recomputed from the current config (a
  // mid-month rate change must not retroactively reprice past rentals). Free rentals have
  // amount 0, so they count as locations but add nothing to gross/due.
  const active = rows.filter((r) => (ACTIVE_FEE_STATUSES as readonly string[]).includes(r.status));
  const locationCount = active.length;
  const grossCents = active.reduce((sum, r) => sum + r.amountCents, 0);
  const collectedAtSourceCents = rows
    .filter((r) => r.status === "collected")
    .reduce((sum, r) => sum + r.amountCents, 0);
  // What would be invoiced if the month closed now: the manual (pending) fees only;
  // collected fees are already paid at source.
  const dueCents = rows
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.amountCents, 0);

  return {
    billingMonth,
    locationCount,
    grossCents,
    collectedAtSourceCents,
    dueCents,
    currency: resolved.config.currency,
    bands: summarizePayAsYouGoBands(resolved.config),
    config: resolved.config,
  };
}

export interface PayAsYouGoInvoiceSummary {
  billingMonth: string;
  locationCount: number;
  grossAmountCents: number;
  collectedAtSourceCents: number;
  invoicedAmountCents: number;
  currency: string;
  status: "open" | "paid" | "failed" | "void";
  paidAt: Date | null;
}

/** Most recent finalized month-end invoices for a store (newest first). */
export async function getRecentPayAsYouGoInvoices(
  storeId: string,
  limit = 12,
): Promise<PayAsYouGoInvoiceSummary[]> {
  const rows = await db
    .select({
      billingMonth: payAsYouGoInvoices.billingMonth,
      locationCount: payAsYouGoInvoices.locationCount,
      grossAmountCents: payAsYouGoInvoices.grossAmountCents,
      collectedAtSourceCents: payAsYouGoInvoices.collectedAtSourceCents,
      invoicedAmountCents: payAsYouGoInvoices.invoicedAmountCents,
      currency: payAsYouGoInvoices.currency,
      status: payAsYouGoInvoices.status,
      paidAt: payAsYouGoInvoices.paidAt,
    })
    .from(payAsYouGoInvoices)
    .where(and(eq(payAsYouGoInvoices.storeId, storeId), ne(payAsYouGoInvoices.status, "draft")))
    .orderBy(desc(payAsYouGoInvoices.billingMonth))
    .limit(limit);

  return rows.filter((r): r is PayAsYouGoInvoiceSummary => r.status !== "draft");
}

/**
 * Projected reservation fee (cents) for the NEXT rental this month, used to set the
 * Stripe application fee at checkout time.
 */
export async function projectedNextReservationFeeCents(
  storeId: string,
  reference: Date = new Date(),
  billing?: StoreBilling,
): Promise<number> {
  const resolved = billing ?? (await getStoreBilling(storeId));
  const billingMonth = billingMonthOf(reference);

  const [{ value: priorCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.storeId, storeId),
        ne(platformFees.source, "free"),
        eq(platformFees.billingMonth, billingMonth),
        eq(platformFees.currency, resolved.config.currency),
        inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
      ),
    );

  return priceForLocationIndex(resolved.config, Number(priorCount) + 1);
}
