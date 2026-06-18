import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@louez/db';
import { payAsYouGoInvoices, platformFees, stores, subscriptions } from '@louez/db';
import type { BillingMode } from '@louez/types';

import {
  type ResolvedPayAsYouGoConfig,
  priceForLocationIndex,
  resolvePayAsYouGoConfig,
  summarizePayAsYouGoBands,
} from './config';
import {
  getDefaultFreeReservations,
  getDefaultPayAsYouGoConfigSnapshot,
} from './defaults';

/** Fee statuses that count toward a store's owed/collected totals (not voided/reversed). */
export const ACTIVE_FEE_STATUSES = ['pending', 'collected', 'billed'] as const;

/** Idempotency key for the ledger (unique `dedup_key`): one row per reservation. */
const reservationFeeKey = (reservationId: string) => `res:${reservationId}`;

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
        eq(platformFees.source, 'free'),
        ne(platformFees.status, 'voided'),
      ),
    );
  return Number(value) || 0;
}

/**
 * A store's own currency (ISO 4217, lowercase 3-char), from its settings.
 * Defaults to `eur` when unset. Pay-as-you-go pricing is currency-agnostic (identical
 * numbers in every currency) — the commission is always charged, displayed and invoiced
 * in this currency, so it must follow the store rather than a stored config field.
 */
export async function getStoreCurrency(storeId: string): Promise<string> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true },
  });
  return (store?.settings?.currency || 'eur').toLowerCase().slice(0, 3);
}

/**
 * Resolve a store's billing mode + fee configs. Stores with no subscription row
 * default to subscription mode with the platform default fee configs. The PAYG
 * pricing currency always reflects the store's own currency (same tariff in EUR/USD/…).
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

  // No per-store override → fall back to the platform default offer from
  // PAYG_DEFAULT_PRICING (env), then to the hardcoded ladder. This makes the env var
  // the live default for every store without its own stored config (e.g. legacy
  // accounts), instead of silently using the hardcoded ladder.
  const config = resolvePayAsYouGoConfig(
    subscription?.payAsYouGoConfig ?? getDefaultPayAsYouGoConfigSnapshot(currency),
  );
  config.currency = currency;

  // A store with no subscription row is a legacy / free-tier account. The free plan no
  // longer exists, so the platform default is pay-as-you-go: default the billing mode AND
  // the free-reservation allowance to the env-driven platform defaults. This mirrors how
  // getPlanSlug / getDefaultPlan already treat a missing subscription as pay-as-you-go, and
  // it makes the subscription page show the PAYG view (not the plan grid) for these stores.
  const freeReservationsGranted =
    subscription?.freeReservationsGranted ?? getDefaultFreeReservations();

  return {
    billingMode: subscription?.billingMode ?? 'pay_as_you_go',
    config,
    freeReservationsGranted,
    freeReservationsRemaining: Math.max(0, freeReservationsGranted - freeUsed),
  };
}

export async function isPayAsYouGo(storeId: string): Promise<boolean> {
  const { billingMode } = await getStoreBilling(storeId);
  return billingMode === 'pay_as_you_go';
}

/** Billing month bucket as `YYYY-MM` (UTC). */
export function billingMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

function isDuplicateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Duplicate') || message.includes('unique');
}

// ============================================================================
// Reservation fee (pay-as-you-go per-rental fee)
// ============================================================================

