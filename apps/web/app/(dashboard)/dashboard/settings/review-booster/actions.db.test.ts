import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The Review Booster settings are one JSON column that the settings form and
// the message template each patch: saves that run at once keep both.

const STORE = "rb_store_a_000000001";
const SETTINGS = {
  enabled: true,
  googlePlaceId: "place-1",
  googlePlaceName: "Brest Surf",
  googlePlaceAddress: "Brest",
  googleRating: 4.8,
  googleReviewCount: 120,
  displayReviewsOnStorefront: true,
  showReviewPromptInPortal: true,
  autoSendThankYouEmail: true,
  autoSendThankYouSms: false,
  emailDelayHours: 24,
  smsDelayHours: 24,
};

// The session, the plan, Next.js and Google are stubbed; the database is real.
const stubs = {
  "@/lib/store-context": {
    getCurrentStore: async () => ({
      id: STORE,
      slug: "rb-store",
      role: "owner",
      // The request's copy, read before any lock: the writes must not trust it.
      reviewBoosterSettings: SETTINGS,
    }),
    hasPermission: () => true,
  },
  "@/lib/plan-limits": { getStorePlan: async () => ({ features: { reviewBooster: true } }) },
  "@/lib/google-places": { searchPlaces: async () => [], getPlaceDetails: async () => null },
  "next/cache": { revalidatePath: () => undefined },
};
Reflect.set(globalThis, "__louezReviewBoosterStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-review-booster-"));
after(() => rmSync(directory, { recursive: true }));
const fixtures = new Map(
  Object.keys(stubs).map((specifier, index) => {
    const path = join(directory, `stub-${index}.cjs`);
    writeFileSync(
      path,
      `module.exports = globalThis.__louezReviewBoosterStubs[${JSON.stringify(specifier)}];`,
    );
    return [specifier, pathToFileURL(path).href];
  }),
);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const url = fixtures.get(specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});

describe("Review Booster settings writes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");

  before(async () => {
    database = await createTestDatabase("review_booster_writes");
    louezDb = await import("@louez/db");
    actions = await import("./actions");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.stores);
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Review Booster",
      slug: "rb-store",
      reviewBoosterSettings: SETTINGS,
    });
  });

  async function stored() {
    const [row] = await louezDb.db
      .select({ reviewBoosterSettings: louezDb.stores.reviewBoosterSettings })
      .from(louezDb.stores)
      .where(eq(louezDb.stores.id, STORE));
    return row?.reviewBoosterSettings;
  }

  test("the settings form keeps the template saved before it", async () => {
    await actions.updateReviewBoosterTemplate({ subject: "Merci !" });
    assert.deepEqual(
      await actions.updateReviewBoosterSettings({ ...SETTINGS, emailDelayHours: 48 }),
      { success: true },
    );
    const settings = await stored();
    assert.equal(settings?.emailDelayHours, 48);
    assert.equal(settings?.template?.subject, "Merci !");
  });

  test("a template and the settings saved at once keep both", async () => {
    await raceOnLockedRow<unknown>(database, { table: "stores", id: STORE }, [
      () => actions.updateReviewBoosterTemplate({ subject: "Merci !" }),
      () => actions.updateReviewBoosterSettings({ ...SETTINGS, smsDelayHours: 6 }),
    ]);
    const settings = await stored();
    assert.equal(settings?.template?.subject, "Merci !");
    assert.equal(settings?.smsDelayHours, 6);
  });
});
