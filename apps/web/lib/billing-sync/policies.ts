import { eq, inArray, max } from "drizzle-orm";
import { z } from "zod";

import {
  type Transaction,
  billingNewStoresFrom,
  billingPolicies,
  contractTimestamp,
  db,
  isDuplicateKeyError,
  markStore,
  policyInvoicing,
  policyReservations,
} from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { canonicalJson } from "@/lib/billing-sync/canonical-json";
import {
  type BillingCallResult,
  type BillingClientOptions,
  callBillingService,
  classifyFailure,
  readProblemCode,
  readSignedJson,
} from "@/lib/billing-sync/client";
import {
  type SyncExecutor,
  isWaitingForRetryAfter,
  readSyncState,
  updateSyncState,
} from "@/lib/billing-sync/state";
import { isDatabaseDeadlock } from "@/lib/db/retry-once-on-deadlock";

// The policy cache (louez-billing docs/api, README §8.1 and §8.2). Louez keeps every
// (storeId, version) it receives, never deletes or overwrites one, and refuses a
// policy it cannot fully understand. lib/billing/policy.ts reads it.

const timestamp = contractTimestamp;
const louezId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const amountMinor = z.number().int().min(0).max(9_999_999_999);
const plainText = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[^<>]+$/);
const localizedText = z
  .object({ fr: plainText, en: plainText })
  .catchall(plainText)
  .refine((text) => Object.keys(text).every((language) => /^[a-z]{2}$/.test(language)), {
    message: "a label language is not two lower-case letters",
  });
/** The payment kinds of fees.md §6. */
export const policyPaymentKind = z.enum([
  "rental",
  "extension",
  "adjustment",
  "custom_request",
  "deposit",
  "deposit_hold",
  "deposit_capture",
  "deposit_return",
  "damage",
]);

/** `applicationFee` of a policy (fees.md §5). */
export const policyApplicationFee = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z
    .object({
      kind: z.literal("percent"),
      rateBps: z.number().int().min(0).max(10_000),
      minMinor: amountMinor,
      maxMinor: amountMinor.nullable(),
      excludeInsurance: z.boolean(),
      appliesTo: z
        .array(policyPaymentKind)
        .min(1)
        .refine((kinds) => new Set(kinds).size === kinds.length, {
          message: "appliesTo repeats a kind",
        }),
    })
    // JSON Schema cannot compare two fields, so the contract leaves this to Louez.
    .refine((fee) => fee.maxMinor === null || fee.minMinor <= fee.maxMinor, {
      message: "minMinor is above maxMinor",
    }),
  z.object({ kind: z.literal("per_reservation"), amountMinor }),
]);

/** `PolicyV1` of openapi.yaml, written in Louez. Unknown fields are dropped. */
export const policyV1Schema = z
  .object({
    schema: z.literal("louez.billing.policy/1"),
    storeId: z.union([z.literal("*"), louezId]),
    version: z.number().int().min(1).max(4_294_967_295),
    effectiveFrom: timestamp,
    issuedAt: timestamp,
    newStoresCreatedFrom: timestamp.nullable(),
    offerKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    invoicing: policyInvoicing,
    currency: z.string().regex(/^[A-Z]{3}$/),
    applicationFee: policyApplicationFee,
    marketplaceFeeMinor: amountMinor,
    reservations: policyReservations,
    notice: z
      .object({
        kind: z.enum(["payment_method_missing", "payment_failed", "card_expiring", "card_removed"]),
        blockAt: timestamp.nullable(),
      })
      .nullable(),
    stripeCustomerId: z
      .string()
      .regex(/^cus_[A-Za-z0-9]{1,250}$/)
      .nullable(),
    labels: z.object({ offer: localizedText, notice: localizedText.nullable() }),
  })
  .refine((policy) => (policy.storeId === "*") === (policy.newStoresCreatedFrom !== null), {
    message: "newStoresCreatedFrom is set on * versions only",
  });

export type PolicyV1 = z.infer<typeof policyV1Schema>;

const policySetSchema = z.object({
  schema: z.literal("louez.billing.policy-set/1"),
  etag: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  generatedAt: timestamp,
  history: z.boolean(),
  // Each policy is checked on its own, so one bad version does not drop the others.
  policies: z.array(z.unknown()),
});

