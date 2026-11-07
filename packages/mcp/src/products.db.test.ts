import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// The products tools, through the app's real router and the real MCP and
// OpenAPI handlers: what an agent sees, the former tool names kept as
// aliases, and the confirmations of the sensitive edits.

const OWNER = "pt_owner_user_000001";
const STORE = "pt_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("products tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let orm: typeof import("drizzle-orm");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
  let mcpTools: (authorization: string) => Promise<string[]>;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    storage: createMemoryStorage(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_products_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    orm = await import("drizzle-orm");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { handleMcpRequest } = await import("./transports/http");
    exposure = createExposure(appRouter);

    const openApiHandler = createOpenApiHandler(exposure.router, { docs: false });
    openApi = async (method, path, body, headers) =>
      (await handleOpenApiRequest(
        openApiHandler,
        new Request(
          `http://louez.test/api/v1${path}`,
          body
            ? {
                method,
                headers: { "content-type": "application/json", ...headers },
                body: JSON.stringify(body),
              }
            : { method, headers },
        ),
        { ports },
      )) ?? new Response(null, { status: 404 });

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: {
        changeReservationStatus: async () => ({ ok: false as const, error: "not_found" as const }),
        insertRecordedPayment: async () => undefined,
      },
    };
    const connect = async (authorization: string) => {
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      return mcp;
    };
    mcpCall = async (authorization, name, args) => {
      const mcp = await connect(authorization);
      try {
        return await mcp.callTool({ name, arguments: args as Json });
      } finally {
        await mcp.close();
      }
    };
    mcpTools = async (authorization) => {
      const mcp = await connect(authorization);
      try {
        return (await mcp.listTools()).tools.map((tool) => tool.name);
      } finally {
        await mcp.close();
      }
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@pt.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Tools store", slug: "pt-store-a" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const readOnly: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function key(permissions: Permissions = { ...readOnly, products: "write" }) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Products agent",
      permissions,
    });
    return `Bearer ${created.key}`;
  }

  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };
  const toolError = (result: ToolResult) =>
    (result.structuredContent as { error?: { code?: string } } | undefined)?.error;
  const tokenOf = (result: ToolResult) => {
    const error = toolError(result) as { code?: string; details?: { confirmationToken?: string } };
    assert.equal(error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(result.content));
    return error.details?.confirmationToken ?? "";
  };

  test("every products tool is in the catalog bundle, and the former names are not listed", async () => {
    const products = exposure.procedures.filter((entry) =>
      entry.path.startsWith("dashboard.products."),
    );
    assert.equal(products.length, 18);
    assert.deepEqual([...new Set(products.map((entry) => entry.meta.mcp.bundle))], ["catalog"]);
    // Former names: aliases, and list_products as its own unlisted procedure.
    const aliases = [
      ...products.flatMap((entry) => (entry.meta.mcp.aliases ?? []).map((alias) => alias.name)),
      ...products
        .filter((entry) => entry.meta.mcp.listed === false)
        .map((entry) => entry.meta.mcp.name),
    ];
    assert.deepEqual(aliases.sort(), [
      "archive_product",
      "create_product",
      "get_product",
      "list_products",
      "update_product",
    ]);

    const writer = await mcpTools(await key());
    assert.ok(writer.includes("products_create"));
    assert.ok(writer.includes("products_delete_seasonal_pricing"));
    for (const alias of aliases) assert.ok(!writer.includes(alias), `${alias} is not listed`);

    const reader = await mcpTools(await key(readOnly));
    assert.ok(reader.includes("products_get"));
    assert.ok(!reader.includes("products_create"), "a read-only key does not see writes");
  });

  test("products_create takes degressive tiers; a read-only key is refused", async () => {
    const authorization = await key();
    const created = output(
      await mcpCall(authorization, "products_create", {
        name: "Kayak",
        basePriceDuration: { price: "40", duration: 1, unit: "day" },
        rateTiers: [{ price: "100", duration: 3, unit: "day" }],
        idempotencyKey: "kayak-1",
      }),
    );
    assert.deepEqual(
      (created.rateTiers as Json[]).map(({ duration, unit, price }) => ({ duration, unit, price })),
      [{ duration: 3, unit: "day", price: "100.00" }],
    );
    const replayed = await mcpCall(authorization, "products_create", {
      name: "Kayak",
      basePriceDuration: { price: "40", duration: 1, unit: "day" },
      rateTiers: [{ price: "100", duration: 3, unit: "day" }],
      idempotencyKey: "kayak-1",
    });
    assert.equal(output(replayed).id, created.id);
    assert.equal(replayed._meta?.["io.louez/replayed"], true);

    const denied = await mcpCall(await key(readOnly), "products_create", {
      name: "No",
      price: "1",
    });
    assert.equal(toolError(denied)?.code, "PERMISSION_DENIED");
  });

  test("the former tool names still work with their former arguments", async () => {
    const authorization = await key();
    const [category] = await louezDb.db
      .insert(louezDb.categories)
      .values({ storeId: STORE, name: "Boats" })
      .$returningId();

    const created = output(
      await mcpCall(authorization, "create_product", {
        name: "Canoe",
        price: "60.00",
        pricingMode: "week",
        quantity: 3,
        categoryId: category.id,
      }),
    );
    assert.deepEqual(created.basePriceDuration, { price: "60.00", duration: 1, unit: "week" });
    assert.equal(created.quantity, 3);
    assert.deepEqual(created.categoryIds, [category.id]);

    const got = output(await mcpCall(authorization, "get_product", { productId: created.id }));
    assert.equal(got.name, "Canoe");

    const listed = output(
      await mcpCall(authorization, "list_products", { categoryId: category.id }),
    );
    assert.deepEqual(
      (listed.items as Json[]).map((item) => item.id),
      [created.id],
    );

    const renamed = output(
      await mcpCall(authorization, "update_product", { productId: created.id, name: "Canoe XL" }),
    );
    assert.equal(renamed.name, "Canoe XL");

    // Archiving waits for the confirmation, under the old name too.
    const first = await mcpCall(authorization, "archive_product", { productId: created.id });
    const token = tokenOf(first);
    assert.equal((await louezDb.db.query.products.findFirst())?.status, "active");
    const archived = output(
      await mcpCall(authorization, "archive_product", {
        productId: created.id,
        confirmationToken: token,
      }),
    );
    assert.equal(archived.status, "archived");
  });

  test("seasons and the activity are served at their REST paths", async () => {
    const authorization = await key();
    const created = output(
      await mcpCall(authorization, "products_create", { name: "Jet ski", price: "200" }),
    );

    const season = await openApi(
      "POST",
      `/products/${created.id}/seasonal-pricings`,
      { name: "Summer", startDate: "2027-06-01", endDate: "2027-08-31", price: "250" },
      { authorization },
    );
    assert.equal(season.status, 200, await season.clone().text());
    const listed = await openApi("GET", `/products/${created.id}/seasonal-pricings`, null, {
      authorization,
    });
    assert.equal(((await listed.json()) as { items: Json[] }).items.length, 1);

    const activity = await openApi("GET", `/products/${created.id}/activity?limit=5`, null, {
      authorization,
    });
    assert.equal(activity.status, 200);
    assert.deepEqual(await activity.json(), { items: [], nextCursor: null });

    const missing = await openApi("GET", "/products/missing", null, { authorization });
    assert.equal(missing.status, 404);
    assert.equal(
      ((await missing.json()) as { data: { code: string } }).data.code,
      "PRODUCT_NOT_FOUND",
    );
  });

  test("list_products still pages with page and pageSize", async () => {
    const authorization = await key();
    await louezDb.db.delete(louezDb.products);
    for (const name of ["Page one", "Page two", "Page three"]) {
      output(await mcpCall(authorization, "products_create", { name, price: "5" }));
    }
    const first = output(await mcpCall(authorization, "list_products", { page: 1, pageSize: 2 }));
    const second = output(await mcpCall(authorization, "list_products", { page: 2, pageSize: 2 }));
    const third = output(await mcpCall(authorization, "list_products", { page: 3, pageSize: 2 }));
    const names = (page: Json) => (page.items as Json[]).map((item) => item.name);
    assert.equal(names(first).length, 2);
    assert.equal(names(second).length, 1);
    assert.deepEqual(names(third), []);
    assert.deepEqual([...names(first), ...names(second)].sort(), [
      "Page one",
      "Page three",
      "Page two",
    ]);
    assert.equal(second.nextCursor, null);

    const bad = await mcpCall(authorization, "list_products", { page: 0 });
    assert.equal(toolError(bad)?.code, "BAD_REQUEST");
  });

  test("a deep list_products page is one read, counted once, and bounded", async () => {
    const authorization = await key();
    await louezDb.db.delete(louezDb.products);
    await louezDb.db.insert(louezDb.products).values(
      Array.from({ length: 250 }, (_, index) => ({
        id: `pt_deep_${String(index).padStart(12, "0")}`,
        storeId: STORE,
        name: `Deep ${String(index).padStart(3, "0")}`,
        price: "1.00",
        pricingMode: "day" as const,
      })),
    );
    const counted = async () => {
      const [row] = await louezDb.db
        .select({ total: orm.sql<number>`COALESCE(SUM(${louezDb.apiRateLimits.count}), 0)` })
        .from(louezDb.apiRateLimits);
      return Number(row?.total ?? 0);
    };

    // A connection's own requests count too: a first page is the yardstick.
    const start = await counted();
    output(await mcpCall(authorization, "list_products", { page: 1, pageSize: 100 }));
    const firstPageCost = (await counted()) - start;
    const before = await counted();
    const third = output(await mcpCall(authorization, "list_products", { page: 3, pageSize: 100 }));
    assert.equal((third.items as Json[]).length, 50);
    assert.equal(
      (await counted()) - before,
      firstPageCost,
      "a deep page costs what a first page costs",
    );

    const tooDeep = await mcpCall(authorization, "list_products", { page: 101, pageSize: 100 });
    const error = toolError(tooDeep) as { code?: string; message?: string } | undefined;
    assert.equal(error?.code, "LEGACY_PAGE_TOO_DEEP");
    assert.match(JSON.stringify(tooDeep.content), /products_list/);
    // The last page within the bound is still served.
    const last = output(
      await mcpCall(authorization, "list_products", { page: 100, pageSize: 100 }),
    );
    assert.deepEqual(last.items, []);
  });
});
