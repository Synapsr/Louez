import { eq } from "drizzle-orm";

import { db, payAsYouGoInvoices } from "@louez/db";

import { type LockedRun, withBillingLock } from "@/lib/billing-sync/locks";
import { log } from "@/lib/evlog";

import { billStoreForMonth, monthlyBillingStoreIds, readStoreMonthTotals } from "./billing";
import { dueBillingMonth, monthlyBillingRunStart } from "./billing-core";

// The monthly pay-as-you-go run and its catch-up (louez-billing design §8.5 step 4).
//
// Month M is due from 05:00 UTC on the 1st of M+1 (monthlyBillingRunStart). Its run
// bills the stores that were due then: on pay-as-you-go, or with a fee of M pending
// (monthlyBillingStoreIds). It claims each store's pay_as_you_go_invoices row for M
// before any Stripe call, one row per store and month, so a store is billed for M once
// a run has reached it: it has that row, in any status.
//
// Every cron call bills the stores that were due at 05:00 and that no run has reached,
// until the next month's run starts. A run that was missed, or stopped halfway, is
// caught up on the next call, with the stores the 05:00 run would have billed and no
// other: a store that qualifies only later is left as a run on time left it. A store
// with a row is not billed again by the cron: a draft or failed row is resumed by
// `pnpm billing:legacy-run --apply`, as a second run always did.
//
// Only this module bills a month, and only under the `legacy-run` lock, so the cron on
// each instance and the script never bill at the same time. Below the lock, the unique
// (store, month) row and the Stripe idempotency keys still stop a second invoice
// (billing.ts).

const LATE_AFTER_MS = 60_000;

export interface MonthlyBillingResult {
  billingMonth: string;
  storesProcessed: number;
  invoicesCreated: number;
  invoicesPaid: number;
  invoicesFailed: number;
  totalInvoicedCents: number;
  errors: Array<{ storeId: string; error: string }>;
}

export type MonthlyBillingCatchUp =
  | { readonly billingMonth: string; readonly due: false }
  | { readonly billingMonth: string; readonly due: true; readonly billing: MonthlyBillingResult };

export type MonthlyBillingEvent = {
  payg:
    | {
        event: "monthly_billing";
        billingMonth: string;
        /**
         * Started after the 05:00 UTC minute of the 1st. The stores it billed were all
         * due at 05:00, so the run then was missed or stopped before them.
         */
        late: boolean;
        storesProcessed: number;
        invoicesCreated: number;
        invoicesPaid: number;
        invoicesFailed: number;
        totalInvoicedCents: number;
        storesFailed: number;
      }
    | {
        event: "monthly_billing_store_failed";
        billingMonth: string;
        storeId: string;
        error: string;
      };
};

export interface MonthlyBillingLog {
  info(event: MonthlyBillingEvent): void;
  warn(event: MonthlyBillingEvent): void;
  error(event: MonthlyBillingEvent): void;
}

/**
 * The stores due for `billingMonth` when its run started that no run has reached: they
 * have no invoice row for it. The stores with a row are left out before the legacy
 * guard reads policies, so a call that finds every due store with its row, as most do,
 * reads none.
 */
export async function unbilledStoreIds(billingMonth: string): Promise<string[]> {
  const reached = await db
    .select({ storeId: payAsYouGoInvoices.storeId })
    .from(payAsYouGoInvoices)
    .where(eq(payAsYouGoInvoices.billingMonth, billingMonth));
  return monthlyBillingStoreIds(billingMonth, {
    exclude: new Set(reached.map((row) => row.storeId)),
  });
}

/**
 * The cron's monthly run, on every call: bills the stores of the due month that no run
 * has reached (unbilledStoreIds). Most calls find none and write nothing. Skipped while
 * another run holds the lock.
 */
export async function runMonthlyBillingCatchUp(
  now: Date,
  options: { log?: MonthlyBillingLog } = {},
): Promise<LockedRun<MonthlyBillingCatchUp>> {
  const logger = options.log ?? log;
  const billingMonth = dueBillingMonth(now);
  return withBillingLock("legacy-run", async () => {
    const storeIds = await unbilledStoreIds(billingMonth);
    if (storeIds.length === 0) return { billingMonth, due: false };

    const billing = await billStores(billingMonth, storeIds);
    const late = now.getTime() - monthlyBillingRunStart(billingMonth).getTime() >= LATE_AFTER_MS;
    const event: MonthlyBillingEvent = {
      payg: {
        event: "monthly_billing",
        billingMonth,
        late,
        storesProcessed: billing.storesProcessed,
        invoicesCreated: billing.invoicesCreated,
        invoicesPaid: billing.invoicesPaid,
        invoicesFailed: billing.invoicesFailed,
        totalInvoicedCents: billing.totalInvoicedCents,
        storesFailed: billing.errors.length,
      },
    };
    if (late || billing.errors.length > 0) logger.warn(event);
    else logger.info(event);
    for (const failure of billing.errors) {
      logger.error({
        payg: { event: "monthly_billing_store_failed", billingMonth, ...failure },
      });
    }
    return { billingMonth, due: true, billing };
  });
}

