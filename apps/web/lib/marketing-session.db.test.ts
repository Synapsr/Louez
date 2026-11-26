import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// `/api/marketing/session` on the database: whether a browser belongs to someone with a
// Louez account, from its session or the dashboard's active store cookie, a demo
// visitor's never counting, and only two booleans in the answer.

const OWNER = "user_mkt_session_own";
const OWNER_EMAIL = "owner@marketing-session.test";
const DEMO_OWNER = "user_mkt_session_demo";
const DEMO_OWNER_EMAIL = "visiteur-mktsession@demo.example";
const STORE = "store_mkt_session_01";
const DEMO_STORE = "store_mkt_session_02";

describe("marketing session (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let marketingSession: typeof import("./marketing-session");

  before(async () => {
    database = await createTestDatabase("marketing_session");
    louezDb = await import("@louez/db");
    marketingSession = await import("./marketing-session");
    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: OWNER_EMAIL },
      { id: DEMO_OWNER, email: DEMO_OWNER_EMAIL },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Kayaks", slug: "mkt-session" },
      {
        id: DEMO_STORE,
        userId: DEMO_OWNER,
        name: "Ski démo",
        slug: "mkt-session-demo",
        demoVertical: "ski",
        demoExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        demoClaimedAt: new Date(),
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** The endpoint's answer, its session lookup given (Better Auth's, in the route). */
  const answer = async (
    session: { user: { id: string; email: string } } | null,
    cookie?: string,
  ) => {
    const response = await marketingSession.marketingSessionResponse(
      new Request("https://app.louez.io/api/marketing/session", {
        headers: { origin: "https://louez.io", ...(cookie ? { cookie } : {}) },
      }),
      marketingSession.marketingOrigins("https://app.louez.io"),
      () => marketingSession.readMarketingSession(louezDb.db, session, cookie ?? null),
      () => assert.fail("Unexpected error"),
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    for (const identifier of [
      OWNER,
      OWNER_EMAIL,
      DEMO_OWNER,
      DEMO_OWNER_EMAIL,
      STORE,
      DEMO_STORE,
    ]) {
      assert.equal(body.includes(identifier), false, `the answer carries ${identifier}`);
    }
    const parsed: unknown = JSON.parse(body);
    return parsed;
  };

  test("a signed-in session has an account", async () => {
    assert.deepEqual(await answer({ user: { id: OWNER, email: OWNER_EMAIL } }), {
      authenticated: true,
      hasAccount: true,
    });
  });

  test("signed out, the active store cookie of a real store has an account", async () => {
    assert.deepEqual(await answer(null, `theme=dark; louez_active_store=${STORE}`), {
      authenticated: false,
      hasAccount: true,
    });
  });

  test("a demo visitor has none, signed in to the demo account or not", async () => {
    const cookie = `louez_active_store=${DEMO_STORE}`;
    assert.deepEqual(await answer(null, cookie), { authenticated: false, hasAccount: false });
    assert.deepEqual(await answer({ user: { id: DEMO_OWNER, email: DEMO_OWNER_EMAIL } }, cookie), {
      authenticated: true,
      hasAccount: false,
    });
  });

  test("nothing, a store that does not exist or a malformed cookie has none", async () => {
    assert.deepEqual(await answer(null), { authenticated: false, hasAccount: false });
    for (const cookie of [
      "louez_active_store=store_mkt_session_99",
      "louez_active_store=",
      `louez_active_store=${STORE}' OR '1'='1`,
      `louez_active_store=${STORE}${STORE}`,
    ]) {
      assert.deepEqual(await answer(null, cookie), { authenticated: false, hasAccount: false });
    }
  });
});
