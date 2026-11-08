import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "product-variants-test-secret";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
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
          return id ? { user: { id, email: `${id}@pv.test` } } : null;
        },
      },
    },
  },
});

// The store's variant catalog through the products procedures, on the
// database: the dashboard's session and an agent's API key.

const OWNER = "pv_owner_user_000001";
const MEMBER = "pv_member_user_00001";
const STORE = "pv_store_a_000000001";
const OTHER_STORE = "pv_store_b_000000001";

describe("product variants procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./products").dashboardProductsRouter;

  const events: ApiEvent[] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_product_variants");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardProductsRouter: router } = await import("./products"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@pv.test" },
      { id: MEMBER, email: "member@pv.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "pv-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "pv-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    events.length = 0;
    await louezDb.db.delete(louezDb.variantValues);
    await louezDb.db.delete(louezDb.variantDefinitions);
    await louezDb.db.delete(louezDb.productUnitEvents);
    await louezDb.db.delete(louezDb.productUnits);
    await louezDb.db.delete(louezDb.products);
  });

  // --- Callers --------------------------------------------------------------

  function session(userId = OWNER, store = STORE) {
    return {
      headers: new Headers({ [SESSION_HEADER]: userId, cookie: `louez_active_store=${store}` }),
      transport: "rpc" as const,
      ports,
      receipt: {},
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const readWrite: Permissions = {
    reservations: "read",
    products: "write",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function apiKey(options: { permissions?: Permissions; storeId?: string } = {}) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: OWNER,
      name: "Variants agent",
      permissions: options.permissions ?? readWrite,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "products"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as { data: { code: string; details?: Record<string, unknown> } };
  }

  const tokenOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { confirmationToken: string }).confirmationToken;
  const previewOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (
      refusal.data.details as {
        preview: { summary: string; details: { products?: Array<{ name: string }> } };
      }
    ).preview;

  const SIZE = { label: "Taille", kind: "size" as const, values: [{ label: "S" }, { label: "M" }] };

  /** A product booked by size, whose units carry a size. */
  async function sizedProduct(name: string, sizeKey: string, storeId = STORE) {
    return run(
      "create",
      {
        name,
        price: "20",
        trackUnits: true,
        bookingAttributeAxes: [{ key: sizeKey, label: "Taille", position: 0 }],
        units: [
          { identifier: `${name}-S`, attributes: { [sizeKey]: "S" } },
          { identifier: `${name}-M`, attributes: { [sizeKey]: "M" } },
        ],
      },
      session(OWNER, storeId),
    );
  }

  // --- Catalog --------------------------------------------------------------

  test("a variant is created once by its key, with its first values; the list pages with a cursor", async () => {
    const context = await apiKey();
    const created = await run("ensureVariantDefinition", SIZE, context());
    assert.equal(created.created, true);
    assert.equal(created.key, "taille");
    assert.deepEqual(
      created.values.map((value) => value.label),
      ["S", "M"],
    );
    const again = await run(
      "ensureVariantDefinition",
      { ...SIZE, values: [{ label: "XL" }] },
      context(),
    );
    assert.equal(again.created, false);
    assert.equal(again.id, created.id);
    assert.equal(again.values.length, 2, "values are only added to a variant without any");

    await run("ensureVariantDefinition", { label: "Couleur", kind: "color" }, session(MEMBER));
    const first = await run("listVariants", { limit: 1 }, context());
    assert.deepEqual(
      first.items.map((item) => item.label),
      ["Taille"],
    );
    assert.ok(first.nextCursor);
    const second = await run("listVariants", { limit: 1, cursor: first.nextCursor }, context());
    assert.deepEqual(
      second.items.map((item) => item.label),
      ["Couleur"],
    );
    assert.equal(second.nextCursor, null);
    await rejects(run("listVariants", { cursor: "nope" }, context()), "INVALID_CURSOR");
  });

  test("rename, switch off, and values: one per label, changed in part, no duplicates", async () => {
    const created = await run("ensureVariantDefinition", SIZE, session());
    const renamed = await run(
      "updateVariantDefinition",
      { id: created.id, label: "Size" },
      session(MEMBER),
    );
    assert.equal(renamed.label, "Size");
    assert.equal(renamed.key, "taille", "the key stays");
    assert.deepEqual(
      await run("setVariantDefinitionActive", { id: created.id, isActive: false }, session()),
      { id: created.id, isActive: false },
    );

    const xl = await run(
      "createVariantValue",
      { definitionId: created.id, label: "XL", colorHex: "#112233" },
      session(),
    );
    assert.equal(xl.created, true);
    const same = await run(
      "createVariantValue",
      { definitionId: created.id, label: "xl", colorHex: "#445566" },
      session(),
    );
    assert.equal(same.created, false);
    assert.equal(same.id, xl.id);
    assert.equal(same.colorHex, "#445566", "the color sent is kept");

    const recolored = await run("updateVariantValue", { id: xl.id, colorHex: null }, session());
    assert.equal(recolored.colorHex, null);
    assert.equal(recolored.label, "XL", "a field left out is unchanged");
    await rejects(
      run("updateVariantValue", { id: xl.id, label: "m" }, session()),
      "VARIANT_VALUE_EXISTS",
    );
  });

  test("a store holds a bounded catalog", async () => {
    await louezDb.db.insert(louezDb.variantDefinitions).values(
      Array.from({ length: 100 }, (_, index) => ({
        storeId: STORE,
        key: `v${index}`,
        label: `Variant ${index}`,
        position: index,
      })),
    );
    await rejects(
      run("ensureVariantDefinition", { label: "One more" }, session()),
      "VARIANT_LIMIT_REACHED",
    );
    const existing = await run(
      "ensureVariantDefinition",
      { label: "Variant 3", key: "v3" },
      session(),
    );
    assert.equal(existing.created, false, "an existing variant is still returned");
    const page = await run("listVariants", {}, session());
    assert.equal(page.items.length, 100);
    assert.equal(page.nextCursor, null);
  });

  // --- Usage, withdrawal, deletion -----------------------------------------

  test("usage counts axes and unit values; deleting a used variant is refused and names the products", async () => {
    const size = await run("ensureVariantDefinition", SIZE, session());
    const kayak = await sizedProduct("Kayak", "taille");
    // Units that carry a size without the product declaring it count too
    // (products saved before axes existed).
    const board = await run(
      "create",
      { name: "Board", price: "10", trackUnits: true, units: [{ identifier: "B-1" }] },
      session(),
    );
    await louezDb.db
      .update(louezDb.productUnits)
      .set({ attributes: { taille: "S" } })
      .where(orm.eq(louezDb.productUnits.productId, board.id));
    await run("create", { name: "Paddle", price: "5" }, session());

    const usage = await run("getVariantUsage", { definitionId: size.id }, session());
    assert.deepEqual(usage.items, [
      {
        definitionId: size.id,
        productCount: 2,
        // Each with its dashboard page.
        products: [board, kayak].map((product) => ({
          id: product.id,
          name: product.name,
          links: { dashboard: `${TEST_APP_URL}/dashboard/products/${product.id}?store=${STORE}` },
        })),
      },
    ]);

    const refused = await rejects(
      run("deleteVariantDefinition", { id: size.id }, session()),
      "VARIANT_IN_USE",
    );
    assert.equal(refused.data.details?.productCount, 2);
  });

  test("an agent's withdrawal names the products it changes; a product changed since voids the token", async () => {
    const size = await run("ensureVariantDefinition", SIZE, session());
    const kayak = await sizedProduct("Kayak", "taille");
    const context = await apiKey();

    const asked = await rejects(
      run("withdrawVariantFromProducts", { id: size.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(
      previewOf(asked).details.products?.map((product) => product.name),
      ["Kayak"],
    );
    await sizedProduct("Canoe", "taille");
    await rejects(
      run(
        "withdrawVariantFromProducts",
        { id: size.id },
        context({ "louez-confirmation": tokenOf(asked) }),
      ),
      "CONFIRMATION_INVALID",
    );

    const again = await rejects(
      run("withdrawVariantFromProducts", { id: size.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    events.length = 0;
    const withdrawn = await run(
      "withdrawVariantFromProducts",
      { id: size.id },
      context({ "louez-confirmation": tokenOf(again) }),
    );
    assert.deepEqual(withdrawn, { id: size.id, affectedProductCount: 2 });
    assert.deepEqual(
      events.map((event) => event.type),
      ["products.changed"],
    );
    const stored = await run("get", { id: kayak.id }, session());
    assert.deepEqual(stored.bookingAttributeAxes, []);
    assert.deepEqual(
      stored.units.map((unit) => unit.attributes),
      [{}, {}],
    );

    // No product uses it any more: deleting asks, then deletes it and its values.
    await rejects(
      run("deleteVariantDefinition", { id: size.id }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    const deletion = await rejects(
      run("deleteVariantDefinition", { id: size.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.match(previewOf(deletion).summary, /Delete the variant "Taille" and its 2 value\(s\)/);
    await run(
      "deleteVariantDefinition",
      { id: size.id },
      context({ "louez-confirmation": tokenOf(deletion) }),
    );
    assert.deepEqual((await run("listVariants", {}, session())).items, []);
    assert.equal((await louezDb.db.select().from(louezDb.variantValues)).length, 0);
  });

  test("deleting a value asks an agent, names the products whose units carry it, and leaves them their value", async () => {
    const size = await run("ensureVariantDefinition", SIZE, session());
    const kayak = await sizedProduct("Kayak", "taille");
    const small = size.values.find((value) => value.label === "S");
    assert.ok(small);
    const context = await apiKey();

    await rejects(
      run("deleteVariantValue", { id: small.id }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    const asked = await rejects(
      run("deleteVariantValue", { id: small.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.deepEqual(
      previewOf(asked).details.products?.map((product) => product.name),
      ["Kayak"],
    );
    assert.deepEqual(
      await run(
        "deleteVariantValue",
        { id: small.id },
        context({ "louez-confirmation": tokenOf(asked) }),
      ),
      { id: small.id },
    );
    const [variant] = (await run("listVariants", {}, session())).items;
    assert.deepEqual(
      variant.values.map((value) => value.label),
      ["M"],
    );
    const stored = await run("get", { id: kayak.id }, session());
    assert.ok(
      stored.units.some((unit) => unit.attributes.taille === "S"),
      "units keep the value",
    );
  });

  // --- Isolation and rights -------------------------------------------------

  test("another store's variants and values are not found; a read-only key reads only", async () => {
    const theirs = await run("ensureVariantDefinition", SIZE, session(OWNER, OTHER_STORE));
    const [value] = theirs.values;
    const mine = await apiKey();
    assert.deepEqual((await run("listVariants", {}, mine())).items, []);
    await rejects(run("getVariantUsage", { definitionId: theirs.id }, mine()), "VARIANT_NOT_FOUND");
    await rejects(
      run("updateVariantDefinition", { id: theirs.id, label: "Mine" }, mine()),
      "VARIANT_NOT_FOUND",
    );
    await rejects(
      run("setVariantDefinitionActive", { id: theirs.id, isActive: false }, mine()),
      "VARIANT_NOT_FOUND",
    );
    await rejects(run("deleteVariantDefinition", { id: theirs.id }, mine()), "VARIANT_NOT_FOUND");
    await rejects(
      run("withdrawVariantFromProducts", { id: theirs.id }, mine()),
      "VARIANT_NOT_FOUND",
    );
    await rejects(
      run("createVariantValue", { definitionId: theirs.id, label: "XS" }, mine()),
      "VARIANT_NOT_FOUND",
    );
    await rejects(
      run("updateVariantValue", { id: value.id, label: "XS" }, mine()),
      "VARIANT_VALUE_NOT_FOUND",
    );
    await rejects(run("deleteVariantValue", { id: value.id }, mine()), "VARIANT_VALUE_NOT_FOUND");

    const readOnly = await apiKey({ permissions: { ...readWrite, products: "read" } });
    assert.deepEqual((await run("getVariantUsage", {}, readOnly())).items, []);
    await rejects(run("ensureVariantDefinition", SIZE, readOnly()), "PERMISSION_DENIED");
  });
});