export type MonthlyBillingPlanEntry =
  | {
      readonly storeId: string;
      /** No row yet: the run claims these totals, then invoices them. */
      readonly action: "bill";
      readonly currency: string;
      readonly locationCount: number;
      readonly invoicedAmountCents: number;
    }
  | {
      readonly storeId: string;
      /** A run started and did not settle it: resumed with the row's frozen amounts. */
      readonly action: "resume";
      readonly status: "draft" | "failed";
      readonly currency: string;
      readonly invoicedAmountCents: number;
      readonly stripeInvoiceId: string | null;
    }
  | {
      readonly storeId: string;
      /** Settled: the run leaves it alone. */
      readonly action: "settled";
      readonly status: "open" | "paid" | "void";
    };

/** What `billing:legacy-run --apply` would do for each store of `billingMonth`. Reads only. */
export async function planMonthlyBilling(billingMonth: string): Promise<MonthlyBillingPlanEntry[]> {
  const [storeIds, rows] = await Promise.all([
    monthlyBillingStoreIds(billingMonth),
    db
      .select({
        storeId: payAsYouGoInvoices.storeId,
        status: payAsYouGoInvoices.status,
        currency: payAsYouGoInvoices.currency,
        invoicedAmountCents: payAsYouGoInvoices.invoicedAmountCents,
        stripeInvoiceId: payAsYouGoInvoices.stripeInvoiceId,
      })
      .from(payAsYouGoInvoices)
      .where(eq(payAsYouGoInvoices.billingMonth, billingMonth)),
  ]);
  const rowByStore = new Map(rows.map((row) => [row.storeId, row]));

  const plan: MonthlyBillingPlanEntry[] = [];
  for (const storeId of storeIds) {
    const row = rowByStore.get(storeId);
    if (!row) {
      const { currency, summary } = await readStoreMonthTotals(storeId, billingMonth);
      plan.push({
        storeId,
        action: "bill",
        currency,
        locationCount: summary.locationCount,
        invoicedAmountCents: summary.invoicedAmountCents,
      });
    } else if (row.status === "draft" || row.status === "failed") {
      plan.push({
        storeId,
        action: "resume",
        status: row.status,
        currency: row.currency,
        invoicedAmountCents: row.invoicedAmountCents,
        stripeInvoiceId: row.stripeInvoiceId,
      });
    } else {
      plan.push({ storeId, action: "settled", status: row.status });
    }
  }
  return plan;
}

/**
 * Bills every store of `billingMonth` (monthlyBillingStoreIds) under the run's lock:
 * `billing:legacy-run --apply`.
 */
export function applyMonthlyBilling(
  billingMonth: string,
): Promise<LockedRun<MonthlyBillingResult>> {
  return withBillingLock("legacy-run", async () =>
    billStores(billingMonth, await monthlyBillingStoreIds(billingMonth)),
  );
}

/**
 * Bills each store in turn; a store that fails is recorded and the next one still runs.
 * Idempotent per (store, month): billing a store again never charges it twice (the row
 * claim and the Stripe idempotency keys in billStoreForMonth). Callers hold the lock.
 */
async function billStores(
  billingMonth: string,
  storeIds: readonly string[],
): Promise<MonthlyBillingResult> {
  const result: MonthlyBillingResult = {
    billingMonth,
    storesProcessed: 0,
    invoicesCreated: 0,
    invoicesPaid: 0,
    invoicesFailed: 0,
    totalInvoicedCents: 0,
    errors: [],
  };

  for (const storeId of storeIds) {
    result.storesProcessed += 1;
    try {
      const outcome = await billStoreForMonth(storeId, billingMonth);
      if (outcome.invoiceCreated) result.invoicesCreated += 1;
      if (outcome.status === "paid") result.invoicesPaid += 1;
      if (outcome.status === "failed") result.invoicesFailed += 1;
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
