import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// The "Se faire connaître" guide: a step's status is one row per store and
// step, and the visits are the sessions a marked link brought.

const STORE = "vis_store_0000000001";
const OTHER_STORE = "vis_store_0000000002";
const USER = "vis_user_00000000001";

describe("visibility guide (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let service: typeof import("./visibility");

  before(async () => {
    database = await createTestDatabase("api_visibility");
    louezDb = await import("@louez/db");
    service = await import("./visibility");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.storeVisibilitySteps);
    await louezDb.db.delete(louezDb.pageViews);
  });

  test("a step is to do, then done, skipped, and reopened", async () => {
    const statusOf = async () =>
      (await service.getVisibility(STORE)).steps.find((step) => step.key === "qr_poster")?.status;

    assert.equal(await statusOf(), "todo");

    await service.setVisibilityStep({ storeId: STORE, userId: USER, step: "qr_poster", status: "done" });
    assert.equal(await statusOf(), "done");

    // Twice is the same row, its status changed.
    await service.setVisibilityStep({
      storeId: STORE,
      userId: USER,
      step: "qr_poster",
      status: "skipped",
    });
    assert.equal(await statusOf(), "skipped");
    const rows = await louezDb.db.select().from(louezDb.storeVisibilitySteps);
    assert.equal(rows.length, 1);

    await service.setVisibilityStep({ storeId: STORE, userId: USER, step: "qr_poster", status: "todo" });
    assert.equal(await statusOf(), "todo");
  });

  test("another store's steps are not this one's", async () => {
    await service.setVisibilityStep({
      storeId: OTHER_STORE,
      userId: USER,
      step: "share_contacts",
      status: "done",
    });
    const view = await service.getVisibility(STORE);
    assert.ok(view.steps.every((step) => step.status === "todo"));
  });

  test("visits count the sessions of each source, in the window, for this store", async () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const recent = new Date("2026-11-17T12:00:00Z");
    const old = new Date("2026-10-01T12:00:00Z");
    const view = (sessionId: string, source: string | null, createdAt: Date, storeId = STORE) => ({
      storeId,
      sessionId,
      page: "home" as const,
      source,
      createdAt,
    });
    await louezDb.db.insert(louezDb.pageViews).values([
      // Two pages of one QR visit count once.
      view("00000000-0000-4000-8000-000000000001", "qr", recent),
      view("00000000-0000-4000-8000-000000000001", "qr", recent),
      view("00000000-0000-4000-8000-000000000002", "qr", recent),
      view("00000000-0000-4000-8000-000000000003", "whatsapp", recent),
      // Not counted: no source, too old, another store, unknown source.
      view("00000000-0000-4000-8000-000000000004", null, recent),
      view("00000000-0000-4000-8000-000000000005", "qr", old),
      view("00000000-0000-4000-8000-000000000006", "qr", recent, OTHER_STORE),
      view("00000000-0000-4000-8000-000000000007", "tiktok", recent),
    ]);

    const { visits } = await service.getVisibility(STORE, now);
    assert.deepEqual(visits, {
      total: 3,
      bySource: [
        { source: "qr", visits: 2 },
        { source: "whatsapp", visits: 1 },
      ],
    });
  });
});