interface RecordReservationFeeInput {
  storeId: string;
  reservationId: string;
  source: 'online' | 'manual';
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
 */
export async function recordReservationFee(
  input: RecordReservationFeeInput,
): Promise<{ recorded: boolean; reason?: string }> {
  const billing = input.billing ?? (await getStoreBilling(input.storeId));
  if (billing.billingMode !== 'pay_as_you_go') {
    return { recorded: false, reason: 'not_pay_as_you_go' };
  }

  const dedupKey = reservationFeeKey(input.reservationId);
  const existing = await db.query.platformFees.findFirst({
    where: eq(platformFees.dedupKey, dedupKey),
    columns: { id: true, status: true, source: true },
  });
  if (existing) {
    if (
      input.source === 'online' &&
      (input.collectedAmountCents ?? 0) > 0 &&
      existing.status === 'pending' &&
      existing.source === 'manual'
    ) {
      await db
        .update(platformFees)
        .set({
          source: 'online',
          status: 'collected',
          amountCents: Math.max(0, Math.round(input.collectedAmountCents ?? 0)),
          paymentId: input.paymentId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(platformFees.id, existing.id));
      return { recorded: true, reason: 'upgraded_to_collected' };
    }
    return { recorded: false, reason: 'already_recorded' };
  }

  const at = input.at ?? new Date();
  const billingMonth = billingMonthOf(at);
  const currency = (input.currency || billing.config.currency || 'eur')
    .toLowerCase()
    .slice(0, 3);

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
            eq(platformFees.source, 'free'),
            ne(platformFees.status, 'voided'),
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
          source: 'free',
          status: 'collected', // settled: nothing owed, nothing collected
          billingMonth,
          monthlyIndex: null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
        });
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
            ne(platformFees.source, 'free'),
            eq(platformFees.billingMonth, billingMonth),
            eq(platformFees.currency, currency),
            inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
          ),
        );
      const monthlyIndex = Number(priorPaid) + 1;

      const amountCents =
        input.source === 'online'
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
        status: input.source === 'online' ? 'collected' : 'pending',
        billingMonth,
        monthlyIndex,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
      });
    });
    if (recordedFree) return { recorded: true, reason: 'free' };
  } catch (error) {
    if (isDuplicateError(error)) {
      return { recorded: false, reason: 'already_recorded' };
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
 */
export async function voidReservationFee(
  reservationId: string,
): Promise<{ voided: boolean }> {
  const result = await db
    .update(platformFees)
    .set({ status: 'voided', updatedAt: new Date() })
    .where(
      and(
        eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
        ne(platformFees.status, 'voided'),
        or(
          eq(platformFees.status, 'pending'),
          eq(platformFees.source, 'free'),
        ),
      ),
    );

  const affectedRows = result[0]?.affectedRows ?? 0;

  // Nothing voided: if a fee was already collected at source (paid) or billed at
  // month-end, it can't simply be voided. Surface it so a cancellation that also refunds
  // the customer is reconciled via the refund webhook, and isn't silently kept.
  if (affectedRows === 0) {
    const existing = await db.query.platformFees.findFirst({
      where: eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
      columns: { status: true, source: true },
    });
    if (
      existing?.source !== 'free' &&
      (existing?.status === 'collected' || existing?.status === 'billed')
    ) {
      console.warn(
        '[payg] reservation fee not voided — already collected/billed; reverse via a refund if the customer is refunded',
        { reservationId, status: existing?.status },
      );
    }
  }

  return { voided: affectedRows > 0 };
}

/** Whether a (non-voided) reservation fee already exists for this reservation. */
export async function hasReservationFee(
  reservationId: string,
): Promise<boolean> {
  const existing = await db.query.platformFees.findFirst({
    where: and(
      eq(platformFees.dedupKey, reservationFeeKey(reservationId)),
      ne(platformFees.status, 'voided'),
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
}

/**
 * Compute the pay-as-you-go reservation commission to skim from a Stripe rental payment
 * via the application fee. Skimmed only for PAYG stores, only if not already recorded
 * for this reservation (a balance payment must not re-charge it), and waived to 0 while
 * the store still has free-reservation credits. Capped below the charge amount.
 * (With Stripe Standard accounts the connected account bears Stripe's processing fees,
 * so there is no separate platform payment fee.)
 */
export async function planStripeFees(opts: {
  storeId: string;
  reservationId: string;
  chargeCents: number;
  billing?: StoreBilling;
  reference?: Date;
}): Promise<StripeFeePlan> {
  const billing = opts.billing ?? (await getStoreBilling(opts.storeId));

  let reservationFeeCents = 0;
  if (
    billing.billingMode === 'pay_as_you_go' &&
    billing.freeReservationsRemaining <= 0
  ) {
    const alreadyRecorded = await hasReservationFee(opts.reservationId);
    if (!alreadyRecorded) {
      reservationFeeCents = await projectedNextReservationFeeCents(
        opts.storeId,
        opts.reference ?? new Date(),
        billing,
      );
    }
  }

  // Cap below the charge amount (Stripe requires application_fee < amount).
  const maxFee = Math.max(0, opts.chargeCents - 1);
  if (reservationFeeCents > maxFee) reservationFeeCents = maxFee;

  return {
    applicationFeeCents: reservationFeeCents,
    reservationFeeCents,
  };
}

/**
 * PaymentIntent metadata carrying the reservation commission from checkout to webhook,
 * so the webhook records the exact amount applied (no recompute drift).
 */
export const FEE_METADATA_KEYS = {
  /** Present (='2') exactly when this PaymentIntent carries our fee breakdown. */
  version: 'platformFeeVersion',
  reservationFee: 'platformReservationFeeCents',
} as const;

/** Current fee-breakdown metadata version (lets the webhook detect legacy/absent ones). */
export const FEE_METADATA_VERSION = '2';

/**
 * Serialize a fee plan into PaymentIntent metadata. The version marker is set whenever an
 * application fee is applied, so the webhook can tell "breakdown present" (even with a 0
 * reservation fee) apart from "legacy/missing metadata" instead of inferring from values.
 */
export function buildFeeMetadata(plan: StripeFeePlan): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (plan.applicationFeeCents > 0) {
    metadata[FEE_METADATA_KEYS.version] = FEE_METADATA_VERSION;
  }
  if (plan.reservationFeeCents > 0) {
    metadata[FEE_METADATA_KEYS.reservationFee] = String(plan.reservationFeeCents);
  }
  return metadata;
}

/**
 * Read the reservation commission back from PaymentIntent metadata. `hasBreakdown` is
 * true only when the version marker is present — a PaymentIntent created before this
 * format (or with stripped metadata) returns false so the webhook can fall back safely.
 */
export function parseFeeMetadata(
  metadata: Record<string, string> | null | undefined,
): { reservationFeeCents: number; hasBreakdown: boolean } {
  const value = Number(metadata?.[FEE_METADATA_KEYS.reservationFee]);
  return {
    reservationFeeCents:
      Number.isFinite(value) && value > 0 ? Math.round(value) : 0,
    hasBreakdown: metadata?.[FEE_METADATA_KEYS.version] === FEE_METADATA_VERSION,
  };
}

// ============================================================================
// Refund reversal (covers the reservation fee collected on a payment)
// ============================================================================

export interface ReversibleFee {
  id: string;
  amountCents: number;
  amountReversedCents: number;
}

/**
 * Fees collected on a payment intent that can still be (partially) reversed — i.e.
 * `collected`/`billed` rows not yet fully reversed. Both fee components share the one
 * Stripe application fee object, refunded (in part or full) once. Read-only.
 */
export async function getReversibleFees(paymentIntentId: string): Promise<{
  stripeApplicationFeeId: string | null;
  rows: ReversibleFee[];
}> {
  const rows = await db
    .select({
      id: platformFees.id,
      amountCents: platformFees.amountCents,
      amountReversedCents: platformFees.amountReversedCents,
      stripeApplicationFeeId: platformFees.stripeApplicationFeeId,
    })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.stripePaymentIntentId, paymentIntentId),
        inArray(platformFees.status, ['collected', 'billed']),
      ),
    );

  const reversible = rows.filter((r) => r.amountReversedCents < r.amountCents);
  const stripeApplicationFeeId =
    rows.find((r) => r.stripeApplicationFeeId)?.stripeApplicationFeeId ?? null;
  return {
    stripeApplicationFeeId,
    rows: reversible.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      amountReversedCents: r.amountReversedCents,
    })),
  };
}

