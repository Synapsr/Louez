import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { call } from "@orpc/server";
import { MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";

process.env.SKIP_ENV_VALIDATION = "true";

// These workspace packages are CommonJS under Node; preserve their real
// exports when the ESM mock loader resolves the router's named imports.
for (const name of ["@louez/utils", "@louez/validations"]) {
  const actual = await import(name);
  mock.module(name, { namedExports: actual.default ?? actual });
}

const stores = mysqlTable("stores", { id: varchar("id", { length: 21 }) });
const dialect = new MySqlDialect();
const queries = [];
const writes = [];
let session = { user: { id: "user-a" } };
const currentSettings = {
  reservationMode: "request",
  advanceNoticeMinutes: 60,
  seo: { googleSiteVerification: "existing-owner-token" },
};
const db = {
  query: {
    stores: {
      findFirst: async ({ where }) => {
        queries.push(dialect.sqlToQuery(where).params);
        return { settings: structuredClone(currentSettings), theme: null };
      },
    },
  },
  update: (table) => {
    assert.equal(table, stores);
    return {
      set: (data) => ({
        where: async (where) => {
          writes.push({ data, params: dialect.sqlToQuery(where).params });
        },
      }),
    };
  },
};

mock.module("@louez/auth", { namedExports: { auth: async () => session } });
mock.module("@louez/db", { namedExports: { db, stores } });
mock.module(new URL("../../services/availability.ts", import.meta.url).href, {
  namedExports: { createAvailabilityMemo: () => new Map() },
});

const { dashboardOnlineStoreRouter } = await import("./online-store.ts");

const contextFor = (role) => ({
  headers: new Headers(),
  getCurrentStore: async () => ({ id: "store-a", slug: "store-a", role }),
});

afterEach(() => {
  queries.length = 0;
  writes.length = 0;
  session = { user: { id: "user-a" } };
});

test("members cannot add, replace or clear a Google ownership token", async () => {
  for (const token of ["new-owner-token", "existing-owner-token", ""]) {
    await assert.rejects(
      call(
        dashboardOnlineStoreRouter.update,
        { seo: { googleSiteVerification: token } },
        { context: contextFor("member") },
      ),
      { code: "FORBIDDEN", message: "errors.permissionDenied" },
    );
  }
  assert.deepEqual(queries, []);
  assert.deepEqual(writes, []);
});

test("owners and platform admins can save a validated token only on their active store", async () => {
  for (const role of ["owner", "platform_admin"]) {
    const result = await call(
      dashboardOnlineStoreRouter.update,
      {
        storeId: "another-store",
        seo: {
          googleSiteVerification:
            '<meta name="google-site-verification" content="new-owner-token" />',
        },
      },
      { context: contextFor(role) },
    );
    assert.deepEqual(result, { success: true });
    assert.deepEqual(queries.at(-1), ["store-a"]);
    assert.deepEqual(writes.at(-1).params, ["store-a"]);
    assert.deepEqual(writes.at(-1).data.settings, {
      ...currentSettings,
      seo: { googleSiteVerification: "new-owner-token" },
    });
  }
});

test("clearing the token stores null without changing other settings", async () => {
  await call(
    dashboardOnlineStoreRouter.update,
    { seo: { googleSiteVerification: "  " } },
    { context: contextFor("owner") },
  );
  assert.deepEqual(writes[0].data.settings, {
    ...currentSettings,
    seo: { googleSiteVerification: null },
  });
});

test("members cannot bypass store management permissions with an image-only update", async () => {
  await assert.rejects(
    call(
      dashboardOnlineStoreRouter.update,
      { seo: { shareImageUrl: null } },
      { context: contextFor("member") },
    ),
    { code: "FORBIDDEN", message: "errors.permissionDenied" },
  );
  assert.deepEqual(queries, []);
  assert.deepEqual(writes, []);
});

test("owners can change the share image without clearing their Google token", async () => {
  await call(
    dashboardOnlineStoreRouter.update,
    { seo: { shareImageUrl: null } },
    { context: contextFor("owner") },
  );
  assert.deepEqual(writes[0].data.settings, currentSettings);
  assert.equal(writes[0].data.theme.shareImageUrl, null);
});

test("invalid tokens never reach persistence, including for owners", async () => {
  for (const token of ['"><script>alert(1)</script>', "token with spaces", "x".repeat(201), null]) {
    await assert.rejects(
      call(
        dashboardOnlineStoreRouter.update,
        { seo: { googleSiteVerification: token } },
        { context: contextFor("owner") },
      ),
      { code: "BAD_REQUEST" },
    );
  }
  assert.deepEqual(writes, []);
});

test("unauthenticated users and users without store access cannot save", async () => {
  session = null;
  await assert.rejects(
    call(dashboardOnlineStoreRouter.update, {}, { context: contextFor("owner") }),
    { code: "UNAUTHORIZED" },
  );
  session = { user: { id: "user-a" } };
  await assert.rejects(
    call(
      dashboardOnlineStoreRouter.update,
      {},
      {
        context: { headers: new Headers(), getCurrentStore: async () => null },
      },
    ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(writes, []);
});
