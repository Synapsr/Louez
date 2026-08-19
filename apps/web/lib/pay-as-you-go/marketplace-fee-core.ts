export const MARKETPLACE_FEE_CENTS = 100;

export type MarketplaceFeeCollectionSource = "online" | "manual";

interface ExistingMarketplaceFee {
  source:
    | "online"
    | "manual"
    | "free"
    | "marketplace_online"
    | "marketplace_manual"
    | "marketplace_waived";
  status: "pending" | "collected" | "billed" | "voided" | "reversed";
}

export type MarketplaceFeeRecordDecision =
  | {
      action: "insert";
      amountCents: number;
      source: ExistingMarketplaceFee["source"];
      status: "pending" | "collected";
      reason?: "lifetime_waiver";
    }
  | { action: "upgrade" }
  | { action: "skip"; reason: "already_recorded" };

export function decideMarketplaceFeeRecord(params: {
  existing: ExistingMarketplaceFee | null;
  hasLifetimeWaiver: boolean;
  source: MarketplaceFeeCollectionSource;
  collectedAmountCents: number;
}): MarketplaceFeeRecordDecision {
  if (params.existing) {
    if (
      params.source === "online" &&
      params.collectedAmountCents >= MARKETPLACE_FEE_CENTS &&
      params.existing.status === "pending" &&
      params.existing.source === "marketplace_manual"
    ) {
      return { action: "upgrade" };
    }
    return { action: "skip", reason: "already_recorded" };
  }

  if (params.hasLifetimeWaiver) {
    return {
      action: "insert",
      amountCents: 0,
      source: "marketplace_waived",
      status: "collected",
      reason: "lifetime_waiver",
    };
  }

  const collectedAtSource =
    params.source === "online" && params.collectedAmountCents >= MARKETPLACE_FEE_CENTS;
  return {
    action: "insert",
    amountCents: MARKETPLACE_FEE_CENTS,
    source: collectedAtSource ? "marketplace_online" : "marketplace_manual",
    status: collectedAtSource ? "collected" : "pending",
  };
}
