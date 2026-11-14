import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { NextRequest } from "next/server";

import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { BROWSER_POST, stubHandoffRoutes } from "@/lib/handoffs/test-handoff-routes";

// A person continues a Stripe step from its page (`POST /handoffs/<id>/continue`),
// through the route's own code on a migrated database, posted with the
// headers a browser sends from a hand-off page (`BROWSER_POST`). The step is
// a billing card's: the billing port answers with a Stripe Checkout page.

const CHECKOUT = "https://checkout.stripe.test/c/pay/cs_test_continue";
const started: Array<{ storeId: string; userId: string }> = [];
const routes = stubHandoffRoutes({
  urls: createTestUrls(),
  billing: {
    startCardSetup: async (input: { storeId: string; userId: string }) => {
      started.push({ storeId: input.storeId, userId: input.userId });
      return { ok: true, url: CHECKOUT };
    },
    finishCardSetup: async () => "pending",
  },
});

const APP = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_URL = APP;
process.env.AUTH_SECRET ??= "handoff-continue-test-secret";

const OWNER = "hc_owner_user_000001";
const STORE = "hc_store_a_000000001";
const KEY = "hc_api_key_000000001";

describe("a Stripe step continued from its page (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let handoffs: typeof import("@louez/api/services/handoffs");
  let route: typeof import("./route");

  before(async () => {
    database = await createTestDatabase("handoff_continue_route");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    // packages/api is ES modules: it needs the CommonJS packages' names by
    // hand, before any of its modules loads.
    await import("@louez/mcp/testing/cjs-named-exports");
    handoffs = await import("@louez/api/services/handoffs");
    route = await import("./route");
    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@continue.test" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    for (const table of [louezDb.apiHandoffs, louezDb.apiKeys, louezDb.storeMembers, louezDb.stores]) {
      await db.delete(table);
    }
    started.length = 0;
    routes.signIn(OWNER);
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Roscoff Voile",
      slug: "hc-roscoff",
      onboardingCompleted: true,
    });
    await db.insert(louezDb.storeMembers).values({ storeId: STORE, userId: OWNER, role: "owner" });
    await db.insert(louezDb.apiKeys).values({
      id: KEY,
      storeId: STORE,
      userId: OWNER,
      name: "Store agent",
      keyPrefix: "lz_hc_000001",
      keyHash: "a".repeat(64),
      permissions: {
        reservations: "none",
        products: "none",
        customers: "none",
        categories: "none",
        payments: "none",
        analytics: "none",
        settings: "none",
        team: "none",
        billing: "write",
      },
    });
  });

  /** The agent's billing card step, as its start leaves it. */
  async function cardStep() {
    const { handoff } = await handoffs.issueHandoff(
      {
        storeId: STORE,
        userId: OWNER,
        credentialKind: "api_key",
        credentialId: KEY,
        clientName: "Store agent",
      },
      "billing_card_setup",
      { urls: createTestUrls() },
    );
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, handoff.id));
    assert.ok(row);
    return row;
  }

  const post = (id: string, revision: number, headers: Record<string, string> = BROWSER_POST) =>
    route.POST(
      new NextRequest(new URL(`/handoffs/${id}/continue`, APP), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({ revision: String(revision) }),
      }),
      { params: Promise.resolve({ token: id }) },
    );

  test("the page's own form continues the step to Stripe", async () => {
    const row = await cardStep();
    const response = await post(row.id, row.revision);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), CHECKOUT);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(started, [{ storeId: STORE, userId: OWNER }]);
    const [after] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, row.id));
    assert.equal(after?.status, "opened");
  });

  test("a post naming this app's origin continues too", async () => {
    const row = await cardStep();
    const response = await post(row.id, row.revision, {
      origin: APP,
      "sec-fetch-site": "same-origin",
    });
    assert.equal(response.headers.get("location"), CHECKOUT);
  });

  test("a hidden origin the browser does not vouch for, or another site, starts nothing", async () => {
    const row = await cardStep();
    for (const headers of [
      { origin: "null" },
      { origin: "null", "sec-fetch-site": "cross-site" },
      { origin: "null", "sec-fetch-site": "same-site" },
      { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
      { origin: "https://evil.test" },
    ]) {
      const response = await post(row.id, row.revision, headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
    }
    assert.deepEqual(started, []);
  });
});
