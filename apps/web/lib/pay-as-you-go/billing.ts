import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type Stripe from 'stripe';

import { db } from '@louez/db';
import { payAsYouGoInvoices, payAsYouGoUsage, subscriptions } from '@louez/db';

import { getOrCreateStripeCustomer } from '@/lib/stripe/subscriptions';
import { stripe } from '@/lib/stripe/client';

import { graduatedTotalCents, resolvePayAsYouGoConfig } from './config';
import { ACTIVE_USAGE_STATUSES, billingMonthOf } from './metering';

/** First day (UTC) of the month preceding `reference`. */
function previousMonthStart(reference: Date): Date {
  const d = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1),
  );
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

/** Deterministic Stripe idempotency key so retries never duplicate a charge. */
function idemKey(kind: string, storeId: string, billingMonth: string): string {
  return `payg_${kind}_${storeId}_${billingMonth}`;
}

export interface MonthlyBillingResult {
  billingMonth: string;
  storesProcessed: number;
  invoicesCreated: number;
  invoicesPaid: number;
  invoicesFailed: number;
  totalInvoicedCents: number;
  errors: Array<{ storeId: string; error: string }>;
}

/**
 * Bill every pay-as-you-go store for the month preceding `reference` (run on the
 * 1st of each month). Idempotent per (store, month): re-running never double-charges
 * (DB slot claim + Stripe idempotency keys).
 */
