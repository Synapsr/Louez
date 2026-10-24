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

/** The monthly run bills the previous month on the 1st at 05:00 UTC. */
const MONTHLY_BILLING_HOUR_UTC = 5;

export function isMonthlyBillingTick(now: Date): boolean {
  return (
    now.getUTCDate() === 1 &&
    now.getUTCHours() === MONTHLY_BILLING_HOUR_UTC &&
    now.getUTCMinutes() === 0
  );
}

/**
 * The UTC start of the earliest month the monthly run will still bill. It never
 * comes back to a month it has billed, so a fee dated before this is never billed.
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
