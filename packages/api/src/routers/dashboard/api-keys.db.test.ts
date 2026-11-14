import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ApiKeyPermissions } from "@louez/db/schema";
import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";

import { API_KEY_PERMISSION_PRESETS } from "../../contracts/api-keys";
import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "api-keys-test-secret";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ak.test` } } : null;
        },
      },
    },
  },
});

// A key made from the dashboard's form, through the procedure the form calls,
// reaches what its rights say on the REST API.

const OWNER = "ak_owner_user_000001";
const STORE = "ak_store_a_000000001";

describe("API keys made from the dashboard (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let router: typeof import("./index").dashboardRouter;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_keys_form");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    ({ dashboardRouter: router } = await import("./index"));

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@ak.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Key store", slug: "ak-key-store" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const session = (): BaseContext => ({
    headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
    transport: "rpc",
    ports,
    receipt: {},
  });
  const bearer = (key: string): BaseContext => ({
    headers: new Headers({ authorization: `Bearer ${key}` }),
    transport: "openapi",
    ports,
    receipt: {},
  });
  const client = (context: BaseContext) =>
    orpc.createRouterClient(router, { context, path: ["dashboard"] }) as RouterClient<
      typeof router
    >;

  async function keyFromForm(name: string, permissions: ApiKeyPermissions) {
    const { key } = await client(session()).apiKeys.create({ name, permissions });
    return client(bearer(key));
  }

  async function deniedPermission(promise: Promise<unknown>) {
    await assert.rejects(promise, (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, "PERMISSION_DENIED");
      return true;
    });
  }

  test("a full-access key reads the team, the billing and the online store", async () => {
    const api = await keyFromForm("Full access", API_KEY_PERMISSION_PRESETS.full);

    const members = await api.team.listMembers({});
    assert.deepEqual(
      members.items.map((member) => member.userId),
      [OWNER],
    );
    const billing = await api.billing.getStatus({});
    assert.equal(billing.billing, "none");
    const slug = await api.onlineStore.checkSlugAvailability({ slug: "ak-free-slug" });
    assert.equal(slug.available, true);
  });

  test("a key that holds reservations only is refused the team, the billing and the online store", async () => {
    const api = await keyFromForm("Reservations only", {
      reservations: "write",
      products: "none",
      customers: "none",
      categories: "none",
      payments: "none",
      analytics: "none",
      settings: "none",
    });

    await deniedPermission(api.team.listMembers({}));
    await deniedPermission(api.billing.getStatus({}));
    await deniedPermission(api.onlineStore.checkSlugAvailability({ slug: "ak-free-slug" }));
    await api.reservations.list({});
  });
});
