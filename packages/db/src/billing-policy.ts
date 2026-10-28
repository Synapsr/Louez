import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "./index";
import { billingPolicies, stores } from "./schema";

// The effective billing policy of a store (louez-billing docs/api, README §8.3), read
// from the cache that apps/web/lib/billing-sync/policies.ts fills. It lives here, next
// to the billing marks, because the card gate runs in changeReservationStatus and
// insertReservation, which packages/api and packages/mcp call too.
//
// BILLING_NEW_STORES_FROM and BILLING_GATE_DISABLED are read from process.env at call
// time, as isBillingSyncEnabled reads LOUEZ_BILLING: this package's env.ts declares
// neither, apps/web/env.ts does, and its start-up check refuses a bad value in service
// mode. Every function here except resolvePolicy is for service mode only (README §12).

export type PolicyExecutor = Database | Transaction;

const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;

/** A contract `Timestamp`: RFC 3339 in UTC, `Z`, 0 to 3 fractional digits. */
export const contractTimestamp = z.string().regex(TIMESTAMP);

/** `invoicing` of a policy (fees.md §5). */
export const policyInvoicing = z.enum(["service", "louez_legacy", "none"]);
export type PolicyInvoicing = z.infer<typeof policyInvoicing>;

/** `reservations` of a policy: what the card gate reads (README §8.4). */
export const policyReservations = z.union([
  z.object({ allowed: z.literal(true) }),
  z.object({
    allowed: z.literal(false),
    reason: z.enum(["payment_method_required", "payment_overdue", "suspended"]),
  }),
]);
export type PolicyReservations = z.infer<typeof policyReservations>;

/**
 * The fields of a cached `PolicyV1` that the resolver and the card gate read. Every
 * stored body passed the full schema of apps/web/lib/billing-sync/policies.ts first.
 */
export const billingPolicyCoreSchema = z.object({
  schema: z.literal("louez.billing.policy/1"),
  storeId: z.string().min(1).max(32),
  version: z.number().int().min(1),
  effectiveFrom: contractTimestamp,
  newStoresCreatedFrom: contractTimestamp.nullable(),
  invoicing: policyInvoicing,
  reservations: policyReservations,
});
export type BillingPolicyCore = z.infer<typeof billingPolicyCoreSchema>;

/** What resolvePolicy reads of a version. */
export type PolicyVersion = {
  readonly storeId: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly newStoresCreatedFrom: string | null;
  readonly invoicing: PolicyInvoicing;
};

export type PolicySource = "store" | "default" | "fail_closed" | "legacy";

export type PolicyResolution = {
  readonly source: PolicySource;
  readonly version: number | null;
  readonly isNew: boolean;
  /** False when the service bills the store, so Louez's legacy code must not. */
  readonly legacyBillingApplies: boolean;
};

/** The highest version whose `effectiveFrom ≤ at`, or null. */
function effectiveVersion<V extends PolicyVersion>(list: readonly V[], at: number): V | null {
  let best: V | null = null;
  for (const version of list) {
    const inForce = Date.parse(version.effectiveFrom) <= at;
    if (inForce && (best === null || version.version > best.version)) best = version;
  }
  return best;
}

function resolve<V extends PolicyVersion>(
  storeId: string,
  storeCreatedAt: string,
  t: string,
  newStoresFrom: string | null,
  versions: readonly V[],
): { readonly resolution: PolicyResolution; readonly applied: V | null } {
  const at = Date.parse(t);
  const defaults = versions.filter((version) => version.storeId === "*");
  const cutoffs = defaults.flatMap((version) =>
    version.newStoresCreatedFrom ? [Date.parse(version.newStoresCreatedFrom)] : [],
  );
  if (newStoresFrom !== null) cutoffs.push(Date.parse(newStoresFrom));
  const isNew = cutoffs.length > 0 && Date.parse(storeCreatedAt) >= Math.min(...cutoffs);
  const own = effectiveVersion(
    versions.filter((version) => version.storeId === storeId),
    at,
  );
  const legacyBillingApplies = !isNew && (own === null || own.invoicing === "louez_legacy");
  if (own) {
    return {
      resolution: { source: "store", version: own.version, isNew, legacyBillingApplies },
      applied: own,
    };
  }
  if (isNew) {
    const fallback = effectiveVersion(defaults, at);
    return fallback
      ? {
          resolution: { source: "default", version: fallback.version, isNew, legacyBillingApplies },
          applied: fallback,
        }
      : {
          resolution: { source: "fail_closed", version: null, isNew, legacyBillingApplies },
          applied: null,
        };
  }
  return {
    resolution: { source: "legacy", version: null, isNew, legacyBillingApplies },
    applied: null,
  };
}