const storePolicySetSchema = z.object({
  schema: z.literal("louez.billing.store-policies/1"),
  storeId: louezId,
  generatedAt: timestamp,
  history: z.boolean(),
  // Checked one by one, as in the full set.
  policies: z.array(z.unknown()).min(1),
});

type PolicyCounts = {
  readonly inserted: number;
  readonly known: number;
  readonly invalid: number;
  readonly conflicts: number;
};

export type PolicyPullResult =
  | ({ readonly outcome: "updated" } & PolicyCounts)
  | { readonly outcome: "not_modified" }
  | { readonly outcome: "waiting" | "failed"; readonly detail: string };

export type StorePolicyPullResult =
  | ({ readonly outcome: "updated" } & PolicyCounts)
  | { readonly outcome: "store_unknown" }
  | { readonly outcome: "waiting" | "failed"; readonly detail: string };

export type PolicyPullOptions = {
  readonly alerts?: BillingAlerts;
  readonly client?: BillingClientOptions;
};

export async function isPolicyCacheEmpty(executor: SyncExecutor = db): Promise<boolean> {
  const rows = await executor
    .select({ storeId: billingPolicies.storeId })
    .from(billingPolicies)
    .limit(1);
  return rows.length === 0;
}

/**
 * The newest version of the store's own policy in the cache, not counting `*`, or null
 * when it has none. A newer one means the service's answer to a change has arrived
 * (lib/billing-sync/plan-sync-soon.ts).
 */
export async function newestCachedStoreVersion(
  storeId: string,
  executor: SyncExecutor = db,
): Promise<number | null> {
  const [row] = await executor
    .select({ version: max(billingPolicies.version) })
    .from(billingPolicies)
    .where(eq(billingPolicies.storeId, storeId));
  return row?.version ?? null;
}

function describePolicy(raw: unknown): string {
  const ids = z.object({ storeId: z.string(), version: z.number() }).safeParse(raw);
  return ids.success ? `${ids.data.storeId} v${ids.data.version}` : "a policy without ids";
}

/** README §6 for a pull that got no usable answer: wait (with `waitUntil`), alert or log. */
async function failPull(
  label: string,
  response: BillingCallResult,
  alerts: BillingAlerts,
  waitUntil: (until: Date) => Promise<void>,
): Promise<{ readonly outcome: "waiting" | "failed"; readonly detail: string }> {
  const failure = classifyFailure(response);
  if (failure.kind === "retry_after") {
    await waitUntil(new Date(Date.now() + failure.seconds * 1000));
    return { outcome: "waiting", detail: failure.detail };
  }
  if (failure.kind === "auth") await alerts.alert("relay_auth", `${label}: ${failure.detail}`);
  else if (failure.kind === "contract") {
    await alerts.alert("relay_contract", `${label}: ${failure.detail}`);
  } else alerts.log.error("billing", `${label} failed: ${failure.detail}`);
  return { outcome: "failed", detail: failure.detail };
}

/**
 * `GET /policies` (README §8.2): with `If-None-Match` once a set was pulled, with
 * `include=history` until then. A store pull can fill the cache first, but only a set
 * pull saves an ETag. Inserts the pairs it lacks in one transaction.
 */
export async function pullPolicies(options: PolicyPullOptions = {}): Promise<PolicyPullResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const state = await readSyncState();
  const bootstrap = (await isPolicyCacheEmpty()) || !state.policiesEtag;
  const ifNoneMatch = bootstrap ? undefined : `"${state.policiesEtag}"`;

  const response = await callBillingService(
    {
      endpoint: "policies",
      method: "GET",
      path: "/policies",
      query: bootstrap ? "include=history" : undefined,
      ifNoneMatch,
    },
    options.client,
  );

  if (response.kind === "response" && response.status === 304 && response.signature.ok) {
    await updateSyncState({ lastPolicyPullAt: new Date() });
    return { outcome: "not_modified" };
  }

  if (response.kind === "response" && response.status === 200) {
    const set = readSignedJson(response, policySetSchema);
    if (!set.ok) {
      await alerts.alert("response_invalid", `GET /policies: ${set.reason}`);
      return { outcome: "failed", detail: set.reason };
    }
    const counts = await storePolicies(set.value.policies, alerts, (tx) =>
      updateSyncState({ policiesEtag: set.value.etag, lastPolicyPullAt: new Date() }, tx),
    );
    return { outcome: "updated", ...counts };
  }

  return failPull("GET /policies", response, alerts, (until) =>
    updateSyncState({ retryAfterUntil: until }),
  );
}

