import { cache } from "react";

import {
  type CachedPolicy,
  type PolicyInvoicing,
  type PolicyReservations,
  type PolicySource,
  db,
  effectiveStorePolicy,
  isBillingSyncEnabled,
  readStorePolicyRecords,
} from "@louez/db";

import { type PolicyV1, policyV1Schema } from "@/lib/billing-sync/policies";
import { log } from "@/lib/evlog";

import { isBillingEnabled } from "./mode";

// The billing policy Louez applies to a store (louez-billing docs/api, README §8.3,
// §8.4 and §12). The resolver and the cache read are in @louez/db (billing-policy.ts),
// where the card gate needs them; this adds the billing modes and the terms the fee
// at source reads (fees.md §8).

/** What Louez applies: the fields of the version in force, or built-in ones. */
export type PolicyTerms = {
  readonly invoicing: PolicyInvoicing;
  /** The currency of the flat amounts; null in the built-in terms, which have none. */
  readonly currency: string | null;
  readonly applicationFee: PolicyV1["applicationFee"];
  readonly marketplaceFeeMinor: number;
  readonly reservations: PolicyReservations;
};

export type EffectivePolicy = {
  /** README §8.3's source, or `built_in` when LOUEZ_BILLING is off. */
  readonly source: PolicySource | "built_in";
  readonly version: number | null;
  readonly isNew: boolean;
  /** False when Louez's legacy pay-as-you-go code must not bill the store. */
  readonly legacyBillingApplies: boolean;
  /** The cached version in force, the store's own or `*`. */
  readonly policy: PolicyV1 | null;
  readonly terms: PolicyTerms;
  /** False when the card gate refuses billable reservations (BILLING_GATE_DISABLED counted). */
  readonly acceptsReservations: boolean;
};

const ALLOWED: PolicyReservations = { allowed: true };

/** No fee at source and no marketplace fee: the built-in terms, under any `invoicing`. */
function termsWithoutFee(
  invoicing: PolicyInvoicing,
  reservations: PolicyReservations,
): PolicyTerms {
  return {
    invoicing,
    currency: null,
    applicationFee: { kind: "none" },
    marketplaceFeeMinor: 0,
    reservations,
  };
}

/**
 * LOUEZ_BILLING off, a self-hosted instance (README §12): nobody bills, no fee, no
 * gate, and the policy table is never read.
 */
const BILLING_OFF: EffectivePolicy = {
  source: "built_in",
  version: null,
  isNew: false,
  legacyBillingApplies: false,
  policy: null,
  terms: termsWithoutFee("none", ALLOWED),
  acceptsReservations: true,
};

/**
 * LOUEZ_BILLING=cloud without BILLING_SERVICE_URL (README §12): every store is legacy,
 * and the legacy planner decides its fees. The table is not read.
 */
const LEGACY_ONLY: EffectivePolicy = {
  source: "legacy",
  version: null,
  isNew: false,
  legacyBillingApplies: true,
  policy: null,
  terms: termsWithoutFee("louez_legacy", ALLOWED),
  acceptsReservations: true,
};

/** One read of the cache per store and request; resolving at an instant is pure. */
const loadStorePolicyRecords = cache((storeId: string) => readStorePolicyRecords(db, storeId));

/** The full version, or null when a stored body no longer passes the schema. */
function readPolicy(applied: CachedPolicy | null): PolicyV1 | null {
  if (!applied) return null;
  const parsed = policyV1Schema.safeParse(applied.body);
  if (parsed.success) return parsed.data;
  log.error(
    "billing",
    `cached policy ${applied.storeId} v${applied.version} fails the policy schema; no fee at source is taken from it`,
  );
  return null;
}

/**
 * The policy of a store at `at`: the time of the Stripe session for a fee at source,
 * now for the card gate, the time of the fact for the legacy guard (README §8.3).
 *
 * In service mode, a new store with no version in force fails closed: no fee at source,
 * billable reservations refused, and the service bills its month once it knows it.
 */
export async function getEffectivePolicy(storeId: string, at: Date): Promise<EffectivePolicy> {
  if (!isBillingEnabled()) return BILLING_OFF;
  if (!isBillingSyncEnabled()) return LEGACY_ONLY;

  const resolved = effectiveStorePolicy(await loadStorePolicyRecords(storeId), at);
  const policy = readPolicy(resolved.applied);
  const terms: PolicyTerms = policy
    ? {
        invoicing: policy.invoicing,
        currency: policy.currency,
        applicationFee: policy.applicationFee,
        marketplaceFeeMinor: policy.marketplaceFeeMinor,
        reservations: resolved.reservations,
      }
    : termsWithoutFee(
        resolved.applied?.invoicing ??
          (resolved.source === "fail_closed" ? "service" : "louez_legacy"),
        resolved.reservations,
      );
  return {
    source: resolved.source,
    version: resolved.version,
    isNew: resolved.isNew,
    legacyBillingApplies: resolved.legacyBillingApplies,
    policy,
    terms,
    acceptsReservations: resolved.acceptsReservations,
  };
}

/**
 * Whether Louez's legacy pay-as-you-go code bills the store at `at`, the time of the
 * fact (README §8.3): false with LOUEZ_BILLING off, true for every store without
 * BILLING_SERVICE_URL, the resolver's answer in service mode.
 */
export async function legacyBillingApplies(storeId: string, at: Date): Promise<boolean> {
  return (await getEffectivePolicy(storeId, at)).legacyBillingApplies;
}