/**
 * README §8.3's resolver, which the service runs too (vectors policy-01 to policy-14):
 * the store's own version in force at `t`; otherwise, for a store created at or after
 * the cutoff, the `*` version in force, or fail closed when there is none; otherwise
 * legacy. Timestamps are contract strings.
 */
export function resolvePolicy(
  storeId: string,
  storeCreatedAt: string,
  t: string,
  newStoresFrom: string | null,
  versions: readonly PolicyVersion[],
): PolicyResolution {
  return resolve(storeId, storeCreatedAt, t, newStoresFrom, versions).resolution;
}

/**
 * BILLING_NEW_STORES_FROM (README §8.3, Q26), or null when it is unset. Throws when it
 * is set but not a date, which the start-up check already refuses in service mode.
 */
export function billingNewStoresFrom(): Date | null {
  const raw = process.env.BILLING_NEW_STORES_FROM;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("BILLING_NEW_STORES_FROM is not a date");
  return date;
}

/** `BILLING_GATE_DISABLED=true`: the card gate ignores `reservations.allowed: false` (README §8.5). */
export function isBillingGateDisabled(): boolean {
  return process.env.BILLING_GATE_DISABLED?.trim() === "true";
}

/** One cached version: the fields read here, and the body as Louez stored it. */
export type CachedPolicy = BillingPolicyCore & { readonly body: unknown };

export type StorePolicyRecords = {
  readonly storeId: string;
  readonly storeCreatedAt: Date;
  /** The cached versions of the store and of `*`. */
  readonly versions: readonly CachedPolicy[];
};

/**
 * What resolving a store's policy reads: when the store was created, and the cached
 * versions of the store and of `*`, in one indexed query. A body that fails the schema
 * is left out, as a refused version would be (README §8.1).
 */
export async function readStorePolicyRecords(
  executor: PolicyExecutor,
  storeId: string,
): Promise<StorePolicyRecords> {
  const [store] = await executor
    .select({ createdAt: stores.createdAt })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) throw new Error(`store ${storeId} does not exist`);
  const rows = await executor
    .select({ body: billingPolicies.body })
    .from(billingPolicies)
    .where(inArray(billingPolicies.storeId, [storeId, "*"]));
  const versions = rows.flatMap(({ body }) => {
    const parsed = billingPolicyCoreSchema.safeParse(body);
    return parsed.success ? [{ ...parsed.data, body }] : [];
  });
  return { storeId, storeCreatedAt: store.createdAt, versions };
}

export type StorePolicy = PolicyResolution & {
  /** The cached version in force: the store's own (`store`) or `*` (`default`). */
  readonly applied: CachedPolicy | null;
  /**
   * What the card gate reads: the version's `reservations`; blocked when the store is
   * new and no version is in force (fail closed); allowed for a legacy store.
   */
  readonly reservations: PolicyReservations;
  /** False when the gate refuses billable reservations: blocked, without BILLING_GATE_DISABLED. */
  readonly acceptsReservations: boolean;
};

const FAIL_CLOSED_RESERVATIONS: PolicyReservations = {
  allowed: false,
  reason: "payment_method_required",
};
const RESERVATIONS_ALLOWED: PolicyReservations = { allowed: true };

/** A store's policy at `at` in service mode (README §8.3), from its cached records. */
export function effectiveStorePolicy(records: StorePolicyRecords, at: Date): StorePolicy {
  const { resolution, applied } = resolve(
    records.storeId,
    records.storeCreatedAt.toISOString(),
    at.toISOString(),
    billingNewStoresFrom()?.toISOString() ?? null,
    records.versions,
  );
  const reservations =
    applied?.reservations ??
    (resolution.source === "fail_closed" ? FAIL_CLOSED_RESERVATIONS : RESERVATIONS_ALLOWED);
  return {
    ...resolution,
    applied,
    reservations,
    acceptsReservations: reservations.allowed || isBillingGateDisabled(),
  };
}

/**
 * Stores created at or after this instant are new (README §8.3): the earliest
 * `newStoresCreatedFrom` among the cached `*` versions, or `newStoresFrom`
 * (BILLING_NEW_STORES_FROM) when that is earlier or when no `*` version is cached.
 */
export async function newStoresCutoff(
  executor: PolicyExecutor,
  newStoresFrom: Date,
): Promise<Date> {
  const defaults = await executor
    .select({ body: billingPolicies.body })
    .from(billingPolicies)
    .where(eq(billingPolicies.storeId, "*"));
  let cutoff = newStoresFrom.getTime();
  for (const { body } of defaults) {
    const parsed = billingPolicyCoreSchema.safeParse(body);
    if (parsed.success && parsed.data.newStoresCreatedFrom) {
      cutoff = Math.min(cutoff, Date.parse(parsed.data.newStoresCreatedFrom));
    }
  }
  return new Date(cutoff);
}
