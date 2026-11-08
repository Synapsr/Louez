import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";

import { createMemoryStorage, type MemoryStorage } from "../../platform/memory-storage";

// What the upload tokens and the image ownership checks read, before the
// modules that read them load.
process.env.AUTH_SECRET ??= "categories-test-secret";
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
          return id ? { user: { id, email: `${id}@ca.test` } } : null;
        },
      },
    },
  },
});

// The categories procedures end to end, through `call()`: the dashboard's
// session and an agent's API key, on the database.

const OWNER = "ca_owner_user_000001";
const MEMBER = "ca_member_user_00001";
const STORE = "ca_store_a_000000001";
const OTHER_STORE = "ca_store_b_000000001";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);

describe("categories procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let uploads: typeof import("../../services/uploads");
  let uploadHandler: typeof import("../../platform/uploads");
  let router: typeof import("./categories").dashboardCategoriesRouter;

  let storage: MemoryStorage = createMemoryStorage();
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    dispatchEffects: () => {},
    get storage() {
      return storage;
    },
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_categories");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    uploads = await import("../../services/uploads");
    uploadHandler = await import("../../platform/uploads");
    ({ dashboardCategoriesRouter: router } = await import("./categories"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ca.test" },
      { id: MEMBER, email: "member@ca.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "ca-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "ca-store-b" },
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
    storage = createMemoryStorage();
    await louezDb.db.delete(louezDb.productCategories);
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
    products: "read",
    customers: "read",
    categories: "write",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function apiKey(options: { storeId?: string; userId?: string } = {}) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: options.userId ?? OWNER,
      name: "Categories agent",
      permissions: readWrite,
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

  /** Calls a categories procedure as the dashboard, the API or MCP would, with its full path. */
  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "categories"],
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

  async function product(storeId: string, categoryIds: string[]) {
    const id = `ca_p_${Math.random().toString(36).slice(2, 12)}`;
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId,
      name: id,
      price: "1.00",
      pricingMode: "day",
      categoryId: categoryIds[0] ?? null,
    });
    if (categoryIds.length > 0) {
      await louezDb.db
        .insert(louezDb.productCategories)
        .values(
          categoryIds.map((categoryId, position) => ({ productId: id, categoryId, position })),
        );
    }
    return id;
  }

  const categoryCount = async (storeId = STORE) =>
    (
      await louezDb.db
        .select({ id: louezDb.categories.id })
        .from(louezDb.categories)
        .where(orm.eq(louezDb.categories.storeId, storeId))
    ).length;

  // --- Create ---------------------------------------------------------------

  test("creating a name twice returns the same category, whatever its case", async () => {
    const first = await run("create", { name: "Bikes", description: "Two wheels" }, session());
    assert.equal(first.created, true);
    assert.equal(first.position, 1);
    assert.equal(first.productCount, 0);

    const again = await run("create", { name: "  bikes " }, session());
    assert.equal(again.created, false);
    assert.equal(again.id, first.id);
    assert.equal(again.description, "Two wheels", "returned as is, not changed");
    assert.equal(await categoryCount(), 1);

    const second = await run("create", { name: "Scooters" }, session());
    assert.equal(second.position, 2, "placed last");
  });

  test("concurrent creations of one name insert it once", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run("create", { name: "Tents" }, session())),
    );
    assert.equal(new Set(results.map((result) => result.id)).size, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(await categoryCount(), 1);
  });

  test("two concurrent calls with one idempotency key run once", async () => {
    const context = await apiKey();
    const settled = await Promise.allSettled(
      [1, 2].map(() =>
        run("create", { name: "Kayaks" }, context({ "idempotency-key": "create-kayaks" })),
      ),
    );
    const done = settled.filter((result) => result.status === "fulfilled");
    assert.ok(done.length >= 1);
    for (const result of settled) {
      if (result.status === "rejected") {
        assert.equal(
          (result.reason as { data?: { code?: string } }).data?.code,
          "OPERATION_IN_PROGRESS",
        );
      }
    }
    const operations = await louezDb.db
      .select({ status: louezDb.apiOperations.status })
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.idempotencyKey, "create-kayaks"));
    assert.deepEqual(operations, [{ status: "succeeded" }]);
    assert.equal(await categoryCount(), 1);

    // A later retry replays the stored result.
    const replay = context({ "idempotency-key": "create-kayaks" });
    const replayed = await run("create", { name: "Kayaks" }, replay);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(replayed.name, "Kayaks");
  });

  test("an image must be one of this store's category images", async () => {
    const own = `https://files.louez.test/${STORE}/categories/aaaaaaaaaaaaaaaaaaaaa.png`;
    const created = await run("create", { name: "Boats", imageUrl: own }, session());
    assert.equal(created.imageUrl, own);

    for (const imageUrl of [
      `https://files.louez.test/${OTHER_STORE}/categories/aaaaaaaaaaaaaaaaaaaaa.png`,
      `https://files.louez.test/${STORE}/products/aaaaaaaaaaaaaaaaaaaaa.png`,
      "https://evil.test/image.png",
    ]) {
      await rejects(
        run("create", { name: "Other boats", imageUrl }, session()),
        "CATEGORY_IMAGE_INVALID",
      );
      await rejects(
        run("update", { id: created.id, imageUrl }, session()),
        "CATEGORY_IMAGE_INVALID",
      );
    }
  });

  // --- Read -----------------------------------------------------------------

  test("the list pages through every category once, in the store's order", async () => {
    for (const name of ["Delta", "alpha", "Charlie", "bravo", "Echo"]) {
      await run("create", { name }, session());
    }
    // Same position for two: the name, then the id, break the tie.
    await louezDb.db
      .update(louezDb.categories)
      .set({ order: 0 })
      .where(orm.inArray(louezDb.categories.name, ["Charlie", "bravo"]));

    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await run("list", { limit: 2, cursor }, session());
      names.push(...result.items.map((item) => item.name));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    assert.deepEqual(names, ["bravo", "Charlie", "Delta", "alpha", "Echo"]);

    const all = await run("list", {}, session());
    assert.equal(all.items.length, 5);
    assert.equal(all.nextCursor, null);

    await rejects(run("list", { cursor: "not-a-cursor" }, session()), "INVALID_CURSOR");
  });

  // --- Update ---------------------------------------------------------------

  test("an update changes only the fields it sends; null clears", async () => {
    const image = `https://files.louez.test/${STORE}/categories/bbbbbbbbbbbbbbbbbbbbb.png`;
    const created = await run(
      "create",
      { name: "Ski", description: "Winter", imageUrl: image },
      session(),
    );

    const renamed = await run("update", { id: created.id, name: "Skis" }, session());
    assert.equal(renamed.name, "Skis");
    assert.equal(renamed.description, "Winter");
    assert.equal(renamed.imageUrl, image);

    const cleared = await run(
      "update",
      { id: created.id, description: null, imageUrl: null },
      session(),
    );
    assert.equal(cleared.name, "Skis");
    assert.equal(cleared.description, null);
    assert.equal(cleared.imageUrl, null);

    await run("create", { name: "Snowboards" }, session());
    await rejects(
      run("update", { id: created.id, name: "snowboards" }, session()),
      "CATEGORY_NAME_TAKEN",
    );
    await rejects(run("update", { id: "nope", name: "Nope" }, session()), "CATEGORY_NOT_FOUND");
  });

  // --- Delete ---------------------------------------------------------------

  test("an API key deletes after a confirmation bound to the products and the category", async () => {
    const context = await apiKey();
    const bikes = await run("create", { name: "Bikes" }, context());
    const helmets = await run("create", { name: "Helmets" }, context());
    const onlyBikes = await product(STORE, [bikes.id]);
    const both = await product(STORE, [bikes.id, helmets.id]);

    const asked = await rejects(
      run("delete", { id: bikes.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const details = asked.data.details as {
      confirmationToken: string;
      preview: { summary: string; details: { affectedProductCount: number } };
    };
    assert.equal(details.preview.details.affectedProductCount, 2);
    assert.match(details.preview.summary, /"Bikes"\. 2 products lose it; 1 of them/);
    assert.equal(await categoryCount(), 2, "nothing done yet");

    // A product linked since the preview: the token no longer matches.
    const later = await product(STORE, [bikes.id]);
    await rejects(
      run("delete", { id: bikes.id }, context({ "louez-confirmation": details.confirmationToken })),
      "CONFIRMATION_INVALID",
    );

    // A rename since the preview: neither.
    const second = await rejects(
      run("delete", { id: bikes.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const token = (second.data.details as { confirmationToken: string }).confirmationToken;
    await run("update", { id: bikes.id, name: "Bicycles" }, context());
    await rejects(
      run("delete", { id: bikes.id }, context({ "louez-confirmation": token })),
      "CONFIRMATION_INVALID",
    );

    const third = await rejects(
      run("delete", { id: bikes.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const deleted = await run(
      "delete",
      { id: bikes.id },
      context({
        "louez-confirmation": (third.data.details as { confirmationToken: string })
          .confirmationToken,
      }),
    );
    assert.deepEqual(deleted, {
      id: bikes.id,
      affectedProductCount: 3,
      replacementCategoryId: null,
    });

    const mains = await louezDb.db
      .select({ id: louezDb.products.id, categoryId: louezDb.products.categoryId })
      .from(louezDb.products)
      .where(orm.inArray(louezDb.products.id, [onlyBikes, both, later]));
    assert.deepEqual(Object.fromEntries(mains.map((row) => [row.id, row.categoryId])), {
      [onlyBikes]: null,
      [both]: helmets.id,
      [later]: null,
    });
    await rejects(run("get", { id: bikes.id }, context()), "CATEGORY_NOT_FOUND");
  });

  test("the dashboard deletes directly, and can move the products to another category", async () => {
    const bikes = await run("create", { name: "Bikes" }, session());
    const cycles = await run("create", { name: "Cycles" }, session());
    const linked = await product(STORE, [bikes.id]);

    const deleted = await run(
      "delete",
      { id: bikes.id, replacementCategoryId: cycles.id },
      session(),
    );
    assert.deepEqual(deleted, {
      id: bikes.id,
      affectedProductCount: 1,
      replacementCategoryId: cycles.id,
    });
    const moved = await run("get", { id: cycles.id }, session());
    assert.equal(moved.productCount, 1);
    const [row] = await louezDb.db
      .select({ categoryId: louezDb.products.categoryId })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.id, linked));
    assert.equal(row.categoryId, cycles.id);

    await rejects(
      run("delete", { id: cycles.id, replacementCategoryId: cycles.id }, session()),
      "CATEGORY_REPLACEMENT_INVALID",
    );
  });

  test("deleting a category into a replacement that is deleted at the same time leaves no dangling link", async () => {
    const a = await run("create", { name: "Race A" }, session());
    const b = await run("create", { name: "Race B" }, session());
    const linked = await product(STORE, [a.id]);
    const results = await Promise.allSettled([
      run("delete", { id: a.id, replacementCategoryId: b.id }, session()),
      run("delete", { id: b.id }, session()),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    const [row] = await louezDb.db
      .select({ categoryId: louezDb.products.categoryId })
      .from(louezDb.products)
      .where(orm.eq(louezDb.products.id, linked));
    const links = await louezDb.db
      .select({ categoryId: louezDb.productCategories.categoryId })
      .from(louezDb.productCategories)
      .where(orm.eq(louezDb.productCategories.productId, linked));
    const remaining = new Set(
      (await louezDb.db.select({ id: louezDb.categories.id }).from(louezDb.categories)).map(
        (category) => category.id,
      ),
    );
    if (row.categoryId) assert.ok(remaining.has(row.categoryId), "the main category exists");
    for (const link of links)
      assert.ok(remaining.has(link.categoryId), "every link points at a category");
  });

  test("many confirmations asked at once never starve the connection pool", async () => {
    const context = await apiKey();
    const created = await Promise.all(
      Array.from({ length: 15 }, (_, index) => run("create", { name: `Pool ${index}` }, context())),
    );
    const started = Date.now();
    const asked = await Promise.allSettled(
      created.map((category) => run("delete", { id: category.id }, context())),
    );
    assert.ok(Date.now() - started < 10_000, "no lock wait timeout");
    for (const result of asked) {
      assert.equal(result.status, "rejected");
      const code = (result.reason as { data?: { code?: string } }).data?.code;
      assert.equal(code, "CONFIRMATION_REQUIRED");
    }
  });

  test("the token stops matching when the products left without a category change", async () => {
    const context = await apiKey();
    const shoes = await run("create", { name: "Shoes" }, context());
    const socks = await run("create", { name: "Socks" }, context());
    const linked = await product(STORE, [shoes.id, socks.id]);
    const asked = await rejects(
      run("delete", { id: shoes.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    const details = asked.data.details as {
      confirmationToken: string;
      preview: { details: { uncategorizedProductCount: number } };
    };
    assert.equal(details.preview.details.uncategorizedProductCount, 0);

    // The product loses its other category: deleting now would leave it with none.
    await louezDb.db
      .delete(louezDb.productCategories)
      .where(
        orm.and(
          orm.eq(louezDb.productCategories.productId, linked),
          orm.eq(louezDb.productCategories.categoryId, socks.id),
        ),
      );
    await rejects(
      run("delete", { id: shoes.id }, context({ "louez-confirmation": details.confirmationToken })),
      "CONFIRMATION_INVALID",
    );
  });

  test("a cursor stays short whatever the names, and the list reads past 500 categories", async () => {
    const long = "分類".repeat(126);
    await louezDb.db.insert(louezDb.categories).values(
      Array.from({ length: 501 }, (_, index) => ({
        storeId: STORE,
        name: `${long}${String(index).padStart(3, "0")}`,
        order: index + 1,
      })),
    );
    const first = await run("list", {}, session());
    assert.equal(first.items.length, 500);
    assert.ok(first.nextCursor && first.nextCursor.length <= 64);
    const second = await run("list", { cursor: first.nextCursor }, session());
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);

    const all = [...first.items, ...second.items].map((category) => category.id);
    const reordered = await run("reorder", { ids: [...all].reverse() }, session());
    assert.equal(reordered.items.length, 501);
  });

  test("a member without the delete permission cannot delete", async () => {
    const created = await run("create", { name: "Members" }, session(MEMBER));
    assert.equal(created.created, true, "a member writes");
    await rejects(run("delete", { id: created.id }, session(MEMBER)), "PERMISSION_DENIED");
  });

  test("a key of one store never reaches another store's category", async () => {
    const theirs = await run("create", { name: "Theirs" }, session(OWNER, OTHER_STORE));
    const mine = await apiKey();

    await rejects(run("get", { id: theirs.id }, mine()), "CATEGORY_NOT_FOUND");
    await rejects(run("update", { id: theirs.id, name: "Mine" }, mine()), "CATEGORY_NOT_FOUND");
    await rejects(run("delete", { id: theirs.id }, mine()), "CATEGORY_NOT_FOUND");
    assert.deepEqual((await run("list", {}, mine())).items, []);
    assert.equal((await run("get", { id: theirs.id }, session(OWNER, OTHER_STORE))).name, "Theirs");
  });

  // --- Reorder --------------------------------------------------------------

  test("reorder takes every category once and sets the order", async () => {
    const ids = [];
    for (const name of ["One", "Two", "Three"])
      ids.push((await run("create", { name }, session())).id);

    const reversed = [...ids].reverse();
    const result = await run("reorder", { ids: reversed }, session());
    assert.deepEqual(
      result.items.map((item) => item.position),
      [1, 2, 3],
    );
    assert.deepEqual(
      (await run("list", {}, session())).items.map((item) => item.name),
      ["Three", "Two", "One"],
    );

    const mismatch = await rejects(
      run("reorder", { ids: [ids[0], ids[0], "unknown"] }, session()),
      "CATEGORY_ORDER_MISMATCH",
    );
    assert.deepEqual(mismatch.data.details, {
      missing: [ids[2], ids[1]], // in the store's order, now reversed
      unknown: ["unknown"],
      duplicates: [ids[0]],
    });
  });

  // --- Image uploads --------------------------------------------------------

  test("an upload through the app: create, send the bytes, complete, then use the url", async () => {
    const context = await apiKey();
    const started = await run(
      "createImageUpload",
      { contentType: "image/png", size: PNG.byteLength },
      context({ "idempotency-key": "ignored" }),
    );
    assert.match(started.key, new RegExp(`^${STORE}/categories/[\\w-]{21}\\.png$`));
    assert.equal(started.upload.method, "PUT");
    const url = new URL(started.upload.url);
    const token = url.pathname.slice(uploadHandler.UPLOAD_PATH_PREFIX.length);

    const put = (body: Uint8Array, headers: Record<string, string>, withToken = token) =>
      uploadHandler.handleUploadRequest(
        new Request(url, { method: "PUT", body: new Blob([body as BlobPart]), headers }),
        withToken,
        ports,
      );

    const forged = await put(PNG, { "content-type": "image/png" }, `${token.slice(0, -2)}xx`);
    assert.equal(forged.status, 401);
    const wrongType = await put(PNG, { "content-type": "image/jpeg" });
    assert.equal(wrongType.status, 415);
    const notAnImage = await put(new TextEncoder().encode("<html></html>"), {
      "content-type": "image/png",
    });
    assert.equal(notAnImage.status, 422);
    assert.equal(
      ((await notAnImage.json()) as { data: { code: string } }).data.code,
      "UPLOAD_CONTENT_INVALID",
    );
    const tooLarge = await put(new Uint8Array(5 * 1024 * 1024 + 1), {
      "content-type": "image/png",
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(storage.objects.size, 0, "nothing stored yet");

    await rejects(run("completeImageUpload", { key: started.key }, context()), "UPLOAD_NOT_FOUND");
    const stored = await put(PNG, { "content-type": "image/png" });
    assert.equal(stored.status, 200);

    const completed = await run("completeImageUpload", { key: started.key }, context());
    assert.deepEqual(completed, {
      key: started.key,
      url: `https://files.louez.test/${started.key}`,
      contentType: "image/png",
      size: PNG.byteLength,
    });
    assert.equal(storage.objects.get(started.key)?.public, true);

    const category = await run("create", { name: "Pictured", imageUrl: completed.url }, context());
    assert.equal(category.imageUrl, completed.url);

    // The upload URL is never stored, even with an idempotency key.
    const [operation] = await louezDb.db
      .select({ result: louezDb.apiOperations.result })
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.idempotencyKey, "ignored"));
    assert.equal(operation, undefined);
  });

  test("a direct upload is checked on completion: bad bytes are deleted and refused", async () => {
    storage = createMemoryStorage({ direct: true });
    const context = await apiKey();
    const started = await run(
      "createImageUpload",
      { contentType: "image/png", size: 10 },
      context(),
    );
    assert.equal(started.upload.method, "PUT");
    assert.match(started.upload.url, /^https:\/\/bucket\.louez\.test\//);

    // The caller sent HTML to the bucket under the image's key.
    storage.objects.set(started.key, {
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      contentType: "image/png",
      public: false,
    });
    await rejects(
      run("completeImageUpload", { key: started.key }, context()),
      "UPLOAD_CONTENT_INVALID",
    );
    assert.equal(storage.objects.has(started.key), false, "deleted");

    storage.objects.set(started.key, { bytes: PNG, contentType: "image/png", public: false });
    const completed = await run("completeImageUpload", { key: started.key }, context());
    assert.equal(completed.size, PNG.byteLength);
  });

  test("an upload refuses another kind, type, size, or another store's key", async () => {
    const context = await apiKey();
    await rejects(
      uploads.createImageUpload(storage, {
        storeId: STORE,
        kind: "avatar" as never,
        contentType: "image/png",
        size: 10,
      }),
      "UPLOAD_KIND_NOT_ALLOWED",
    );
    await rejects(
      run("createImageUpload", { contentType: "image/svg+xml" as never, size: 10 }, context()),
      "BAD_REQUEST",
    );
    await rejects(
      uploads.createImageUpload(storage, {
        storeId: STORE,
        kind: "category",
        contentType: "text/html",
        size: 10,
      }),
      "UPLOAD_TYPE_NOT_ALLOWED",
    );
    await rejects(
      run("createImageUpload", { contentType: "image/png", size: 5 * 1024 * 1024 + 1 }, context()),
      "UPLOAD_TOO_LARGE",
    );

    const theirs = `${OTHER_STORE}/categories/ccccccccccccccccccccc.png`;
    storage.objects.set(theirs, { bytes: PNG, contentType: "image/png", public: false });
    for (const key of [
      theirs,
      `${STORE}/products/ccccccccccccccccccccc.png`,
      `${STORE}/categories/../${OTHER_STORE}/categories/ccccccccccccccccccccc.png`,
    ]) {
      await rejects(run("completeImageUpload", { key }, context()), "UPLOAD_NOT_OWNED");
    }
    assert.equal(storage.objects.get(theirs)?.public, false, "left alone");
  });
});
