import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { billingPolicies, db } from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { canonicalJson } from "@/lib/billing-sync/canonical-json";
import {
  type BillingClientOptions,
  callBillingService,
  classifyFailure,
  readSignedJson,
} from "@/lib/billing-sync/client";
import { type SyncExecutor, readSyncState, updateSyncState } from "@/lib/billing-sync/state";

// The policy cache (louez-billing docs/api, README §8.1 and §8.2). Louez keeps every
// (storeId, version) it receives, never deletes or overwrites one, and refuses a
// policy it cannot fully understand. Nothing reads them for fees yet.

const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;

/** A contract `Timestamp`: RFC 3339 in UTC, `Z`, 0 to 3 fractional digits. */
export const contractTimestamp = z.string().regex(TIMESTAMP);
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
const paymentKind = z.enum([
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

const applicationFee = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z
    .object({
      kind: z.literal("percent"),
      rateBps: z.number().int().min(0).max(10_000),
      minMinor: amountMinor,
      maxMinor: amountMinor.nullable(),
      excludeInsurance: z.boolean(),
      appliesTo: z
        .array(paymentKind)
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

const reservationsGate = z.union([
  z.object({ allowed: z.literal(true) }),
  z.object({
    allowed: z.literal(false),
    reason: z.enum(["payment_method_required", "payment_overdue", "suspended"]),
  }),
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
    invoicing: z.enum(["service", "louez_legacy", "none"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    applicationFee,
    marketplaceFeeMinor: amountMinor,
    reservations: reservationsGate,
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

export type PolicyPullResult =
  | {
      readonly outcome: "updated";
      readonly inserted: number;
      readonly known: number;
      readonly invalid: number;
      readonly conflicts: number;
    }
  | { readonly outcome: "not_modified" }
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
    return storePolicySet(set.value.etag, set.value.policies, alerts);
  }

  const failure = classifyFailure(response);
  if (failure.kind === "retry_after") {
    await updateSyncState({ retryAfterUntil: new Date(Date.now() + failure.seconds * 1000) });
    return { outcome: "waiting", detail: failure.detail };
  }
  if (failure.kind === "auth") await alerts.alert("relay_auth", `GET /policies: ${failure.detail}`);
  else if (failure.kind === "contract") {
    await alerts.alert("relay_contract", `GET /policies: ${failure.detail}`);
  } else alerts.log.error("billing", `GET /policies failed: ${failure.detail}`);
  return { outcome: "failed", detail: failure.detail };
}

async function storePolicySet(
  etag: string,
  rawPolicies: readonly unknown[],
  alerts: BillingAlerts,
): Promise<PolicyPullResult> {
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
    await updateSyncState({ policiesEtag: etag, lastPolicyPullAt: new Date() }, tx);
  });

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
    outcome: "updated",
    inserted,
    known: candidates.size - inserted,
    invalid: invalid.length,
    conflicts: conflicts.length,
  };
}

/**
 * Stores created at or after this instant are new (README §8.3): the earliest
 * `newStoresCreatedFrom` among the cached `*` versions, or BILLING_NEW_STORES_FROM
 * when that is earlier or when no `*` version is cached.
 */
export async function newStoresCutoff(
  newStoresFrom: Date,
  executor: SyncExecutor = db,
): Promise<Date> {
  const defaults = await executor
    .select({ body: billingPolicies.body })
    .from(billingPolicies)
    .where(eq(billingPolicies.storeId, "*"));
  let cutoff = newStoresFrom.getTime();
  for (const { body } of defaults) {
    const parsed = policyV1Schema.safeParse(body);
    if (parsed.success && parsed.data.newStoresCreatedFrom) {
      cutoff = Math.min(cutoff, Date.parse(parsed.data.newStoresCreatedFrom));
    }
  }
  return new Date(cutoff);
}
