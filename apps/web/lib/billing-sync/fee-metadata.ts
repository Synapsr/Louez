// Stripe metadata of the fee taken at source (louez-billing docs/api, fees.md §8).
// Louez writes v4 on every Checkout Session of a payment that can carry a fee, fee
// or no fee, and still reads the v3 keys of sessions created before the switch.

export type PaymentKind =
  | "rental"
  | "extension"
  | "adjustment"
  | "custom_request"
  | "deposit"
  | "deposit_hold"
  | "deposit_capture"
  | "deposit_return"
  | "damage";

export type PolicyScope = "store" | "default" | "fail_closed" | "legacy";

export type FeeAtSource = {
  readonly totalMinor: number;
  readonly reservationMinor: number;
  readonly marketplaceMinor: number;
  /** The percent base, 0 when no percent applies (the legacy planner has none). */
  readonly baseMinor: number;
};

export type FeeMetadataV4Input = FeeAtSource & {
  readonly insuranceShareMinor: number;
  readonly policyScope: PolicyScope;
  /** 0 for `fail_closed` and `legacy`. */
  readonly policyVersion: number;
  readonly paymentKind: Extract<PaymentKind, "rental" | "extension" | "custom_request">;
  readonly reservationId: string;
  readonly storeId: string;
};

/** The v4 keys, as decimal strings. Put them on the session and on its PaymentIntent. */
export function buildFeeMetadataV4(input: FeeMetadataV4Input): Record<string, string> {
  return {
    louezFeeV: "4",
    louezFeeTotalMinor: String(input.totalMinor),
    louezFeeReservationMinor: String(input.reservationMinor),
    louezFeeMarketplaceMinor: String(input.marketplaceMinor),
    louezFeeBaseMinor: String(input.baseMinor),
    louezInsuranceShareMinor: String(input.insuranceShareMinor),
    louezPolicyScope: input.policyScope,
    louezPolicyVersion: String(input.policyVersion),
    louezPaymentKind: input.paymentKind,
    reservationId: input.reservationId,
    storeId: input.storeId,
  };
}

export type FeeFacts = FeeAtSource & {
  readonly metadataVersion: 3 | 4;
  /** Null for v3 sessions, which carried no insurance share. */
  readonly insuranceShareMinor: number | null;
  readonly policyScope: PolicyScope;
  readonly policyVersion: number;
  readonly paymentKind: string | null;
};

const SCOPES: ReadonlyArray<PolicyScope> = ["store", "default", "fail_closed", "legacy"];

function policyScope(value: string | undefined): PolicyScope {
  return SCOPES.find((scope) => scope === value) ?? "legacy";
}

function int(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * The fee facts of a session or PaymentIntent, from v4 keys, else from the v3 keys
 * (`platformFeeVersion = '3'`, written only when a fee was taken). Null when the
 * metadata has neither: no fee was asked, or the session predates both.
 */
export function readFeeMetadata(
  metadata: Record<string, string> | null | undefined,
): FeeFacts | null {
  if (!metadata) return null;
  if (metadata.louezFeeV === "4") {
    const total = int(metadata.louezFeeTotalMinor);
    const reservation = int(metadata.louezFeeReservationMinor);
    const marketplace = int(metadata.louezFeeMarketplaceMinor);
    const base = int(metadata.louezFeeBaseMinor);
    if (total === null || reservation === null || marketplace === null || base === null)
      return null;
    return {
      metadataVersion: 4,
      totalMinor: total,
      reservationMinor: reservation,
      marketplaceMinor: marketplace,
      baseMinor: base,
      insuranceShareMinor: int(metadata.louezInsuranceShareMinor),
      policyScope: policyScope(metadata.louezPolicyScope),
      policyVersion: int(metadata.louezPolicyVersion) ?? 0,
      paymentKind: metadata.louezPaymentKind ?? null,
    };
  }
  if (metadata.platformFeeVersion === "3") {
    const reservation = int(metadata.platformReservationFeeCents) ?? 0;
    const marketplace = int(metadata.platformMarketplaceFeeCents) ?? 0;
    return {
      metadataVersion: 3,
      totalMinor: reservation + marketplace,
      reservationMinor: reservation,
      marketplaceMinor: marketplace,
      baseMinor: 0,
      insuranceShareMinor: null,
      policyScope: "legacy",
      policyVersion: 0,
      paymentKind: null,
    };
  }
  return null;
}
