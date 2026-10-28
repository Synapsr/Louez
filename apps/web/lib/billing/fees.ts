import type { FeeAtSource, PaymentKind } from "@/lib/billing-sync/fee-metadata";
import { rhu } from "@/lib/billing-sync/money";

import type { PolicyTerms } from "./policy";

// The fee Louez takes at source on a Stripe charge (louez-billing docs/api, fees.md §7
// and §8). Pure and exact, with no amount of its own: every rate and price comes from
// the store's policy. The public vectors commission-* and source-* of
// lib/billing-sync/fee-vectors.public.json pin it down.

// apps/web targets ES2017, which has no BigInt literals.
const B0 = BigInt(0);
const B1 = BigInt(1);

/** The terms of a `percent` fee that `commission` reads. */
export type CommissionTerms = {
  readonly rateBps: number;
  readonly minMinor: number;
  readonly maxMinor: number | null;
};

function commissionMinor(base: bigint, terms: CommissionTerms): bigint {
  if (base === B0) return B0;
  if (base < B0) return -commissionMinor(-base, terms);
  let fee = rhu(base, BigInt(terms.rateBps));
  if (fee < BigInt(terms.minMinor)) fee = BigInt(terms.minMinor);
  if (terms.maxMinor !== null && fee > BigInt(terms.maxMinor)) fee = BigInt(terms.maxMinor);
  return fee;
}

/**
 * fees.md §7: round first, then the minimum, then the maximum. A base of 0 owes 0 even
 * with a minimum, and a negative base owes the opposite of its magnitude.
 */
export function commission(base: number, terms: CommissionTerms): number {
  return Number(commissionMinor(BigInt(base), terms));
}

/** What `feeAtSource` reads of a policy: the version in force, or built-in terms. */
export type FeePolicy = Pick<
  PolicyTerms,
  "invoicing" | "currency" | "applicationFee" | "marketplaceFeeMinor"
>;

/** One Stripe charge and the facts of fees.md §8, "Inputs". */
export type FeeCharge = {
  readonly chargeMinor: number;
  readonly currency: string;
  readonly kind: PaymentKind;
  readonly insuranceShareMinor: number;
  readonly isMarketplace: boolean;
  readonly marketplaceWaived: boolean;
  readonly marketplaceAlreadyTaken: boolean;
  readonly reservationAlreadyBillable: boolean;
  readonly reservationFeeAlreadyTaken: boolean;
};

const NO_FEE: FeeAtSource = {
  totalMinor: 0,
  reservationMinor: 0,
  marketplaceMinor: 0,
  baseMinor: 0,
};

/**
 * fees.md §8: the application fee of one charge under `policy`. Nothing unless the
 * service invoices the store. The store always keeps at least 1 minor unit; the
 * marketplace fee is reserved first, and a reservation part that does not fit beside it
 * is dropped whole, for the month end to bill. Flat amounts need the policy currency;
 * the percent, its minimum and its maximum apply in any currency.
 */
export function feeAtSource(policy: FeePolicy, charge: FeeCharge): FeeAtSource {
  if (policy.invoicing !== "service") return NO_FEE;
  const amount = BigInt(charge.chargeMinor);
  if (amount <= B0) return NO_FEE;
  const cap = amount - B1;
  const sameCurrency = charge.currency.toUpperCase() === policy.currency;

  const flat = BigInt(policy.marketplaceFeeMinor);
  const marketplace =
    charge.isMarketplace &&
    charge.kind === "rental" &&
    !charge.marketplaceWaived &&
    !charge.marketplaceAlreadyTaken &&
    sameCurrency &&
    flat > B0 &&
    flat <= cap
      ? flat
      : B0;

  const fee = policy.applicationFee;
  let reservation = B0;
  let base = B0;
  if (fee.kind === "percent" && fee.appliesTo.includes(charge.kind)) {
    base = amount - (fee.excludeInsurance ? BigInt(charge.insuranceShareMinor) : B0);
    if (base < B0) base = B0;
    reservation = commissionMinor(base, fee);
  } else if (
    fee.kind === "per_reservation" &&
    charge.kind === "rental" &&
    sameCurrency &&
    !charge.reservationAlreadyBillable &&
    !charge.reservationFeeAlreadyTaken
  ) {
    reservation = BigInt(fee.amountMinor);
  }
  if (marketplace + reservation > cap) reservation = B0;

  return {
    totalMinor: Number(marketplace + reservation),
    reservationMinor: Number(reservation),
    marketplaceMinor: Number(marketplace),
    baseMinor: Number(base),
  };
}