/**
 * Distribute a total reversal amount across fee rows proportionally (capped at each
 * row's remaining reversible amount). Pure — lets the caller decide the total (full
 * refund, partial ratio, or dispute clawback) then persist via `recordFeeReversals`.
 */
export function distributeReversal(
  rows: ReversibleFee[],
  totalReverseCents: number,
): Array<{ id: string; amountReversedCents: number; fullyReversed: boolean }> {
  const updates: Array<{
    id: string;
    amountReversedCents: number;
    fullyReversed: boolean;
  }> = [];
  let remaining = Math.max(0, Math.round(totalReverseCents));
  for (const row of rows) {
    if (remaining <= 0) break;
    const capacity = row.amountCents - row.amountReversedCents;
    if (capacity <= 0) continue;
    const add = Math.min(capacity, remaining);
    const newReversed = row.amountReversedCents + add;
    updates.push({
      id: row.id,
      amountReversedCents: newReversed,
      fullyReversed: newReversed >= row.amountCents,
    });
    remaining -= add;
  }
  return updates;
}

/**
 * Persist fee reversals — call only after the Stripe application-fee refund succeeded.
 * Idempotent + defensive: only touches rows still `collected`/`billed`, and marks a row
 * `reversed` once `amountReversedCents` reaches `amountCents`.
 */
export async function recordFeeReversals(
  updates: Array<{ id: string; amountReversedCents: number; fullyReversed: boolean }>,
): Promise<void> {
  for (const u of updates) {
    await db
      .update(platformFees)
      .set({
        amountReversedCents: u.amountReversedCents,
        ...(u.fullyReversed ? { status: 'reversed' as const } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformFees.id, u.id),
          inArray(platformFees.status, ['collected', 'billed']),
        ),
      );
  }
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
  const active = rows.filter((r) =>
    (ACTIVE_FEE_STATUSES as readonly string[]).includes(r.status),
  );
  const locationCount = active.length;
  const grossCents = active.reduce((sum, r) => sum + r.amountCents, 0);
  const collectedAtSourceCents = rows
    .filter((r) => r.status === 'collected')
    .reduce((sum, r) => sum + r.amountCents, 0);
  // What would be invoiced if the month closed now: the manual (pending) fees only;
  // collected fees are already paid at source.
  const dueCents = rows
    .filter((r) => r.status === 'pending')
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
  status: 'open' | 'paid' | 'failed' | 'void';
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
    .where(
      and(
        eq(payAsYouGoInvoices.storeId, storeId),
        ne(payAsYouGoInvoices.status, 'draft'),
      ),
    )
    .orderBy(desc(payAsYouGoInvoices.billingMonth))
    .limit(limit);

  return rows.filter((r): r is PayAsYouGoInvoiceSummary => r.status !== 'draft');
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
        ne(platformFees.source, 'free'),
        eq(platformFees.billingMonth, billingMonth),
        eq(platformFees.currency, resolved.config.currency),
        inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
      ),
    );

  return priceForLocationIndex(resolved.config, Number(priorCount) + 1);
}
