import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@louez/db';
import { payAsYouGoInvoices, payAsYouGoUsage, subscriptions } from '@louez/db';
import type { BillingMode } from '@louez/types';

import {
  type ResolvedPayAsYouGoConfig,
  graduatedTotalCents,
  priceForLocationIndex,
  resolvePayAsYouGoConfig,
  summarizePayAsYouGoBands,
} from './config';

/** Usage statuses that count toward the monthly total (i.e. not voided/reversed). */
export const ACTIVE_USAGE_STATUSES = [
  'pending',
  'collected',
  'billed',
] as const;

export interface StoreBilling {
  billingMode: BillingMode;
  config: ResolvedPayAsYouGoConfig;
}

/**
 * Resolve a store's billing mode + pay-as-you-go pricing config.
 * Stores with no subscription row default to subscription mode.
 */
export async function getStoreBilling(storeId: string): Promise<StoreBilling> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { billingMode: true, payAsYouGoConfig: true },
  });

  return {
    billingMode: subscription?.billingMode ?? 'subscription',
    config: resolvePayAsYouGoConfig(subscription?.payAsYouGoConfig ?? null),
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

interface RecordBillableLocationInput {
  storeId: string;
  reservationId: string;
  source: 'online' | 'manual';
  /** Actual commission collected at source (online). Required for `online`. */
  collectedAmountCents?: number;
  stripePaymentIntentId?: string | null;
  stripeApplicationFeeId?: string | null;
  /** Charge currency for online; falls back to config currency. */
  currency?: string | null;
  /** When the rental became billable. Defaults to now. */
  at?: Date;
  /** Pre-resolved billing (avoids an extra query when the caller already has it). */
  billing?: StoreBilling;
}

/**
 * Idempotently record one billable rental for a pay-as-you-go store.
 *
 * - Idempotent by `reservationId` (unique). A second call is a no-op.
 * - No-op when the store is not on pay-as-you-go.
 * - `monthlyIndex` is informational (the authoritative monthly total is recomputed
 *   from the valid count at billing time), so a benign index race is harmless.
 */
export async function recordBillableLocation(
  input: RecordBillableLocationInput,
): Promise<{ recorded: boolean; reason?: string }> {
  const billing = input.billing ?? (await getStoreBilling(input.storeId));
  if (billing.billingMode !== 'pay_as_you_go') {
    return { recorded: false, reason: 'not_pay_as_you_go' };
  }

  const existing = await db.query.payAsYouGoUsage.findFirst({
    where: eq(payAsYouGoUsage.reservationId, input.reservationId),
    columns: { id: true, status: true, source: true },
  });
  if (existing) {
    // Upgrade a manual `pending` row to `collected` when the platform commission
    // is now being collected at source (e.g. the owner manually confirmed the
    // reservation before the customer completed an application-fee'd checkout).
    // Without this, the rental would be charged twice: at source AND at month-end.
    if (
      input.source === 'online' &&
      (input.collectedAmountCents ?? 0) > 0 &&
      existing.status === 'pending' &&
      existing.source === 'manual'
    ) {
      await db
        .update(payAsYouGoUsage)
        .set({
          source: 'online',
          status: 'collected',
          amountCents: Math.max(0, Math.round(input.collectedAmountCents ?? 0)),
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(payAsYouGoUsage.id, existing.id));
      return { recorded: true, reason: 'upgraded_to_collected' };
    }
    return { recorded: false, reason: 'already_recorded' };
  }

  const at = input.at ?? new Date();
  const billingMonth = billingMonthOf(at);

  // 1-based position within the month (active records only).
  const [{ value: priorCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(payAsYouGoUsage)
    .where(
      and(
        eq(payAsYouGoUsage.storeId, input.storeId),
        eq(payAsYouGoUsage.billingMonth, billingMonth),
        inArray(payAsYouGoUsage.status, [...ACTIVE_USAGE_STATUSES]),
      ),
    );
  const monthlyIndex = Number(priorCount) + 1;

  const currency = (
    input.currency ||
    billing.config.currency ||
    'eur'
  )
    .toLowerCase()
    .slice(0, 3);

  const amountCents =
    input.source === 'online'
      ? Math.max(0, Math.round(input.collectedAmountCents ?? 0))
      : priceForLocationIndex(billing.config, monthlyIndex);

  try {
    await db.insert(payAsYouGoUsage).values({
      id: nanoid(),
      storeId: input.storeId,
      reservationId: input.reservationId,
      billingMonth,
      monthlyIndex,
      amountCents,
      currency,
      source: input.source,
      status: input.source === 'online' ? 'collected' : 'pending',
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeApplicationFeeId: input.stripeApplicationFeeId ?? null,
    });
  } catch (error) {
    // Unique(reservationId) violation from a concurrent insert → treat as success.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Duplicate') || message.includes('unique')) {
      return { recorded: false, reason: 'already_recorded' };
    }
    throw error;
  }

  return { recorded: true };
}

/**
 * Void the usage for a cancelled/rejected rental so it is not billed.
 * Only affects manual `pending` rentals — online commissions already collected at
 * source are reversed via the refund webhook (see {@link getReversibleOnlineUsage}).
 */
export async function voidLocationUsage(
  reservationId: string,
): Promise<{ voided: boolean }> {
  const result = await db
    .update(payAsYouGoUsage)
    .set({ status: 'voided', updatedAt: new Date() })
    .where(
      and(
        eq(payAsYouGoUsage.reservationId, reservationId),
        eq(payAsYouGoUsage.status, 'pending'),
      ),
    );

  // Drizzle (mysql2) returns [ResultSetHeader, FieldPacket[]]; the header is typed.
  const affectedRows = result[0]?.affectedRows ?? 0;
  return { voided: affectedRows > 0 };
}

/**
 * Look up the online (source-collected) usage row for a payment intent so a refund
 * can reverse the commission. Returns null when there is nothing to reverse (no row,
 * not collected at source, or already reversed). Read-only — the Stripe application
 * fee refund must succeed BEFORE {@link markUsageReversed} is called, so a transient
 * failure leaves the row reversible on the webhook retry.
 */
export async function getReversibleOnlineUsage(paymentIntentId: string): Promise<{
  id: string;
  stripeApplicationFeeId: string | null;
} | null> {
  const usage = await db.query.payAsYouGoUsage.findFirst({
    where: eq(payAsYouGoUsage.stripePaymentIntentId, paymentIntentId),
    columns: { id: true, status: true, stripeApplicationFeeId: true },
  });
  if (!usage || usage.status !== 'collected') {
    return null;
  }
  return { id: usage.id, stripeApplicationFeeId: usage.stripeApplicationFeeId };
}

/** Mark a usage row reversed — call only after the Stripe fee refund has succeeded. */
export async function markUsageReversed(usageId: string): Promise<void> {
  await db
    .update(payAsYouGoUsage)
    .set({ status: 'reversed', updatedAt: new Date() })
    .where(eq(payAsYouGoUsage.id, usageId));
}

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
 * Live month-to-date usage snapshot for the dashboard. The estimated invoice
 * (`dueCents`) is what would be billed if the month closed now.
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
      status: payAsYouGoUsage.status,
      amountCents: payAsYouGoUsage.amountCents,
    })
    .from(payAsYouGoUsage)
    .where(
      and(
        eq(payAsYouGoUsage.storeId, storeId),
        eq(payAsYouGoUsage.billingMonth, billingMonth),
      ),
    );

  const active = rows.filter((r) =>
    (ACTIVE_USAGE_STATUSES as readonly string[]).includes(r.status),
  );
  const locationCount = active.length;
  const collectedAtSourceCents = rows
    .filter((r) => r.status === 'collected')
    .reduce((sum, r) => sum + r.amountCents, 0);

  const grossCents = graduatedTotalCents(resolved.config, locationCount);
  const dueCents = Math.max(0, grossCents - collectedAtSourceCents);

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

/**
 * Most recent finalized month-end invoices for a store (newest first), for the
 * dashboard history. Drafts are excluded — only settled/sent months are shown.
 */
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

  // 'draft' is filtered out above, so the remaining statuses are the displayable set.
  return rows.filter(
    (r): r is PayAsYouGoInvoiceSummary => r.status !== 'draft',
  );
}

/**
 * Projected commission (in cents) for the NEXT rental this month, used to set the
 * Stripe application fee at checkout time for online payments.
 */
export async function projectedNextLocationFeeCents(
  storeId: string,
  reference: Date = new Date(),
  billing?: StoreBilling,
): Promise<number> {
  const resolved = billing ?? (await getStoreBilling(storeId));
  const billingMonth = billingMonthOf(reference);

  const [{ value: priorCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(payAsYouGoUsage)
    .where(
      and(
        eq(payAsYouGoUsage.storeId, storeId),
        eq(payAsYouGoUsage.billingMonth, billingMonth),
        inArray(payAsYouGoUsage.status, [...ACTIVE_USAGE_STATUSES]),
      ),
    );

  return priceForLocationIndex(resolved.config, Number(priorCount) + 1);
}
