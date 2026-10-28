import { inArray } from "drizzle-orm";
import { z } from "zod";

import {
  type Transaction,
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
 * `GET /policies` (README §8.2): with `If-None-Match` when the cache holds rows, with
 * `include=history` when it is empty. Inserts the pairs it lacks in one transaction.
 */
export async function pullPolicies(options: PolicyPullOptions = {}): Promise<PolicyPullResult> {
  const alerts = options.alerts ?? createBillingAlerts();
  const state = await readSyncState();
  const empty = await isPolicyCacheEmpty();
  const ifNoneMatch = !empty && state.policiesEtag ? `"${state.policiesEtag}"` : undefined;

  const response = await callBillingService(
    {
      endpoint: "policies",
      method: "GET",
      path: "/policies",
      query: empty ? "include=history" : undefined,
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
 * row. Both alert.
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

  const write = async () => {
    const conflicts: string[] = [];
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
    return { inserted, conflicts };
  };

  let written: Awaited<ReturnType<typeof write>>;
  try {
    written = await write();
  } catch (error) {
    if (!isDuplicateKeyError(error) && !isDatabaseDeadlock(error)) throw error;
    written = await write();
  }
  const { inserted, conflicts } = written;

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
  return {
    inserted,
    known: candidates.size - inserted,
    invalid: invalid.length,
    conflicts: conflicts.length,
  };
}
