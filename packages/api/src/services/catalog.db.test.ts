import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The catalog feed's `bookable` (louez-billing docs/api, README §8.4): false while the
// store's card gate refuses new reservations, by the store's own version or by a `*`
// version, which also moves the new-stores cutoff (README §8.3). M2 issues no `*`
// version and no blocking one; M3 does.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const DAY = 86_400_000;
// The feed reads the gate now, so every date is relative to now, in whole seconds.
const NOW = Math.floor(Date.now() / 1000) * 1000;
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY);

/** The `*` versions' cutoff, earlier than BILLING_NEW_STORES_FROM. */
const DEFAULT_CUTOFF = at(-30);
const NEW_STORES_FROM = at(-10);

/** Created before both cutoffs, with no version of its own. */
const LEGACY = "feed_legacy";
/** Created before both cutoffs, with its own version that refuses reservations. */
const BLOCKED = "feed_blocked";
/** Created after both cutoffs: new. */
const NEW_STORE = "feed_new";
/** Created between the `*` cutoff and BILLING_NEW_STORES_FROM: new through `*` only. */
const BETWEEN = "feed_between";

function policy(
  storeId: string,
  version: number,
  effectiveFrom: Date,
  newStoresCreatedFrom: Date | null,
  reservations: { allowed: true } | { allowed: false; reason: string },
) {
  return {
    schema: "louez.billing.policy/1",
    storeId,
    version,
    effectiveFrom: effectiveFrom.toISOString(),
    issuedAt: effectiveFrom.toISOString(),
    newStoresCreatedFrom: newStoresCreatedFrom?.toISOString() ?? null,
    offerKey: "test-offer",
    invoicing: storeId === "*" ? "service" : "louez_legacy",
    currency: "EUR",
    applicationFee: { kind: "none" },
    marketplaceFeeMinor: 0,
    reservations,
    notice: null,
    stripeCustomerId: null,
    labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
  };
}

describe("catalog feed bookable (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let catalog: typeof import("./catalog");
  const saved = new Map(
    ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"].map(
      (name) => [name, process.env[name]] as const,
    ),
  );

  before(async () => {
    database = await createTestDatabase("catalog_bookable");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    catalog = await import("./catalog");

    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM.toISOString();

    const stores: Array<[string, Date]> = [
      [LEGACY, at(-60)],
      [BLOCKED, at(-60)],
      [NEW_STORE, at(-5)],
      [BETWEEN, at(-20)],
    ];
    await louezDb.db.insert(louezDb.stores).values(
      stores.map(([id, createdAt]) => ({
        id,
        userId: `owner_${id}`,
        name: id,
        slug: id.replaceAll("_", "-"),
        onboardingCompleted: true,
        createdAt,
      })),
    );
    await louezDb.db.insert(louezDb.storeMarketplaceChannels).values(
      stores.map(([storeId]) => ({
        id: `channel_${storeId}`,
        storeId,
        enabledByOwner: true,
        status: "published" as const,
        publishedAt: at(-1),
      })),
    );
    await cache(policy(BLOCKED, 1, at(-50), null, { allowed: false, reason: "payment_overdue" }));
  });

  after(async () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function cache(body: ReturnType<typeof policy>) {
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: body.storeId,
      version: body.version,
      effectiveFrom: new Date(body.effectiveFrom),
      body,
    });
  }

  async function bookable(): Promise<Record<string, boolean>> {
    const page = await catalog.listStoreSnapshots({
      getCanonicalUrl: (slug, path) => `https://${slug}.example.test${path}`,
      mediaBaseUrl: "https://media.example.test",
    });
    return Object.fromEntries(page.data.map((store) => [store.id, store.bookable]));
  }

  test("a `*` version that refuses: the new stores, by either cutoff, are not bookable", async () => {
    // README §8.3's fail-closed default: a new store needs a card.
    await cache(
      policy("*", 1, DEFAULT_CUTOFF, DEFAULT_CUTOFF, {
        allowed: false,
        reason: "payment_method_required",
      }),
    );
    assert.deepEqual(await bookable(), {
      [LEGACY]: true,
      [BLOCKED]: false,
      [NEW_STORE]: false,
      // New only because the `*` cutoff is earlier than BILLING_NEW_STORES_FROM.
      [BETWEEN]: false,
    });
  });

  test("a later `*` version that allows: the new stores are bookable, the blocked one is not", async () => {
    // A `*` version never takes effect after its newStoresCreatedFrom (README §8.3), so
    // v2 outranks v1 from the same instant.
    await cache(policy("*", 2, DEFAULT_CUTOFF, DEFAULT_CUTOFF, { allowed: true }));
    assert.deepEqual(await bookable(), {
      [LEGACY]: true,
      [BLOCKED]: false,
      [NEW_STORE]: true,
      [BETWEEN]: true,
    });
  });

  test("outside service mode every store is bookable", async () => {
    delete process.env.BILLING_SERVICE_URL;
    try {
      assert.deepEqual(await bookable(), {
        [LEGACY]: true,
        [BLOCKED]: true,
        [NEW_STORE]: true,
        [BETWEEN]: true,
      });
    } finally {
      process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    }
  });
});