/** Louez sends at most one per-store pull per store every 10 seconds (README §4.4). */
export const STORE_PULL_INTERVAL_MS = 10_000;

/**
 * Shares one pull per key for `intervalMs` from its start: a call in that window gets
 * the pull already made, finished or not, and sends nothing. Counted in memory, per
 * process.
 */
export function createPullLimiter<T>(intervalMs: number, now: () => number = Date.now) {
  const pulls = new Map<string, { readonly startedAt: number; readonly result: Promise<T> }>();
  return (key: string, pull: () => Promise<T>): Promise<T> => {
    const at = now();
    for (const [known, { startedAt }] of pulls) {
      if (at - startedAt >= intervalMs) pulls.delete(known);
    }
    const recent = pulls.get(key);
    if (recent) return recent.result;
    const result = pull();
    pulls.set(key, { startedAt: at, result });
    return result;
  };
}

const limitStorePull = createPullLimiter<StorePolicyPullResult>(STORE_PULL_INTERVAL_MS);

/**
 * A `Retry-After` on a store pull, in this process. Store pulls have their own budget
 * (README §4.4), so theirs does not stop the relay, which waits on the shared one.
 */
let storePullsWaitUntil = 0;

/**
 * `GET /stores/{storeId}/policies` (README §8.2), for the owner's return from the
 * billing pages. A 3-second timeout, at most one per store every 10 seconds; on any
 * failure the cache stays as it is. An answer for another store caches nothing and
 * alerts. `404 store_unknown` plain-marks the store, so its snapshot goes out. The
 * set's ETag and the time of the last pull belong to `GET /policies` and stay as
 * they are.
 */
export function pullStorePolicies(
  storeId: string,
  options: PolicyPullOptions = {},
): Promise<StorePolicyPullResult> {
  return limitStorePull(storeId, () => requestStorePolicies(storeId, options));
}

async function requestStorePolicies(
  storeId: string,
  options: PolicyPullOptions,
): Promise<StorePolicyPullResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const label = `GET /stores/${storeId}/policies`;
  if (Date.now() < storePullsWaitUntil || isWaitingForRetryAfter(await readSyncState())) {
    return { outcome: "waiting", detail: "waiting for Retry-After" };
  }

  const response = await callBillingService(
    {
      endpoint: "storePolicies",
      method: "GET",
      path: `/stores/${encodeURIComponent(storeId)}/policies`,
    },
    options.client,
  );

  if (response.kind === "response" && response.status === 200) {
    const set = readSignedJson(response, storePolicySetSchema);
    if (!set.ok) {
      await alerts.alert("response_invalid", `${label}: ${set.reason}`);
      return { outcome: "failed", detail: set.reason };
    }
    const foreign =
      set.value.storeId !== storeId ||
      set.value.policies.some((raw) => {
        const ids = z.object({ storeId: z.string() }).safeParse(raw);
        return !ids.success || ids.data.storeId !== storeId;
      });
    if (foreign) {
      const detail = "the answer holds another store's policies; nothing was cached";
      await alerts.alert("policies_store_mismatch", `${label}: ${detail}`);
      return { outcome: "failed", detail };
    }
    return { outcome: "updated", ...(await storePolicies(set.value.policies, alerts)) };
  }

  if (
    response.kind === "response" &&
    response.status === 404 &&
    response.signature.ok &&
    readProblemCode(response) === "store_unknown"
  ) {
    await markStore(db, storeId);
    return { outcome: "store_unknown" };
  }

  return failPull(label, response, alerts, async (until) => {
    storePullsWaitUntil = until.getTime();
  });
}

/**
 * Inserts the versions Louez lacks, in one transaction with `inTransaction`. A version
 * that fails the schema is refused; a known one with other content keeps the stored
 * row. Both alert. So does a new `*` version whose `newStoresCreatedFrom` is not
 * BILLING_NEW_STORES_FROM, which is cached all the same (README §8.3).
 *
 * The heartbeat's pull and a store pull, in this process or another, can insert the
 * same new version at once. The loser's insert fails once the winner commits, and it
 * runs again as a new transaction, which reads that row as known.
 */
