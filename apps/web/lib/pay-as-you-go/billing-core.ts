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
