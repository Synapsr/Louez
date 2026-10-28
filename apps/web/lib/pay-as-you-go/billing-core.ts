export type MonthlyPlatformFeeSource =
  | "online"
  | "manual"
  | "free"
  | "marketplace_online"
  | "marketplace_manual"
  | "marketplace_waived";

interface MonthlyPlatformFeeRow {
  amountCents: number;
  source: MonthlyPlatformFeeSource;
  status: "pending" | "collected" | "billed" | "voided" | "reversed";
}

export function selectMonthlyBillingStoreIds(
  payAsYouGoStoreIds: readonly string[],
  pendingFeeStoreIds: readonly string[],
): string[] {
  return [...new Set([...payAsYouGoStoreIds, ...pendingFeeStoreIds])];
}

export function summarizeMonthlyPlatformFees(
  rows: readonly MonthlyPlatformFeeRow[],
  includePayAsYouGoUsage: boolean,
) {
  const includedRows = rows.filter((row) => {
    if (row.source.startsWith("marketplace_")) return true;
    return includePayAsYouGoUsage;
  });
  const billableRows = includedRows.filter(
    (row) => row.source !== "free" && row.source !== "marketplace_waived",
  );
  const pendingUsageRows = billableRows.filter(
    (row) => row.source === "manual" && row.status === "pending",
  );
  const pendingMarketplaceRows = billableRows.filter(
    (row) => row.source === "marketplace_manual" && row.status === "pending",
  );
  const collectedRows = billableRows.filter((row) => row.status === "collected");

  const usageFeeAmountCents = pendingUsageRows.reduce((sum, row) => sum + row.amountCents, 0);
  const marketplaceFeeAmountCents = pendingMarketplaceRows.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  );

  return {
    locationCount: includedRows.length,
    grossAmountCents: billableRows.reduce((sum, row) => sum + row.amountCents, 0),
    collectedAtSourceCents: collectedRows.reduce((sum, row) => sum + row.amountCents, 0),
    invoicedAmountCents: usageFeeAmountCents + marketplaceFeeAmountCents,
    usageLocationCount: pendingUsageRows.length,
    usageFeeAmountCents,
    marketplaceReservationCount: pendingMarketplaceRows.length,
    marketplaceFeeAmountCents,
  };
}

/** The monthly run bills a month from 05:00 UTC on the 1st of the next month. */
const MONTHLY_BILLING_HOUR_UTC = 5;

const BILLING_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The first instant (UTC) of a `YYYY-MM` billing month, or null when it is not one. */
export function parseBillingMonth(text: string): Date | null {
  const match = BILLING_MONTH.exec(text);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/**
 * When the run may bill `billingMonth`: 05:00 UTC on the 1st of the next month, the
 * month cut (louez-billing docs/api, README §7.5).
 */
export function monthlyBillingRunStart(billingMonth: string): Date {
  const start = parseBillingMonth(billingMonth);
  if (!start) throw new Error(`Not a billing month: "${billingMonth}"`);
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, MONTHLY_BILLING_HOUR_UTC),
  );
}

/**
 * The last instant (UTC) of `billingMonth`, at which the monthly run reads the legacy
 * guard (louez-billing docs/api, README §8.3): a store the billing service bills from
 * the 1st of the next month, as every legacy store from B, is still billed by Louez
 * for this month.
 */
export function billingMonthEnd(billingMonth: string): Date {
  const start = parseBillingMonth(billingMonth);
  if (!start) throw new Error(`Not a billing month: "${billingMonth}"`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1);
}

/** False for the current month, a future one, and the previous one until its run starts. */
export function canBillMonth(billingMonth: string, now: Date): boolean {
  return now.getTime() >= monthlyBillingRunStart(billingMonth).getTime();
}

/**
 * The month the cron bills at `now`: the previous month from 05:00 UTC on the 1st,
 * the one before until then. A month stays due until the next month's run starts,
 * so a run missed or cut short on the 1st is caught up by a later cron call.
 */
export function dueBillingMonth(now: Date): string {
  const unbilled = firstUnbilledMonthStart(now);
  const due = new Date(Date.UTC(unbilled.getUTCFullYear(), unbilled.getUTCMonth() - 1, 1));
  return due.toISOString().slice(0, 7);
}

/**
 * The UTC start of the earliest month whose run has not started. A run bills a store
 * once per month, and only a store that was due when the month's run started, so a fee
 * recorded after that in an earlier month is billed only if its store was due then and
 * no run has reached it yet (the cron's catch-up, or `billing:legacy-run`).
 */
export function firstUnbilledMonthStart(now: Date): Date {
  const thisMonthRun = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
    MONTHLY_BILLING_HOUR_UTC,
  );
  const monthsBack = now.getTime() >= thisMonthRun ? 0 : 1;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}