async function storePolicies(
  rawPolicies: readonly unknown[],
  alerts: BillingAlerts,
  inTransaction?: (tx: Transaction) => Promise<void>,
): Promise<PolicyCounts> {
  const invalid: string[] = [];
  const candidates = new Map<string, { raw: unknown; policy: PolicyV1 }>();
  for (const raw of rawPolicies) {
    const parsed = policyV1Schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      invalid.push(
        `${describePolicy(raw)} at /${issue?.path.join("/") ?? ""}: ${issue?.message ?? ""}`,
      );
      continue;
    }
    candidates.set(`${parsed.data.storeId}\u0000${parsed.data.version}`, {
      raw,
      policy: parsed.data,
    });
  }

  const newStoresFrom = billingNewStoresFrom();
  const write = async () => {
    const conflicts: string[] = [];
    const insertedDefaults: PolicyV1[] = [];
    let inserted = 0;
    await db.transaction(async (tx) => {
      const storeIds = [...new Set([...candidates.values()].map(({ policy }) => policy.storeId))];
      const stored = storeIds.length
        ? await tx
            .select({
              storeId: billingPolicies.storeId,
              version: billingPolicies.version,
              body: billingPolicies.body,
            })
            .from(billingPolicies)
            .where(inArray(billingPolicies.storeId, storeIds))
        : [];
      const known = new Map(stored.map((row) => [`${row.storeId}\u0000${row.version}`, row.body]));

      for (const [key, { raw, policy }] of candidates) {
        const body = known.get(key);
        if (body === undefined) {
          await tx.insert(billingPolicies).values({
            storeId: policy.storeId,
            version: policy.version,
            effectiveFrom: new Date(policy.effectiveFrom),
            body: raw,
          });
          inserted += 1;
          if (policy.storeId === "*") insertedDefaults.push(policy);
          continue;
        }
        // Compared on the fields Louez understands; the stored row always wins.
        const storedPolicy = policyV1Schema.safeParse(body);
        if (!storedPolicy.success || canonicalJson(storedPolicy.data) !== canonicalJson(policy)) {
          conflicts.push(`${policy.storeId} v${policy.version}`);
        }
      }
      await inTransaction?.(tx);
    });
    return { inserted, conflicts, insertedDefaults };
  };

  let written: Awaited<ReturnType<typeof write>>;
  try {
    written = await write();
  } catch (error) {
    if (!isDuplicateKeyError(error) && !isDatabaseDeadlock(error)) throw error;
    written = await write();
  }
  const { inserted, conflicts, insertedDefaults } = written;

  if (invalid.length > 0) {
    await alerts.alert(
      "policies_invalid",
      `${invalid.length} policy version(s) refused, not stored: ${invalid.slice(0, 5).join("; ")}`,
    );
  }
  if (conflicts.length > 0) {
    await alerts.alert(
      "policies_conflict",
      `${conflicts.length} known policy version(s) arrived with other content; the stored rows were kept: ${conflicts.slice(0, 10).join(", ")}`,
    );
  }
  // Both are meant to be T. Louez counts a store as new from the earlier of the two,
  // and the service from the `*` versions alone.
  if (newStoresFrom) {
    const offCutoff = insertedDefaults.filter(
      ({ newStoresCreatedFrom }) =>
        newStoresCreatedFrom !== null &&
        Date.parse(newStoresCreatedFrom) !== newStoresFrom.getTime(),
    );
    if (offCutoff.length > 0) {
      const found = offCutoff
        .slice(0, 10)
        .map((policy) => `v${policy.version} at ${policy.newStoresCreatedFrom}`);
      await alerts.alert(
        "policies_cutoff_mismatch",
        `${offCutoff.length} * version(s) cached with a newStoresCreatedFrom other than BILLING_NEW_STORES_FROM (${newStoresFrom.toISOString()}): ${found.join(", ")}. Louez counts every store created from the earlier instant as new (README §8.3).`,
      );
    }
  }
  return {
    inserted,
    known: candidates.size - inserted,
    invalid: invalid.length,
    conflicts: conflicts.length,
  };
}