export async function runMonthlyPayAsYouGoBilling(
  reference: Date = new Date(),
): Promise<MonthlyBillingResult> {
  const billingMonth = billingMonthOf(previousMonthStart(reference));

  const result: MonthlyBillingResult = {
    billingMonth,
    storesProcessed: 0,
    invoicesCreated: 0,
    invoicesPaid: 0,
    invoicesFailed: 0,
    totalInvoicedCents: 0,
    errors: [],
  };

  // Bill any store that is currently pay-as-you-go OR still has unsettled usage
  // for the target month (covers stores switched off PAYG mid-month, so their
  // accrued rentals are not silently dropped).
  const paygStores = await db
    .selectDistinct({ storeId: subscriptions.storeId })
    .from(subscriptions)
    .where(eq(subscriptions.billingMode, 'pay_as_you_go'));

  const storesWithUsage = await db
    .selectDistinct({ storeId: payAsYouGoUsage.storeId })
    .from(payAsYouGoUsage)
    .where(
      and(
        eq(payAsYouGoUsage.billingMonth, billingMonth),
        inArray(payAsYouGoUsage.status, ['pending', 'collected']),
      ),
    );

  const storeIds = [
    ...new Set([
      ...paygStores.map((s) => s.storeId),
      ...storesWithUsage.map((s) => s.storeId),
    ]),
  ];

  for (const storeId of storeIds) {
    result.storesProcessed += 1;
    try {
      const outcome = await billStoreForMonth(storeId, billingMonth);
      if (outcome.invoiceCreated) result.invoicesCreated += 1;
      if (outcome.status === 'paid') result.invoicesPaid += 1;
      if (outcome.status === 'failed') result.invoicesFailed += 1;
      result.totalInvoicedCents += outcome.invoicedCents;
    } catch (error) {
      result.errors.push({
        storeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

interface BillStoreOutcome {
  status: 'paid' | 'open' | 'failed' | 'void' | 'skipped';
  invoicedCents: number;
  invoiceCreated: boolean;
}

/**
 * Bill a single store for a single month. Safe to call repeatedly and concurrently:
 * the (store, month) DB row is claimed before any Stripe call and every Stripe call
 * carries a deterministic idempotency key.
 */
export async function billStoreForMonth(
  storeId: string,
  billingMonth: string,
): Promise<BillStoreOutcome> {
  // ---- Aggregate this month's usage. ----
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { payAsYouGoConfig: true },
  });
  const config = resolvePayAsYouGoConfig(subscription?.payAsYouGoConfig ?? null);

  const rows = await db
    .select({
      id: payAsYouGoUsage.id,
      status: payAsYouGoUsage.status,
      amountCents: payAsYouGoUsage.amountCents,
      stripeApplicationFeeId: payAsYouGoUsage.stripeApplicationFeeId,
    })
    .from(payAsYouGoUsage)
    .where(
      and(
        eq(payAsYouGoUsage.storeId, storeId),
        eq(payAsYouGoUsage.billingMonth, billingMonth),
        inArray(payAsYouGoUsage.status, [...ACTIVE_USAGE_STATUSES]),
      ),
    );

  const locationCount = rows.length;
  const collectedRows = rows.filter((r) => r.status === 'collected');
  const collectedAtSourceCents = collectedRows.reduce(
    (sum, r) => sum + r.amountCents,
    0,
  );
  const grossAmountCents = graduatedTotalCents(config, locationCount);
  const invoicedAmountCents = Math.max(
    0,
    grossAmountCents - collectedAtSourceCents,
  );
  const currency = config.currency;

  // ---- Claim the (store, month) slot BEFORE any Stripe call (idempotency). ----
  const claim = await claimInvoiceRow({
    storeId,
    billingMonth,
    locationCount,
    grossAmountCents,
    collectedAtSourceCents,
    invoicedAmountCents,
    currency,
  });
  if (claim.terminal) {
    return {
      status: claim.status,
      invoicedCents: claim.invoicedAmountCents,
      invoiceCreated: false,
    };
  }
  const invoiceRowId = claim.id;
  const invoiceCreated = claim.created;
  const existingStripeInvoiceId = claim.stripeInvoiceId;
  // Drive Stripe with the FROZEN amounts from the claimed row so the idempotency-keyed
  // request bodies are stable across retries (see ClaimResult).
  const billLocationCount = claim.locationCount;
  const billGrossCents = claim.grossAmountCents;
  const billCollectedCents = claim.collectedAtSourceCents;
  const billInvoicedCents = claim.invoicedAmountCents;

  // Nothing to invoice (no usage, or everything already collected at source).
  if (billInvoicedCents <= 0) {
    // If the platform over-collected at source (concurrent checkouts can lock an
    // earlier, pricier band), refund the excess so the store pays exactly T(N).
    if (billCollectedCents > billGrossCents) {
      await refundOverCollection(
        collectedRows,
        billCollectedCents - billGrossCents,
        billingMonth,
      );
    }
    await db
      .update(payAsYouGoInvoices)
      .set({ status: 'void', updatedAt: new Date() })
      .where(eq(payAsYouGoInvoices.id, invoiceRowId));
    // Close out any pending rows (nothing left to charge) so the month is settled.
    await markUsageBilled(storeId, billingMonth, invoiceRowId);
    return { status: 'void', invoicedCents: 0, invoiceCreated };
  }

  // ---- Create & collect the Stripe invoice on the PLATFORM account. ----
  const stripeCustomerId = await getOrCreateStripeCustomer(storeId);
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) {
    throw new Error(
      `Stripe customer ${stripeCustomerId} for store ${storeId} is deleted; cannot bill pay-as-you-go.`,
    );
  }
  const hasDefaultPaymentMethod = Boolean(
    customer.invoice_settings?.default_payment_method || customer.default_source,
  );
  const collectionMethod: Stripe.Invoice.CollectionMethod =
    hasDefaultPaymentMethod ? 'charge_automatically' : 'send_invoice';

  let invoice: Stripe.Invoice;
  if (existingStripeInvoiceId) {
    // Resume a prior interrupted run.
    invoice = await stripe.invoices.retrieve(existingStripeInvoiceId);
    invoice = await ensureInvoiceCollected(
      invoice,
      stripeCustomerId,
      billInvoicedCents,
      currency,
      billingMonth,
      billLocationCount,
      storeId,
    );
  } else {
    // Create the draft invoice first (exclude any stray pending items), persist its
    // id immediately, then bind the single line item to THIS invoice.
    invoice = await stripe.invoices.create(
      {
        customer: stripeCustomerId,
        collection_method: collectionMethod,
        ...(collectionMethod === 'send_invoice' ? { days_until_due: 14 } : {}),
        // Enable Stripe dunning/auto-collection so failed charge_automatically
        // invoices are retried and reconciled via the platform invoice webhook.
        // We still finalize explicitly below (immediately, before Stripe's ~1h
        // auto-finalize), so the line item is always attached first.
        auto_advance: true,
        pending_invoice_items_behavior: 'exclude',
        metadata: { type: 'pay_as_you_go', storeId, billingMonth },
      },
      { idempotencyKey: idemKey('invoice', storeId, billingMonth) },
    );
    await db
      .update(payAsYouGoInvoices)
      .set({
        stripeInvoiceId: invoice.id,
        stripeCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(payAsYouGoInvoices.id, invoiceRowId));

    invoice = await ensureInvoiceCollected(
      invoice,
      stripeCustomerId,
      billInvoicedCents,
      currency,
      billingMonth,
      billLocationCount,
      storeId,
    );
  }

  const status = mapStripeInvoiceStatus(invoice, collectionMethod);

  await db
    .update(payAsYouGoInvoices)
    .set({
      locationCount: billLocationCount,
      grossAmountCents: billGrossCents,
      collectedAtSourceCents: billCollectedCents,
      invoicedAmountCents: billInvoicedCents,
      currency,
      status,
      stripeInvoiceId: invoice.id ?? existingStripeInvoiceId,
      stripeCustomerId,
      paidAt: status === 'paid' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(payAsYouGoInvoices.id, invoiceRowId));

  // Mark the manual (pending) rentals as billed only once payment is actually
  // collected. A hosted (send_invoice) invoice stays 'open' until paid, and its
  // rentals are settled by the invoice.paid platform webhook (reconcilePayAsYouGoInvoice),
  // so an unpaid hosted invoice never silently loses the commission.
  if (status === 'paid') {
    await markUsageBilled(storeId, billingMonth, invoiceRowId);
  }

  return {
    status,
    invoicedCents: billInvoicedCents,
    invoiceCreated,
  };
}

interface ClaimInput {
  storeId: string;
  billingMonth: string;
  locationCount: number;
  grossAmountCents: number;
  collectedAtSourceCents: number;
  invoicedAmountCents: number;
  currency: string;
}

type ClaimResult =
  | { terminal: true; status: 'paid' | 'open' | 'void'; invoicedAmountCents: number }
  | {
      terminal: false;
      id: string;
      created: boolean;
      stripeInvoiceId: string | null;
      // Frozen amounts to drive Stripe with. On the FIRST run these equal the
      // freshly-computed values; on a resume they are the persisted snapshot, so the
      // idempotency-keyed Stripe request body never changes even if usage shifted in
      // the meantime (which would otherwise trigger a 4xx key-reuse error).
      locationCount: number;
      grossAmountCents: number;
      collectedAtSourceCents: number;
      invoicedAmountCents: number;
    };

/**
 * Claim the (store, month) invoice slot before any Stripe call. Returns terminal=true
 * when the month is already settled (paid/open/void); otherwise returns the row id and
 * the FROZEN amounts to drive Stripe with. Note: the claim guarantees a single DB row
 * per (store, month), but does not by itself serialize concurrent Stripe calls — the
 * deterministic Stripe idempotency keys are what make a true simultaneous race safe.
 */
async function claimInvoiceRow(input: ClaimInput): Promise<ClaimResult> {
  const existing = await db.query.payAsYouGoInvoices.findFirst({
    where: and(
      eq(payAsYouGoInvoices.storeId, input.storeId),
      eq(payAsYouGoInvoices.billingMonth, input.billingMonth),
    ),
  });

  if (existing) {
    if (
      existing.status === 'paid' ||
      existing.status === 'open' ||
      existing.status === 'void'
    ) {
      return {
        terminal: true,
        status: existing.status,
        invoicedAmountCents: existing.invoicedAmountCents,
      };
    }
    // status 'draft' or 'failed' → resume / retry collection with the frozen amounts.
    return {
      terminal: false,
      id: existing.id,
      created: false,
      stripeInvoiceId: existing.stripeInvoiceId,
      locationCount: existing.locationCount,
      grossAmountCents: existing.grossAmountCents,
      collectedAtSourceCents: existing.collectedAtSourceCents,
      invoicedAmountCents: existing.invoicedAmountCents,
    };
  }

  // No row yet — try to insert a draft to claim the slot. A concurrent run may win
  // the unique(store, month) race; if so, reload and resume from its row.
  const id = nanoid();
  try {
    await db.insert(payAsYouGoInvoices).values({
      id,
      storeId: input.storeId,
      billingMonth: input.billingMonth,
      locationCount: input.locationCount,
      grossAmountCents: input.grossAmountCents,
      collectedAtSourceCents: input.collectedAtSourceCents,
      invoicedAmountCents: input.invoicedAmountCents,
      currency: input.currency,
      status: 'draft',
    });
    return {
      terminal: false,
      id,
      created: true,
      stripeInvoiceId: null,
      locationCount: input.locationCount,
      grossAmountCents: input.grossAmountCents,
      collectedAtSourceCents: input.collectedAtSourceCents,
      invoicedAmountCents: input.invoicedAmountCents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Duplicate') && !message.includes('unique')) {
      throw error;
    }
    const winner = await db.query.payAsYouGoInvoices.findFirst({
      where: and(
        eq(payAsYouGoInvoices.storeId, input.storeId),
        eq(payAsYouGoInvoices.billingMonth, input.billingMonth),
      ),
    });
    if (!winner) throw error;
    if (
      winner.status === 'paid' ||
      winner.status === 'open' ||
      winner.status === 'void'
    ) {
      return {
        terminal: true,
        status: winner.status,
        invoicedAmountCents: winner.invoicedAmountCents,
      };
    }
    return {
      terminal: false,
      id: winner.id,
      created: false,
      stripeInvoiceId: winner.stripeInvoiceId,
      locationCount: winner.locationCount,
      grossAmountCents: winner.grossAmountCents,
      collectedAtSourceCents: winner.collectedAtSourceCents,
      invoicedAmountCents: winner.invoicedAmountCents,
    };
  }
}

/**
 * Ensure the (draft or open) invoice has its line item, is finalized, and — when a
 * default payment method exists — has had collection attempted. All Stripe calls are
 * idempotency-keyed so a retry resumes rather than duplicates.
 */
async function ensureInvoiceCollected(
  invoice: Stripe.Invoice,
  stripeCustomerId: string,
  invoicedAmountCents: number,
  currency: string,
  billingMonth: string,
  locationCount: number,
  storeId: string,
): Promise<Stripe.Invoice> {
  const invoiceId = invoice.id;
  if (!invoiceId) return invoice;

  if (invoice.status === 'draft') {
    // Bind the single line item to THIS invoice (idempotent), then finalize.
    await stripe.invoiceItems.create(
      {
        customer: stripeCustomerId,
        invoice: invoiceId,
        amount: invoicedAmountCents,
        currency,
        description: `Locations ${billingMonth} — ${locationCount} location(s)`,
        metadata: { type: 'pay_as_you_go', storeId, billingMonth },
      },
      { idempotencyKey: idemKey('item', storeId, billingMonth) },
    );
    invoice = await stripe.invoices.finalizeInvoice(invoiceId, undefined, {
      idempotencyKey: idemKey('finalize', storeId, billingMonth),
    });
  }

  // Attempt collection for charge_automatically invoices still awaiting payment.
  if (
    invoice.status === 'open' &&
    invoice.collection_method === 'charge_automatically'
  ) {
    try {
      invoice = await stripe.invoices.pay(invoiceId, undefined, {
        idempotencyKey: idemKey('pay', storeId, billingMonth),
      });
    } catch {
      // Card declined / no usable method — invoice stays 'open'; recorded as failed.
    }
  }

  return invoice;
}

async function markUsageBilled(
  storeId: string,
  billingMonth: string,
  invoiceRowId: string,
): Promise<void> {
  await db
    .update(payAsYouGoUsage)
    .set({ status: 'billed', invoiceId: invoiceRowId, billedAt: new Date() })
    .where(
      and(
        eq(payAsYouGoUsage.storeId, storeId),
        eq(payAsYouGoUsage.billingMonth, billingMonth),
        eq(payAsYouGoUsage.status, 'pending'),
      ),
    );
}

/**
 * Refund over-collected application fees back to the connected accounts so the store
 * never pays more than the graduated total. Idempotency-keyed per fee.
 */
async function refundOverCollection(
  collectedRows: Array<{ amountCents: number; stripeApplicationFeeId: string | null }>,
  excessCents: number,
  billingMonth: string,
): Promise<void> {
  let remaining = excessCents;
  for (const row of collectedRows) {
    if (remaining <= 0) break;
    if (!row.stripeApplicationFeeId) continue;
    const refundAmount = Math.min(remaining, row.amountCents);
    if (refundAmount <= 0) continue;
    try {
      await stripe.applicationFees.createRefund(
        row.stripeApplicationFeeId,
        { amount: refundAmount },
        {
          idempotencyKey: `payg_excess_${row.stripeApplicationFeeId}_${billingMonth}`,
        },
      );
      remaining -= refundAmount;
    } catch (error) {
      console.error('[payg] Failed to refund over-collected fee:', {
        applicationFeeId: row.stripeApplicationFeeId,
        error,
      });
    }
  }
  // Surface any unrefunded excess (fees missing an id, already-refunded, or Stripe
  // errors) so the store's slight overpayment can be corrected manually.
  if (remaining > 0) {
    console.error('[payg] Over-collection only partially refunded', {
      billingMonth,
      excessCents,
      unrefundedCents: remaining,
    });
  }
}

function mapStripeInvoiceStatus(
  invoice: Stripe.Invoice,
  collectionMethod: Stripe.Invoice.CollectionMethod,
): 'paid' | 'open' | 'failed' | 'void' {
  if (invoice.status === 'paid') return 'paid';
  if (invoice.status === 'void') return 'void';
  if (invoice.status === 'uncollectible') return 'failed';
  // 'open' on a charge_automatically invoice means the immediate charge did not
  // succeed → treat as failed so usage stays pending and the run reports it.
  if (invoice.status === 'open' && collectionMethod === 'charge_automatically') {
    return 'failed';
  }
  // 'open' (hosted/send_invoice) or 'draft' → awaiting payment.
  return 'open';
}

/**
 * Reconcile a pay-as-you-go invoice from a platform Stripe webhook (invoice.paid /
 * payment_failed / marked_uncollectible). Returns true when a row was updated.
 */
export async function reconcilePayAsYouGoInvoice(
  stripeInvoiceId: string,
  outcome: 'paid' | 'failed',
): Promise<boolean> {
  const row = await db.query.payAsYouGoInvoices.findFirst({
    where: eq(payAsYouGoInvoices.stripeInvoiceId, stripeInvoiceId),
  });
  if (!row) return false;

  if (outcome === 'paid') {
    await db
      .update(payAsYouGoInvoices)
      .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payAsYouGoInvoices.id, row.id));
    // Settle any still-pending rentals for this month.
    await markUsageBilled(row.storeId, row.billingMonth, row.id);
    return true;
  }

  // payment_failed / uncollectible
  await db
    .update(payAsYouGoInvoices)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(payAsYouGoInvoices.id, row.id));
  return true;
}
