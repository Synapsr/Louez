import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { NextRequest } from "next/server";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { activeStoreSwitchPath } from "@/lib/util.active-store-link";

// A dashboard link that names its store, on a migrated database: the real
// store switcher's check, with the session and the cookie jar stubbed. A GET
// never switches; only the confirmation's same-origin POST does.

const MEMBER = "user_active_store_mbr";
const OUTSIDER = "user_active_store_out";
const STORE_A = "active_store_a_000001"; // 21 characters, as store ids are
const STORE_B = "active_store_b_000001";
const UNKNOWN = "active_store_x_000001";
const COOKIE = "louez_active_store";

let currentUserId: string | null = null;
const jar = new Map<string, string>();

const stubs = {
  "@/lib/auth": {
    auth: async () => (currentUserId ? { user: { id: currentUserId, email: "" } } : null),
  },
  "next/headers": {
    cookies: async () => ({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: (name: string, value: string) => jar.set(name, value),
      delete: (name: string) => jar.delete(name),
    }),
    headers: async () => new Headers(),
  },
};
Reflect.set(globalThis, "__louezActiveStoreStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-active-store-"));
after(() => rmSync(directory, { recursive: true }));
const fixtures = new Map(
  Object.keys(stubs).map((specifier, index) => {
    const path = join(directory, `stub-${index}.cjs`);
    writeFileSync(
      path,
      `module.exports = globalThis.__louezActiveStoreStubs[${JSON.stringify(specifier)}];`,
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

const APP = "https://app.louez.test";
const SAME_ORIGIN = { origin: APP, "sec-fetch-site": "same-origin" };

process.env.LOUEZ_MODE = "platform";
process.env.NEXT_PUBLIC_APP_URL = APP;

describe(
  "dashboard links that name their store (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let route: typeof import("./route");

    before(async () => {
      database = await createTestDatabase("active_store_links");
      louezDb = await import("@louez/db");
      route = await import("./route");
      await louezDb.db.insert(louezDb.users).values([
        { id: MEMBER, email: "member@active-store.test" },
        { id: OUTSIDER, email: "outsider@active-store.test" },
      ]);
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE_A, userId: MEMBER, name: "Store A", slug: "active-store-a" },
        { id: STORE_B, userId: MEMBER, name: "Store B", slug: "active-store-b" },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE_A, userId: MEMBER, role: "owner" },
        { storeId: STORE_B, userId: MEMBER, role: "member" },
        { storeId: STORE_A, userId: OUTSIDER, role: "member" },
      ]);
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      jar.clear();
      currentUserId = null;
    });

    /** The browser follows a dashboard link: the proxy hands it to the route. */
    async function follow(link: string) {
      const target = activeStoreSwitchPath(new URL(link, APP));
      assert.ok(target, `${link} names a store`);
      const response = await route.GET(new NextRequest(new URL(target, APP)));
      assert.equal(response.status, 307);
      return response.headers.get("location") ?? "";
    }

    /** The confirmation page's form, posted with these headers. */
    async function post(
      store: string,
      next: string,
      headers: Record<string, string> = SAME_ORIGIN,
    ) {
      return route.POST(
        new NextRequest(new URL("/api/active-store", APP), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
          body: new URLSearchParams({ store, next }),
        }),
      );
    }

    test("a GET never switches: another store of the member goes to the confirmation page", async () => {
      currentUserId = MEMBER;
      jar.set(COOKIE, STORE_A);
      const location = await follow(`/dashboard/products/p1?tab=units&store=${STORE_B}`);
      const confirm = new URL(location, APP);
      assert.equal(confirm.pathname, "/active-store");
      assert.equal(confirm.searchParams.get("store"), STORE_B);
      assert.equal(confirm.searchParams.get("next"), "/dashboard/products/p1?tab=units");
      assert.equal(jar.get(COOKIE), STORE_A);
    });

    test("the active store itself goes straight to the URL without the parameter", async () => {
      currentUserId = MEMBER;
      jar.set(COOKIE, STORE_B);
      assert.equal(await follow(`/dashboard/categories?store=${STORE_B}`), "/dashboard/categories");
      assert.equal(jar.get(COOKIE), STORE_B);
    });

    test("a store the user is not a member of, or that does not exist, changes nothing and answers the same", async () => {
      currentUserId = OUTSIDER;
      jar.set(COOKIE, STORE_A);
      const notMember = await follow(`/dashboard/reservations/r1?store=${STORE_B}`);
      const unknown = await follow(`/dashboard/reservations/r1?store=${UNKNOWN}`);
      assert.equal(notMember, "/dashboard/reservations/r1");
      assert.equal(unknown, notMember);
      assert.equal(jar.get(COOKIE), STORE_A);
    });

    test("only a member's other store asks for a confirmation", async () => {
      const { getStoreSwitchState } = await import("@/lib/store-context");
      currentUserId = MEMBER;
      jar.set(COOKIE, STORE_A);
      assert.deepEqual(await getStoreSwitchState(STORE_B), {
        kind: "confirm",
        target: { id: STORE_B, name: "Store B" },
        current: { id: STORE_A, name: "Store A" },
      });
      assert.deepEqual(await getStoreSwitchState(STORE_A), { kind: "stay" });
      assert.deepEqual(await getStoreSwitchState(UNKNOWN), { kind: "stay" });
      currentUserId = OUTSIDER;
      assert.deepEqual(await getStoreSwitchState(STORE_B), { kind: "stay" });
      currentUserId = null;
      assert.deepEqual(await getStoreSwitchState(STORE_B), { kind: "signed-out" });
    });

    test("a confirmed POST from the app switches a member, then drops the parameter", async () => {
      currentUserId = MEMBER;
      jar.set(COOKIE, STORE_A);
      const response = await post(STORE_B, `/dashboard/products/p1?store=${STORE_B}`);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/dashboard/products/p1");
      assert.equal(jar.get(COOKIE), STORE_B);
    });

    test("a POST from another site, or without an Origin, is refused", async () => {
      currentUserId = MEMBER;
      jar.set(COOKIE, STORE_A);
      const refused: Array<Record<string, string>> = [
        { origin: "https://evil.test" },
        { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
        { origin: APP, "sec-fetch-site": "cross-site" },
        { origin: APP, "sec-fetch-site": "same-site" },
        { origin: "null" },
        {},
      ];
      for (const headers of refused) {
        const response = await post(STORE_B, "/dashboard", headers);
        assert.equal(response.status, 403, JSON.stringify(headers));
      }
      assert.equal(jar.get(COOKIE), STORE_A);
    });

    test("a POST for a store the user may not open, or an unknown one, changes nothing and answers the same", async () => {
      currentUserId = OUTSIDER;
      jar.set(COOKIE, STORE_A);
      const notMember = await post(STORE_B, "/dashboard/customers/c1");
      const unknown = await post(UNKNOWN, "/dashboard/customers/c1");
      assert.equal(notMember.status, 303);
      assert.equal(unknown.status, 303);
      assert.equal(notMember.headers.get("location"), "/dashboard/customers/c1");
      assert.equal(unknown.headers.get("location"), notMember.headers.get("location"));
      assert.equal(jar.get(COOKIE), STORE_A);
    });

    test("the way back stays on the dashboard and never keeps the store", async () => {
      currentUserId = OUTSIDER;
      for (const [next, expected] of [
        ["https://evil.test/dashboard", "/dashboard"],
        ["//evil.test/dashboard", "/dashboard"],
        ["/login", "/dashboard"],
        [`/dashboard/customers/c1?store=${STORE_A}`, "/dashboard/customers/c1"],
      ]) {
        const query = new URLSearchParams({ store: STORE_B, next });
        const response = await route.GET(
          new NextRequest(new URL(`/api/active-store?${query}`, APP)),
        );
        assert.equal(response.headers.get("location"), expected, next);
        assert.equal((await post(STORE_B, next)).headers.get("location"), expected, next);
      }
    });

    test("signed out, the user signs in first, then confirms on the way back", async () => {
      jar.set(COOKIE, STORE_A);
      const link = `/dashboard/products/p1?store=${STORE_B}`;
      const toLogin = new URL(await follow(link), APP);
      assert.equal(toLogin.pathname, "/login");
      const callback = toLogin.searchParams.get("callbackUrl") ?? "";
      assert.equal(callback, link);

      // Signed in, the login page sends the browser to the callback.
      currentUserId = MEMBER;
      const confirm = new URL(await follow(callback), APP);
      assert.equal(confirm.pathname, "/active-store");
      assert.equal(jar.get(COOKIE), STORE_A);
      const confirmed = await post(
        confirm.searchParams.get("store") ?? "",
        confirm.searchParams.get("next") ?? "",
      );
      assert.equal(confirmed.headers.get("location"), "/dashboard/products/p1");
      assert.equal(jar.get(COOKIE), STORE_B);
    });
  },
);
