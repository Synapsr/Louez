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

// Whether a store has an agent connection: the dashboard home stops offering
// to connect an assistant once one can act on the store.

const OWNER = "ag_owner_user_000001";
const MEMBER = "ag_member_user_00001";
const FORMER = "ag_former_user_00001";
const STORE = "ag_store_a_000000001";
const OTHER_STORE = "ag_store_b_000000001";
const CLIENT = "https://claude.ag.test/oauth/client.json";
const GRANT = "ag_grant_00000000001";

describe("store agent connection (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let grants: typeof import("./agent-grants");

  before(async () => {
    database = await createTestDatabase("api_agent_grants");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    grants = await import("./agent-grants");

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ag.test" },
      { id: MEMBER, email: "member@ag.test" },
      { id: FORMER, email: "former@ag.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "ag-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "ag-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: "Claude",
      redirectUris: JSON.stringify(["https://client.ag.test/callback"]),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.apiAgentGrants);
    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ disabled: false })
      .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
  });

  const grant = async (userId: string, stores: "all" | string[]) => {
    await louezDb.db.insert(louezDb.apiAgentGrants).values({
      id: GRANT,
      userId,
      clientId: CLIENT,
      allStores: stores === "all",
      preset: "write",
      bundles: ["daily"],
    });
    if (stores !== "all" && stores.length > 0) {
      await louezDb.db
        .insert(louezDb.apiAgentGrantStores)
        .values(stores.map((storeId) => ({ grantId: GRANT, storeId })));
    }
  };

  test("a store without any grant has none", async () => {
    assert.equal(await grants.storeHasAgentConnection(STORE), false);
  });

  test("a member's grant over all their stores covers the store", async () => {
    await grant(MEMBER, "all");
    assert.equal(await grants.storeHasAgentConnection(STORE), true);
  });

  test("a grant names the store, or leaves it out", async () => {
    await grant(OWNER, [OTHER_STORE]);
    assert.equal(await grants.storeHasAgentConnection(STORE), false);
    assert.equal(await grants.storeHasAgentConnection(OTHER_STORE), true);
  });

  test("a grant of someone who is not a member does not count", async () => {
    await grant(FORMER, "all");
    assert.equal(await grants.storeHasAgentConnection(STORE), false);
  });

  test("a disabled client does not count", async () => {
    await grant(OWNER, "all");
    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ disabled: true })
      .where(orm.eq(louezDb.oauthClients.clientId, CLIENT));
    assert.equal(await grants.storeHasAgentConnection(STORE), false);
  });
});
