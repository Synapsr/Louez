import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A demo store (packages/db demo-stores.ts) is never on the reeent marketplace: not in
// the public catalog feed even with a published channel, never a default publication
// candidate, and its owner cannot publish it.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/utils/sanitize-rich-text"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const DEMO = "mkt_demo";
const REAL = "mkt_real";

describe("demo stores and the marketplace (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let catalog: typeof import("./catalog");
  let channel: typeof import("./marketplace-channel");

  before(async () => {
    database = await createTestDatabase("demo_marketplace");
    louezDb = await import("@louez/db");
    catalog = await import("./catalog");
    channel = await import("./marketplace-channel");
    const createdAt = new Date(Date.now() - 30 * 86_400_000);
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: DEMO,
        userId: "owner_demo",
        name: DEMO,
        slug: "mkt-demo",
        onboardingCompleted: true,
        demoVertical: "ski",
        demoExpiresAt: new Date(Date.now() + 86_400_000),
        createdAt,
      },
      {
        id: REAL,
        userId: "owner_real",
        name: REAL,
        slug: "mkt-real",
        onboardingCompleted: true,
        createdAt,
      },
    ]);
    await louezDb.db.insert(louezDb.storeMarketplaceChannels).values(
      [DEMO, REAL].map((storeId) => ({
        id: `channel_${storeId}`,
        storeId,
        enabledByOwner: true,
        status: "published" as const,
        publishedAt: new Date(Date.now() - 86_400_000),
      })),
    );
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("the catalog feed lists the real store only", async () => {
    const page = await catalog.listStoreSnapshots({
      getCanonicalUrl: (slug, path) => `https://${slug}.example.test${path}`,
      mediaBaseUrl: "https://media.example.test",
    });
    assert.deepEqual(
      page.data.map((store) => store.id),
      [REAL],
    );
  });

  test("a demo store is never a default publication candidate", async () => {
    await louezDb.db
      .update(louezDb.storeMarketplaceChannels)
      .set({ status: "setup_required", publishedAt: null });
    const candidates = await channel.listMarketplaceDefaultPublicationCandidates();
    assert.ok(candidates.some((candidate) => candidate.storeId === REAL));
    assert.ok(!candidates.some((candidate) => candidate.storeId === DEMO));
  });

  test("a demo store's owner cannot publish it", async () => {
    await assert.rejects(
      channel.enableMarketplaceChannel({
        storeId: DEMO,
        source: "owner",
        connectedByUserId: "owner_demo",
        input: { acceptTerms: true } as never,
      }),
      (error: unknown) =>
        error instanceof Error && error.message === "errors.demoStoreActionDisabled",
    );
  });
});
