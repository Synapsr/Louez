import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

// What the image ownership checks read, before the modules that read them load.
process.env.AUTH_SECRET ??= "products-test-secret";
process.env.S3_PUBLIC_URL = "https://files.louez.test";
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
          return id ? { user: { id, email: `${id}@pr.test` } } : null;
        },
      },
    },
  },
});

// The products procedures end to end, through `call()`: the dashboard's
// session and an agent's API key, on the database.

const OWNER = "pr_owner_user_000001";
const MEMBER = "pr_member_user_00001";
const STORE = "pr_store_a_000000001";
const OTHER_STORE = "pr_store_b_000000001";
const IMAGE = `https://files.louez.test/${STORE}/products/aaaaaaaaaaaaaaaaaaaaa.png`;

describe("products procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./products").dashboardProductsRouter;
  let validations: typeof import("@louez/validations");
  let productsService: typeof import("../../services/products");

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
    database = await createTestDatabase("api_products");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardProductsRouter: router } = await import("./products"));
    validations = await import("@louez/validations");
    productsService = await import("../../services/products");

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@pr.test" },
      { id: MEMBER, email: "member@pr.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "pr-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "pr-store-b" },
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
    await louezDb.db.delete(louezDb.productSeasonalPricingTiers);
    await louezDb.db.delete(louezDb.productSeasonalPricing);
    await louezDb.db.delete(louezDb.productPricingTiers);
    await louezDb.db.delete(louezDb.productAccessories);
    await louezDb.db.delete(louezDb.productCategories);
    await louezDb.db.delete(louezDb.reservationItems);
    await louezDb.db.delete(louezDb.reservations);
    await louezDb.db.delete(louezDb.productUnitEvents);
    await louezDb.db.delete(louezDb.productUnits);
    await louezDb.db.delete(louezDb.products);
    await louezDb.db.delete(louezDb.categories);
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
      name: "Products agent",
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

  /** Calls a products procedure as the dashboard, the API or MCP would, with its full path. */
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

  async function category(name: string, storeId = STORE) {
    const [row] = await louezDb.db
      .insert(louezDb.categories)
      .values({ storeId, name })
      .$returningId();
    return row.id;
  }

  const tiersOf = async (productId: string) =>
    louezDb.db
      .select({
        period: louezDb.productPricingTiers.period,
        price: louezDb.productPricingTiers.price,
      })
      .from(louezDb.productPricingTiers)
      .where(orm.eq(louezDb.productPricingTiers.productId, productId))
      .orderBy(louezDb.productPricingTiers.period);

  // --- Create ---------------------------------------------------------------

  test("an agent creates a product from a name and a price: active, by the day, stock 1", async () => {
    const context = await apiKey();
    const created = await run("create", { name: "Kayak", price: "40" }, context());
    assert.equal(created.status, "active");
    assert.equal(created.pricingKind, "duration");
    assert.equal(created.price, "40.00");
    assert.deepEqual(created.basePriceDuration, { price: "40.00", duration: 1, unit: "day" });
    assert.equal(created.quantity, 1);
    assert.equal(created.currency, "EUR");
    assert.deepEqual(created.rateTiers, []);

    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.type, "product.created");
    assert.equal(event.type === "product.created" && event.transport, "openapi");
  });

  test("create takes the whole form: base rate, degressive tiers, accessories, categories, taxes", async () => {
    const bikes = await category("Bikes");
    const helmet = await run("create", { name: "Helmet", price: "5" }, session());
    const created = await run(
      "create",
      {
        name: "City bike",
        description: "A bike for the city",
        categoryIds: [bikes, "not-a-category"],
        price: "",
        basePriceDuration: { price: "30", duration: 1, unit: "day" },
        rateTiers: [
          { price: "150", duration: 7, unit: "day" },
          { price: "75", duration: 3, unit: "day" },
        ],
        enforceStrictTiers: true,
        deposit: "200",
        quantity: 4,
        images: [IMAGE],
        taxSettings: { inheritFromStore: false, customRate: 5.5 },
        promotion: { percentage: 10, startsOn: null, endsOn: null },
        accessories: [{ accessoryId: helmet.id, required: true, quantity: 2 }],
      },
      session(),
    );

    assert.deepEqual(await tiersOf(created.id), [
      { period: 3 * 1440, price: "75.00" },
      { period: 7 * 1440, price: "150.00" },
    ]);
    assert.deepEqual(
      created.rateTiers.map(({ duration, unit, price }) => ({ duration, unit, price })),
      [
        { duration: 3, unit: "day", price: "75.00" },
        { duration: 7, unit: "day", price: "150.00" },
      ],
    );
    assert.deepEqual(created.categoryIds, [bikes], "only the store's categories");
    assert.equal(created.enforceStrictTiers, true);
    assert.equal(created.deposit, "200.00");
    assert.equal(created.quantity, 4);
    assert.deepEqual(created.taxSettings, { inheritFromStore: false, customRate: 5.5 });
    assert.equal(created.promotion?.percentage, 10);
    assert.deepEqual(created.accessories, [
      { accessoryId: helmet.id, name: "Helmet", required: true, quantity: 2 },
    ]);
    assert.deepEqual(created.images, [IMAGE]);
  });

  test("create runs the form's rules and says what is wrong", async () => {
    const duplicate = await rejects(
      run(
        "create",
        {
          name: "Tent",
          basePriceDuration: { price: "20", duration: 1, unit: "day" },
          rateTiers: [
            { price: "50", duration: 3, unit: "day" },
            { price: "55", duration: 72, unit: "hour" },
          ],
        },
        session(),
      ),
      "PRODUCT_DUPLICATE_RATE_PERIODS",
    );
    assert.deepEqual(duplicate.data.details, { duplicateRateTierIndexes: [0, 1] });

    const invalid = await rejects(
      run("create", { name: "Gas", price: "3", stockKind: "consumable" }, session()),
      "PRODUCT_INVALID",
    );
    assert.ok(
      (invalid.data.details as { issues: Array<{ path: string }> }).issues.some(
        (issue) => issue.path === "pricingKind",
      ),
    );

    await rejects(
      run(
        "create",
        {
          name: "Stolen",
          price: "3",
          images: [`https://files.louez.test/${OTHER_STORE}/products/x.png`],
        },
        session(),
      ),
      "PRODUCT_IMAGE_INVALID",
    );
    await rejects(run("create", { name: "X", price: "3" }, session()), "BAD_REQUEST");
  });

  test("create with tracked units and variants records each unit with its event", async () => {
    const created = await run(
      "create",
      {
        name: "Ski",
        price: "25",
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
        units: [
          { identifier: "SKI-1", attributes: { size: "160" } },
          { identifier: "SKI-2", attributes: { size: "170" } },
        ],
      },
      session(),
    );
    assert.equal(created.trackUnits, true);
    assert.equal(created.quantity, 2);
    assert.deepEqual(
      created.units.map((unit) => [unit.identifier, unit.attributes.size]),
      [
        ["SKI-1", "160"],
        ["SKI-2", "170"],
      ],
    );
    const unitEvents = await louezDb.db
      .select({
        type: louezDb.productUnitEvents.type,
        actor: louezDb.productUnitEvents.actorUserId,
      })
      .from(louezDb.productUnitEvents)
      .where(orm.eq(louezDb.productUnitEvents.storeId, STORE));
    assert.deepEqual(
      unitEvents.map((row) => [row.type, row.actor]),
      [
        ["created", OWNER],
        ["created", OWNER],
      ],
    );
  });

  test("a retried creation with one idempotency key creates once", async () => {
    const context = await apiKey();
    const input = {
      name: "Paddle board",
      price: "35",
      rateTiers: [{ price: "60", duration: 2, unit: "day" as const }],
    };
    const first = await run("create", input, context({ "idempotency-key": "create-paddle" }));
    const replay = context({ "idempotency-key": "create-paddle" });
    const again = await run("create", input, replay);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(again.id, first.id);
    const rows = await louezDb.db
      .select({ id: louezDb.products.id })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.storeId, STORE));
    assert.equal(rows.length, 1);

    await rejects(
      run(
        "create",
        { ...input, name: "Other board" },
        context({ "idempotency-key": "create-paddle" }),
      ),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  // --- Read -----------------------------------------------------------------

  test("the list pages through the catalog once, in order, with the counts per status", async () => {
    const ids: string[] = [];
    for (const name of ["One", "Two", "Three", "Four", "Five"]) {
      ids.push((await run("create", { name, price: "10" }, session())).id);
    }
    await run("updateStatus", { id: ids[4], status: "draft" }, session());
    await run("reorder", { ids }, session());

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await run("list", { limit: 2, cursor }, session());
      assert.deepEqual(result.counts, { all: 5, active: 4, draft: 1, archived: 0 });
      seen.push(...result.items.map((item) => item.name));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    assert.deepEqual(seen, ["One", "Two", "Three", "Four", "Five"]);

    const drafts = await run("list", { status: "draft" }, session());
    assert.deepEqual(
      drafts.items.map((item) => item.name),
      ["Five"],
    );
    const searched = await run("list", { search: "thr" }, session());
    assert.deepEqual(
      searched.items.map((item) => item.name),
      ["Three"],
    );
    await rejects(run("list", { cursor: "nope" }, session()), "INVALID_CURSOR");
  });

  // --- Update ---------------------------------------------------------------

  test("an update changes only what it sends; price alone moves the base rate, null clears", async () => {
    const created = await run(
      "create",
      {
        name: "Canoe",
        description: "Two seats",
        basePriceDuration: { price: "60", duration: 1, unit: "day" },
        rateTiers: [{ price: "150", duration: 3, unit: "day" }],
        deposit: "100",
      },
      session(),
    );
    const updated = await run(
      "update",
      { id: created.id, price: "70", description: null },
      await apiKey().then((key) => key()),
    );
    assert.equal(updated.price, "70.00");
    assert.deepEqual(updated.basePriceDuration, { price: "70.00", duration: 1, unit: "day" });
    assert.equal(updated.description, null);
    assert.equal(updated.deposit, "100.00", "unchanged");
    assert.deepEqual(await tiersOf(created.id), [{ period: 3 * 1440, price: "150.00" }]);

    const retiered = await run(
      "update",
      { id: created.id, rateTiers: [{ price: "300", duration: 1, unit: "week" }] },
      session(),
    );
    assert.deepEqual(
      retiered.rateTiers.map(({ duration, unit, price }) => ({ duration, unit, price })),
      // Shown in the base rate's scale, as the form shows it.
      [{ duration: 7, unit: "day", price: "300.00" }],
    );
    assert.equal(events.at(-1)?.type, "product.updated");
  });

  test("an update that sends no units leaves the units, and their values, as they are", async () => {
    const created = await run("create", { name: "Legacy", price: "10" }, session());
    // A product from before variant axes: its unit carries a value no axis declares.
    await louezDb.db
      .update(louezDb.products)
      .set({ trackUnits: true })
      .where(orm.eq(louezDb.products.id, created.id));
    await louezDb.db.insert(louezDb.productUnits).values({
      productId: created.id,
      identifier: "L-1",
      attributes: { color: "red" },
    });

    await run("update", { id: created.id, name: "Legacy renamed" }, session());
    const [unit] = await louezDb.db
      .select({ attributes: louezDb.productUnits.attributes })
      .from(louezDb.productUnits)
      .where(orm.eq(louezDb.productUnits.productId, created.id));
    assert.deepEqual(unit.attributes, { color: "red" });
  });

  test("switching to fixed pricing asks first, then deletes the tiers and the seasons", async () => {
    const context = await apiKey();
    const created = await run(
      "create",
      {
        name: "Boat",
        basePriceDuration: { price: "100", duration: 1, unit: "day" },
        rateTiers: [{ price: "250", duration: 3, unit: "day" }],
      },
      context(),
    );
    await run(
      "createSeasonalPricing",
      {
        productId: created.id,
        name: "Summer",
        startDate: "2027-06-01",
        endDate: "2027-08-31",
        price: "120",
      },
      context(),
    );

    // A rename runs at once, even for a connection that confirms.
    await run("update", { id: created.id, name: "Big boat" }, context());

    const input = { id: created.id, pricingKind: "fixed" as const, price: "500" };
    const asked = await rejects(run("update", input, context()), "CONFIRMATION_REQUIRED");
    const preview = (asked.data.details as { preview: { summary: string } }).preview;
    assert.match(preview.summary, /1 pricing tier\(s\) and 1 seasonal price\(s\)/);
    assert.equal((await tiersOf(created.id)).length, 1, "nothing done yet");

    const done = await run("update", input, context({ "louez-confirmation": tokenOf(asked) }));
    assert.equal(done.pricingKind, "fixed");
    assert.equal(done.price, "500.00");
    assert.deepEqual(await tiersOf(created.id), []);
    const seasons = await run("listSeasonalPricings", { productId: created.id }, context());
    assert.deepEqual(seasons.items, []);

    // Fixed again, with nothing left to delete: a plain edit.
    await run("update", input, context());
  });

  test("a stale confirmation fails, and the dashboard never asks", async () => {
    const context = await apiKey();
    const created = await run("create", { name: "Trailer", price: "50" }, context());
    const asked = await rejects(
      run("update", { id: created.id, status: "archived" }, context()),
      "CONFIRMATION_REQUIRED",
    );
    await run("update", { id: created.id, name: "Trailer XL" }, context());
    await rejects(
      run(
        "update",
        { id: created.id, status: "archived" },
        context({ "louez-confirmation": tokenOf(asked) }),
      ),
      "CONFIRMATION_INVALID",
    );

    const archived = await run("update", { id: created.id, status: "archived" }, session());
    assert.equal(archived.status, "archived");
    const tombstones = await louezDb.db
      .select({ id: louezDb.marketplaceCatalogTombstones.entityId })
      .from(louezDb.marketplaceCatalogTombstones)
      .where(orm.eq(louezDb.marketplaceCatalogTombstones.entityId, created.id));
    assert.equal(tombstones.length, 1, "it left the marketplace");
  });

  test("deleting units through the form needs a confirmation from an agent", async () => {
    const context = await apiKey();
    const created = await run(
      "create",
      {
        name: "Drill",
        price: "15",
        trackUnits: true,
        units: [{ identifier: "D-1" }, { identifier: "D-2" }],
      },
      context(),
    );
    const [kept] = created.units;
    const input = { id: created.id, units: [{ id: kept.id, identifier: kept.identifier }] };
    const asked = await rejects(run("update", input, context()), "CONFIRMATION_REQUIRED");
    assert.match(
      (asked.data.details as { preview: { summary: string } }).preview.summary,
      /delete 1 unit\(s\): D-2/,
    );
    const done = await run("update", input, context({ "louez-confirmation": tokenOf(asked) }));
    assert.deepEqual(
      done.units.map((unit) => unit.identifier),
      ["D-1"],
    );
  });

  // --- Links ----------------------------------------------------------------

  test("a product's links come from the urls port: its dashboard page, and its storefront page once active in an online store", async () => {
    const setOnline = (onboardingCompleted: boolean) =>
      louezDb.db
        .update(louezDb.stores)
        .set({ onboardingCompleted })
        .where(orm.eq(louezDb.stores.id, STORE));
    await setOnline(true);
    try {
      const context = await apiKey();
      const created = await run("create", { name: "Kayak links", price: "30" }, context());
      assert.ok(created.slug);
      const expected = {
        dashboard: `${TEST_APP_URL}/dashboard/products/${created.id}?store=${STORE}`,
        storefront: `https://pr-store-a.louez.test/product/${created.slug}`,
      };
      assert.deepEqual(created.links, expected);
      assert.deepEqual((await run("get", { id: created.id }, context())).links, expected);
      assert.deepEqual((await run("get", { id: created.id }, session())).links, expected);

      const page = await run("list", {}, context());
      assert.deepEqual(page.items.find((item) => item.id === created.id)?.links, expected);

      // A draft has no public page; nor has a store back in onboarding.
      const draft = await run(
        "create",
        { name: "Draft links", price: "30", status: "draft" },
        context(),
      );
      assert.deepEqual(draft.links, {
        dashboard: `${TEST_APP_URL}/dashboard/products/${draft.id}?store=${STORE}`,
      });
      const copy = await run("duplicate", { id: created.id }, context());
      assert.equal(copy.links.storefront, undefined);
      await setOnline(false);
      assert.deepEqual((await run("get", { id: created.id }, context())).links, {
        dashboard: expected.dashboard,
      });
    } finally {
      await setOnline(false);
    }
  });

  // --- Status, delete, duplicate, order ------------------------------------

  test("archiving through the status asks an agent first; publishing does not", async () => {
    const context = await apiKey();
    const created = await run("create", { name: "Sup", price: "20", status: "draft" }, context());
    const published = await run("updateStatus", { id: created.id, status: "active" }, context());
    // The store is still in onboarding: no storefront to link to.
    assert.deepEqual(published, {
      id: created.id,
      status: "active",
      previousStatus: "draft",
      links: { dashboard: `${TEST_APP_URL}/dashboard/products/${created.id}?store=${STORE}` },
    });

    const asked = await rejects(
      run("updateStatus", { id: created.id, status: "archived" }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const archived = await run(
      "updateStatus",
      { id: created.id, status: "archived" },
      context({ "louez-confirmation": tokenOf(asked) }),
    );
    assert.equal(archived.status, "archived");
  });

  test("deleting asks for a confirmation bound to the units; a member cannot delete", async () => {
    const context = await apiKey();
    const created = await run(
      "create",
      { name: "Camera", price: "30", trackUnits: true, units: [{ identifier: "C-1" }] },
      context(),
    );
    await rejects(run("delete", { id: created.id }, session(MEMBER)), "PERMISSION_DENIED");

    const asked = await rejects(
      run("delete", { id: created.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.match(
      (asked.data.details as { preview: { summary: string } }).preview.summary,
      /Delete the product "Camera" for good, with its 1 unit\(s\)\./,
    );
    // A unit added since the preview: the token no longer matches.
    await run(
      "update",
      { id: created.id, units: [...created.units, { identifier: "C-2" }] },
      context(),
    );
    await rejects(
      run("delete", { id: created.id }, context({ "louez-confirmation": tokenOf(asked) })),
      "CONFIRMATION_INVALID",
    );

    const again = await rejects(
      run("delete", { id: created.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const deleted = await run(
      "delete",
      { id: created.id },
      context({ "louez-confirmation": tokenOf(again) }),
    );
    assert.deepEqual(deleted, { id: created.id, deletedUnitCount: 2 });
    await rejects(run("get", { id: created.id }, context()), "PRODUCT_NOT_FOUND");
    const unitEvents = await louezDb.db
      .select({ type: louezDb.productUnitEvents.type })
      .from(louezDb.productUnitEvents)
      .where(orm.eq(louezDb.productUnitEvents.type, "deleted"));
    assert.equal(unitEvents.length, 2);
  });

  test("a duplicate is a draft copy with the tiers and categories, without units", async () => {
    const bikes = await category("Bikes");
    const created = await run(
      "create",
      {
        name: "E-bike",
        categoryIds: [bikes],
        basePriceDuration: { price: "45", duration: 1, unit: "day" },
        rateTiers: [{ price: "120", duration: 3, unit: "day" }],
        trackUnits: true,
        units: [{ identifier: "E-1" }, { identifier: "E-2" }],
      },
      session(),
    );
    const copy = await run("duplicate", { id: created.id }, session());
    assert.equal(copy.name, "E-bike (copy)");
    assert.equal(copy.status, "draft");
    assert.deepEqual(copy.categoryIds, [bikes]);
    assert.equal(copy.trackUnits, false);
    assert.equal(copy.quantity, 2);
    assert.deepEqual(await tiersOf(copy.id), [{ period: 3 * 1440, price: "120.00" }]);
  });

  test("reordering part of the catalog leaves the other products in their places", async () => {
    const ids: string[] = [];
    for (const name of ["Aa", "Bb", "Cc", "Dd"])
      ids.push((await run("create", { name, price: "1" }, session())).id);
    await run("reorder", { ids }, session());
    const result = await run("reorder", { ids: [ids[3], ids[1]] }, session());
    assert.deepEqual(result.items, [
      { id: ids[3], position: 1 },
      { id: ids[1], position: 3 },
    ]);
    const names = (await run("list", {}, session())).items.map((item) => item.name);
    assert.deepEqual(names, ["Aa", "Dd", "Cc", "Bb"]);
  });

  // --- Seasons --------------------------------------------------------------

  test("seasons: create with tiers, no overlap, partial update, duplicate a year later, delete", async () => {
    const context = await apiKey();
    const created = await run("create", { name: "Jet ski", price: "200" }, context());
    const summer = await run(
      "createSeasonalPricing",
      {
        productId: created.id,
        name: "Summer",
        startDate: "2027-06-01",
        endDate: "2027-08-31",
        price: "250",
        rateTiers: [{ price: "600", duration: 3, unit: "day" }],
      },
      context(),
    );
    assert.deepEqual(
      summer.tiers.map(({ period, duration, unit, price }) => ({ period, duration, unit, price })),
      [{ period: 3 * 1440, duration: 3, unit: "day", price: "600.00" }],
    );

    await rejects(
      run(
        "createSeasonalPricing",
        {
          productId: created.id,
          name: "Late",
          startDate: "2027-08-15",
          endDate: "2027-09-15",
          price: "220",
        },
        context(),
      ),
      "SEASONAL_PRICING_OVERLAP",
    );
    await rejects(
      run(
        "createSeasonalPricing",
        {
          productId: created.id,
          name: "Back",
          startDate: "2027-10-10",
          endDate: "2027-10-01",
          price: "220",
        },
        context(),
      ),
      "SEASONAL_PRICING_DATES_INVALID",
    );

    const renamed = await run(
      "updateSeasonalPricing",
      { id: summer.id, name: "High summer" },
      context(),
    );
    assert.equal(renamed.name, "High summer");
    assert.equal(renamed.price, "250.00");
    assert.equal(renamed.tiers.length, 1, "tiers left as they were");

    const copy = await run("duplicateSeasonalPricing", { id: summer.id }, context());
    assert.equal(copy.name, "High summer (copie)");
    assert.deepEqual([copy.startDate, copy.endDate], ["2028-06-01", "2028-08-31"]);
    assert.equal(copy.tiers.length, 1);

    const listed = await run(
      "listSeasonalPricings",
      { productId: created.id, limit: 1 },
      context(),
    );
    assert.deepEqual(
      listed.items.map((item) => item.id),
      [summer.id],
    );
    const next = await run(
      "listSeasonalPricings",
      { productId: created.id, cursor: listed.nextCursor ?? undefined },
      context(),
    );
    assert.deepEqual(
      next.items.map((item) => item.id),
      [copy.id],
    );

    const asked = await rejects(
      run("deleteSeasonalPricing", { id: copy.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const deleted = await run(
      "deleteSeasonalPricing",
      { id: copy.id },
      context({ "louez-confirmation": tokenOf(asked) }),
    );
    assert.deepEqual(deleted, { id: copy.id, productId: created.id });
    assert.ok(events.some((event) => event.type === "product.seasonalPricing.changed"));

    const fixed = await run("create", { name: "Kit", price: "9", pricingKind: "fixed" }, context());
    await rejects(
      run(
        "createSeasonalPricing",
        {
          productId: fixed.id,
          name: "Summer",
          startDate: "2027-06-01",
          endDate: "2027-06-30",
          price: "10",
        },
        context(),
      ),
      "SEASONAL_PRICING_FIXED_PRODUCT",
    );
  });

  // --- Activity and timeline ------------------------------------------------

  test("the activity pages through the unit events with a short cursor", async () => {
    const created = await run(
      "create",
      {
        name: "Tent",
        price: "12",
        trackUnits: true,
        units: [{ identifier: "T-1" }, { identifier: "T-2" }, { identifier: "T-3" }],
      },
      session(),
    );
    const first = await run("getActivity", { id: created.id, limit: 2 }, session());
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await run(
      "getActivity",
      { id: created.id, limit: 2, cursor: first.nextCursor ?? undefined },
      session(),
    );
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    await rejects(
      run("getActivity", { id: created.id, cursor: "nope" }, session()),
      "INVALID_CURSOR",
    );
  });

  test("the reservation timeline reads a bounded window of the store's product", async () => {
    const created = await run("create", { name: "Van", price: "90" }, session());
    const empty = await run(
      "getReservationTimeline",
      {
        id: created.id,
        from: new Date("2027-01-01T00:00:00Z"),
        to: new Date("2027-03-01T00:00:00Z"),
      },
      session(),
    );
    assert.deepEqual(empty, { reservations: [], downtimes: [] });
    await rejects(
      run(
        "getReservationTimeline",
        {
          id: created.id,
          from: new Date("2027-01-01T00:00:00Z"),
          to: new Date("2029-01-01T00:00:00Z"),
        },
        session(),
      ),
      "PRODUCT_TIMELINE_RANGE_INVALID",
    );
  });

  // --- Rights and stores ----------------------------------------------------

  test("a read-only key reads but cannot write", async () => {
    const created = await run("create", { name: "Read me", price: "5" }, session());
    const readOnly = await apiKey({ permissions: { ...readWrite, products: "read" } });
    assert.equal((await run("get", { id: created.id }, readOnly())).name, "Read me");
    await rejects(run("create", { name: "Nope", price: "5" }, readOnly()), "PERMISSION_DENIED");
    await rejects(run("update", { id: created.id, name: "Nope" }, readOnly()), "PERMISSION_DENIED");
    await rejects(
      run(
        "createSeasonalPricing",
        {
          productId: created.id,
          name: "S",
          startDate: "2027-01-01",
          endDate: "2027-01-31",
          price: "5",
        },
        readOnly(),
      ),
      "PERMISSION_DENIED",
    );
    const member = await run("create", { name: "By a member", price: "5" }, session(MEMBER));
    assert.equal(member.name, "By a member", "a member writes");
  });

  test("a key of one store never reaches another store's product", async () => {
    const theirs = await run("create", { name: "Theirs", price: "5" }, session(OWNER, OTHER_STORE));
    const mine = await apiKey();
    await rejects(run("get", { id: theirs.id }, mine()), "PRODUCT_NOT_FOUND");
    await rejects(run("update", { id: theirs.id, name: "Mine" }, mine()), "PRODUCT_NOT_FOUND");
    await rejects(run("delete", { id: theirs.id }, mine()), "PRODUCT_NOT_FOUND");
    await rejects(run("duplicate", { id: theirs.id }, mine()), "PRODUCT_NOT_FOUND");
    await rejects(
      run("listSeasonalPricings", { productId: theirs.id }, mine()),
      "PRODUCT_NOT_FOUND",
    );
    assert.deepEqual((await run("list", {}, mine())).items, []);
  });

  // --- Review fixes ---------------------------------------------------------

  /** A new fixed-price product, as the dashboard form submits it. */
  const fixedFormPayload = () =>
    validations
      .createProductSchema((key) => key)
      .parse({
        name: "Gas bottle",
        description: "",
        aiContext: "",
        categoryIds: [],
        price: "12",
        // The price editor of a fixed product changes `price` only: the base
        // period stays as the form started it.
        basePriceDuration: { price: "", duration: 1, unit: "day" },
        deposit: "",
        quantity: "1",
        status: "active",
        images: [],
        imageHistory: [],
        stockKind: "returnable",
        pricingKind: "fixed",
        pricingMode: "day",
        pricingTiers: [],
        rateTiers: [{ price: "", duration: 1, unit: "day" }],
        enforceStrictTiers: true,
        taxSettings: { inheritFromStore: true },
        promotion: null,
        videoUrl: "",
        accessories: [],
        trackUnits: false,
        units: [],
        bookingAttributeAxes: [],
      });

  test("the form's fixed-price product saves, its dormant base period and tiers ignored", async () => {
    const created = await run("create", fixedFormPayload(), session());
    assert.equal(created.pricingKind, "fixed");
    assert.equal(created.price, "12.00");
    assert.equal(created.basePriceDuration, null);
    assert.deepEqual(await tiersOf(created.id), []);

    const updated = await run(
      "update",
      { ...fixedFormPayload(), id: created.id, price: "14" },
      session(),
    );
    assert.equal(updated.price, "14.00");
  });

  test("the reservation timeline needs reservations and customers read on a connection", async () => {
    const created = await run("create", { name: "Van", price: "90" }, session());
    const window = {
      id: created.id,
      from: new Date("2027-01-01T00:00:00Z"),
      to: new Date("2027-02-01T00:00:00Z"),
    };
    const productsOnly = await apiKey({
      permissions: { ...readWrite, reservations: "none", customers: "none" },
    });
    const refused = await rejects(
      run("getReservationTimeline", window, productsOnly()),
      "PERMISSION_DENIED",
    );
    assert.deepEqual(refused.data.details, { required: "reservations:read" });
    const noCustomers = await apiKey({ permissions: { ...readWrite, customers: "none" } });
    await rejects(run("getReservationTimeline", window, noCustomers()), "PERMISSION_DENIED");

    const allowed = await apiKey();
    assert.deepEqual(await run("getReservationTimeline", window, allowed()), {
      reservations: [],
      downtimes: [],
    });
    assert.deepEqual(await run("getReservationTimeline", window, session(MEMBER)), {
      reservations: [],
      downtimes: [],
    });
  });

  test("an update waits for a checkout holding the product, then sees its reservation", async () => {
    const created = await run(
      "create",
      {
        name: "Race kayak",
        price: "40",
        trackUnits: true,
        units: [{ identifier: "RK-1" }, { identifier: "RK-2" }],
      },
      session(),
    );
    const [kept] = created.units;
    const { drizzle } = await import("drizzle-orm/mysql2");

    const answers = await raceOnOpenTransaction(
      database,
      async (holder) => {
        // What checkout does: the product's row first, then the booking.
        await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [created.id]);
        const checkout = drizzle(holder);
        await checkout.insert(louezDb.reservations).values({
          id: "pr_race_reservation1",
          storeId: STORE,
          customerId: "customer",
          number: "PR-RACE-1",
          status: "confirmed",
          startDate: new Date("2030-06-01T09:00:00Z"),
          endDate: new Date("2030-06-03T09:00:00Z"),
          subtotalAmount: "80.00",
          depositAmount: "0.00",
          totalAmount: "80.00",
        });
        await checkout.insert(louezDb.reservationItems).values({
          reservationId: "pr_race_reservation1",
          productId: created.id,
          quantity: 2,
          unitPrice: "40.00",
          depositPerUnit: "0.00",
          totalPrice: "80.00",
          combinationKey: "__default",
          productSnapshot: { name: "Race kayak", description: null, images: [] },
        });
      },
      [
        () =>
          run(
            "update",
            { id: created.id, units: [{ id: kept.id, identifier: kept.identifier }] },
            session(),
          ).then(
            () => "saved",
            (error: { data?: { code?: string } }) => error.data?.code,
          ),
      ],
    );
    assert.deepEqual(answers, ["PRODUCT_UNIT_CAPACITY_CONFLICT"]);
    const units = await louezDb.db
      .select({ id: louezDb.productUnits.id })
      .from(louezDb.productUnits)
      .where(orm.eq(louezDb.productUnits.productId, created.id));
    assert.equal(units.length, 2, "the booked unit is still there");
  });

  test("a member cannot delete a seasonal price", async () => {
    const created = await run("create", { name: "Jet ski", price: "200" }, session());
    const season = await run(
      "createSeasonalPricing",
      {
        productId: created.id,
        name: "Summer",
        startDate: "2027-06-01",
        endDate: "2027-08-31",
        price: "250",
      },
      session(MEMBER),
    );
    await rejects(
      run("deleteSeasonalPricing", { id: season.id }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    await run("deleteSeasonalPricing", { id: season.id }, session());
  });

  test("former fields sent in a partial update take effect", async () => {
    const boats = await category("Boats");
    const rafts = await category("Rafts");
    const created = await run(
      "create",
      { name: "Raft", price: "10", categoryIds: [boats] },
      session(),
    );

    const moved = await run("update", { id: created.id, categoryId: rafts }, session());
    assert.deepEqual(moved.categoryIds, [rafts]);

    await run(
      "update",
      { id: created.id, pricingTiers: [{ minDuration: 3, discountPercent: 10 }] },
      session(),
    );
    assert.deepEqual(await tiersOf(created.id), [{ period: 3 * 1440, price: "27.00" }]);

    const hourly = await run(
      "update",
      { id: created.id, price: "15", pricingMode: "hour" },
      session(),
    );
    assert.deepEqual(hourly.basePriceDuration, { price: "15.00", duration: 1, unit: "hour" });
    assert.equal(hourly.pricingMode, "hour");
  });

  test("what products_get returns can be sent back to products_update", async () => {
    const context = await apiKey();
    const boats = await category("Boats");
    const duration = await run(
      "create",
      {
        name: "Round trip",
        categoryIds: [boats],
        basePriceDuration: { price: "30", duration: 1, unit: "day" },
        rateTiers: [{ price: "75", duration: 3, unit: "day" }],
        deposit: "100",
      },
      context(),
    );
    const fixed = await run(
      "create",
      { name: "Round fixed", price: "9", pricingKind: "fixed" },
      context(),
    );

    for (const id of [duration.id, fixed.id]) {
      const read = await run("get", { id }, context());
      const saved = await run("update", read, context());
      const { updatedAt: _readAt, ...readRest } = read;
      const { updatedAt: _savedAt, ...savedRest } = saved;
      assert.deepEqual(savedRest, readRest, `${read.name} is unchanged`);
    }
  });

  test("oversized lists are refused before any lock, and duplicate tiers group in one pass", async () => {
    await rejects(
      run(
        "create",
        {
          name: "Fleet",
          price: "5",
          trackUnits: true,
          units: Array.from({ length: 1001 }, (_, index) => ({ identifier: `F-${index}` })),
        },
        session(),
      ),
      "PRODUCT_LIST_TOO_LONG",
    );
    // Past ten times the limit, the contract refuses before the service runs.
    await rejects(
      run(
        "create",
        {
          name: "Huge fleet",
          price: "5",
          trackUnits: true,
          units: Array.from({ length: 10_001 }, (_, index) => ({ identifier: `H-${index}` })),
        },
        session(),
      ),
      "BAD_REQUEST",
    );
    await rejects(
      run(
        "create",
        {
          name: "Ladder",
          price: "5",
          rateTiers: Array.from({ length: 51 }, (_, index) => ({
            price: "5",
            duration: index + 2,
            unit: "day" as const,
          })),
        },
        session(),
      ),
      "PRODUCT_LIST_TOO_LONG",
    );
    const rows = await louezDb.db
      .select({ id: louezDb.products.id })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.storeId, STORE));
    assert.equal(rows.length, 0);

    const started = Date.now();
    const indexes = productsService.duplicateRatePeriodIndexes(
      Array.from({ length: 200_000 }, () => ({ period: 1440 })),
    );
    assert.equal(indexes.length, 200_000);
    assert.ok(Date.now() - started < 2_000, "linear in the number of tiers");
  });

  test("a unit deletion names the units, and a token stops matching when they change", async () => {
    const context = await apiKey();
    const created = await run(
      "create",
      {
        name: "Skis",
        price: "25",
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
        units: [
          { identifier: "S-1", attributes: { size: "160" } },
          { identifier: "S-2", attributes: { size: "170" } },
          { identifier: "S-3", attributes: { size: "180" } },
        ],
      },
      session(),
    );
    const [first, second, third] = created.units;
    const input = {
      id: created.id,
      units: [{ id: first.id, identifier: first.identifier, attributes: first.attributes }],
    };
    const asked = await rejects(run("update", input, context()), "CONFIRMATION_REQUIRED");
    const preview = (
      asked.data.details as {
        preview: {
          summary: string;
          details: {
            deletesUnitCount: number;
            deletesUnits: Array<{ identifier: string; attributes: Record<string, string> }>;
          };
        };
      }
    ).preview;
    assert.equal(preview.details.deletesUnitCount, 2);
    assert.deepEqual(
      preview.details.deletesUnits.map((unit) => [unit.identifier, unit.attributes.size]),
      [
        ["S-2", "170"],
        ["S-3", "180"],
      ],
    );
    assert.match(preview.summary, /delete 2 unit\(s\): S-2 \(size 170\), S-3 \(size 180\)/);

    // The dashboard renames a unit the preview named: the human saw another name.
    await run(
      "update",
      {
        id: created.id,
        units: [first, second, { ...third, identifier: "S-3 spare" }].map((unit) => ({
          id: unit.id,
          identifier: unit.identifier,
          attributes: unit.attributes,
        })),
      },
      session(),
    );
    await rejects(
      run("update", input, context({ "louez-confirmation": tokenOf(asked) })),
      "CONFIRMATION_INVALID",
    );
  });

  test("two reorders at once leave one of the two orders, every place taken once", async () => {
    const ids: string[] = [];
    for (const name of ["Aa", "Bb", "Cc", "Dd", "Ee"]) {
      ids.push((await run("create", { name, price: "1" }, session())).id);
    }
    const reversed = [...ids].reverse();
    await Promise.all([
      run("reorder", { ids }, session()),
      run("reorder", { ids: reversed }, session()),
    ]);
    const rows = await louezDb.db
      .select({ id: louezDb.products.id, position: louezDb.products.displayOrder })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.storeId, STORE))
      .orderBy(louezDb.products.displayOrder);
    assert.deepEqual(
      rows.map((row) => row.position),
      [0, 1, 2, 3, 4],
    );
    const order = rows.map((row) => row.id);
    assert.ok(
      JSON.stringify(order) === JSON.stringify(ids) ||
        JSON.stringify(order) === JSON.stringify(reversed),
    );
  });

  test("a product stored past a list limit still saves, as long as the list does not grow", async () => {
    const created = await run(
      "create",
      { name: "Big fleet", price: "5", trackUnits: true },
      session(),
    );
    // Units from before the limit: more than the form may add today.
    await louezDb.db.insert(louezDb.productUnits).values(
      Array.from({ length: 1002 }, (_, index) => ({
        id: `pr_fleet_unit_${String(index).padStart(6, "0")}`,
        productId: created.id,
        identifier: `BF-${String(index).padStart(4, "0")}`,
      })),
    );
    const stored = (await run("get", { id: created.id }, session())).units.map((unit) => ({
      id: unit.id,
      identifier: unit.identifier,
    }));
    assert.equal(stored.length, 1002);

    const renamed = stored.map((unit, index) =>
      index === 0 ? { ...unit, identifier: "BF-renamed" } : unit,
    );
    const saved = await run("update", { id: created.id, units: renamed }, session());
    assert.equal(saved.quantity, 1002);
    assert.equal(saved.units.find((unit) => unit.id === stored[0].id)?.identifier, "BF-renamed");

    // Fewer is fine, one more is not.
    await run("update", { id: created.id, units: renamed.slice(0, 1001) }, session());
    const grown = await rejects(
      run(
        "update",
        {
          id: created.id,
          units: [
            ...renamed.slice(0, 1001),
            { identifier: "BF-new-1" },
            { identifier: "BF-new-2" },
          ],
        },
        session(),
      ),
      "PRODUCT_LIST_TOO_LONG",
    );
    assert.deepEqual(grown.data.details, { list: "units", max: 1000, stored: 1001 });
  });

  test("a product with a retired unit goes through get then update unchanged", async () => {
    const created = await run(
      "create",
      {
        name: "Bikes with history",
        price: "20",
        trackUnits: true,
        units: [{ identifier: "BH-1" }, { identifier: "BH-2" }],
      },
      session(),
    );
    const [active, retired] = created.units;
    await louezDb.db
      .update(louezDb.productUnits)
      .set({ lifecycleStatus: "retired", retiredAt: new Date() })
      .where(orm.eq(louezDb.productUnits.id, retired.id));
    // A variant added since: the retired unit has no value for it.
    await run(
      "update",
      {
        id: created.id,
        bookingAttributeAxes: [{ key: "color", label: "Color", position: 0 }],
        units: [{ id: active.id, identifier: active.identifier, attributes: { color: "red" } }],
      },
      session(),
    );

    const context = await apiKey();
    const read = await run("get", { id: created.id }, context());
    assert.deepEqual(
      read.units.map((unit) => [unit.identifier, unit.lifecycleStatus]),
      [
        ["BH-1", "active"],
        ["BH-2", "retired"],
      ],
    );
    const saved = await run("update", read, context());
    assert.deepEqual(
      saved.units.map((unit) => [unit.identifier, unit.lifecycleStatus, unit.attributes]),
      [
        ["BH-1", "active", { color: "red" }],
        ["BH-2", "retired", {}],
      ],
    );
  });

  test("former percentage tiers count against the tier limit, on create and on update", async () => {
    const percentageTiers = Array.from({ length: 51 }, (_, index) => ({
      minDuration: index + 2,
      discountPercent: 1,
    }));
    const created = await rejects(
      run("create", { name: "Old ladder", price: "10", pricingTiers: percentageTiers }, session()),
      "PRODUCT_LIST_TOO_LONG",
    );
    assert.deepEqual(created.data.details, { list: "rateTiers", max: 50, stored: 0 });

    const plain = await run("create", { name: "No ladder", price: "10" }, session());
    await rejects(
      run("update", { id: plain.id, pricingTiers: percentageTiers }, session()),
      "PRODUCT_LIST_TOO_LONG",
    );
    // rateTiers sent take precedence: the percentage tiers are ignored then.
    const saved = await run(
      "update",
      {
        id: plain.id,
        rateTiers: [{ price: "25", duration: 3, unit: "day" }],
        pricingTiers: percentageTiers,
      },
      session(),
    );
    assert.equal(saved.rateTiers.length, 1);
  });
});
