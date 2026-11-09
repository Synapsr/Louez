import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// The products tools, through the app's real router and the real MCP and
// OpenAPI handlers: what an agent sees, and the confirmations of the
// sensitive edits.

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
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_products_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    orm = await import("drizzle-orm");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest, routeBodyLimits } =
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
        { ports, bodyLimits: routeBodyLimits(exposure.procedures) },
      )) ?? new Response(null, { status: 404 });

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: {
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

  test("every products tool is in the catalog bundle", async () => {
    const products = exposure.procedures.filter((entry) =>
      entry.path.startsWith("dashboard.products."),
    );
    assert.equal(products.length, 40);
    for (const name of [
      "products_upload_image",
      "products_enhance_image",
      "products_remove_image_background",
      "products_use_image_version",
    ]) {
      assert.ok(products.some((entry) => entry.meta.mcp.name === name), name);
    }
    assert.deepEqual([...new Set(products.map((entry) => entry.meta.mcp.bundle))], ["catalog"]);
    const writer = await mcpTools(await key());
    assert.ok(writer.includes("products_create"));
    assert.ok(writer.includes("products_delete_seasonal_pricing"));
    for (const name of [
      "products_get_unit_history",
      "products_declare_downtime",
      "products_update_downtime",
      "products_close_downtime",
      "products_delete_downtime",
      "products_retire_unit",
      "products_reinstate_unit",
      "products_update_unit_details",
      "products_list_variants",
      "products_create_variant",
      "products_update_variant",
      "products_set_variant_active",
      "products_delete_variant",
      "products_get_variant_usage",
      "products_withdraw_variant",
      "products_create_variant_value",
      "products_update_variant_value",
      "products_delete_variant_value",
    ]) {
      assert.ok(writer.includes(name), `${name} is listed`);
    }

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

  test("a product write past 4 MiB passes the door", async () => {
    const authorization = await key();
    // 4.5 MB of description: more than any other call may send.
    const description = "€".repeat(1_500_000);

    // /api/v1 reads it past 2 MiB once the API key is known; without one it
    // stops at 2 MiB and answers 401.
    const viaOpenApi = await openApi(
      "PATCH",
      "/products/pt_missing_product_01",
      { description },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 404);
    assert.equal(
      ((await viaOpenApi.json()) as { data: { code: string } }).data.code,
      "PRODUCT_NOT_FOUND",
    );
    const anonymous: Array<Record<string, string>> = [
      {},
      { authorization: "Bearer lz_not_a_real_key_000000000000" },
    ];
    for (const headers of anonymous) {
      const refused = await openApi(
        "PATCH",
        "/products/pt_missing_product_01",
        { description },
        headers,
      );
      assert.equal(refused.status, 401);
    }

    const result = await mcpCall(authorization, "products_update", {
      id: "pt_missing_product_01",
      description,
    });
    assert.equal(toolError(result)?.code, "PRODUCT_NOT_FOUND", "it reached the procedure");
  });

  test("a product is created from the short form, read, listed, renamed and archived", async () => {
    const authorization = await key();
    const [category] = await louezDb.db
      .insert(louezDb.categories)
      .values({ storeId: STORE, name: "Boats" })
      .$returningId();

    const created = output(
      await mcpCall(authorization, "products_create", {
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

    const got = output(await mcpCall(authorization, "products_get", { id: created.id }));
    assert.equal(got.name, "Canoe");

    const listed = output(
      await mcpCall(authorization, "products_list", { categoryIds: [category.id] }),
    );
    assert.deepEqual(
      (listed.items as Json[]).map((item) => item.id),
      [created.id],
    );

    const renamed = output(
      await mcpCall(authorization, "products_update", { id: created.id, name: "Canoe XL" }),
    );
    assert.equal(renamed.name, "Canoe XL");

    // Archiving waits for the confirmation.
    const archive = { id: created.id, status: "archived" };
    const first = await mcpCall(authorization, "products_update_status", archive);
    const token = tokenOf(first);
    assert.equal((await louezDb.db.query.products.findFirst())?.status, "active");
    const archived = output(
      await mcpCall(authorization, "products_update_status", {
        ...archive,
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

  test("units and variants: a downtime over a booking waits for the user, the catalog has REST paths", async () => {
    const authorization = await key();
    const created = output(
      await mcpCall(authorization, "products_create", {
        name: "Sea kayak",
        price: "40",
        trackUnits: true,
        units: [{ identifier: "SK-1" }],
      }),
    );
    const [unit] = created.units as Json[];
    await louezDb.db.insert(louezDb.reservations).values({
      id: "pt_booking_000000001",
      storeId: STORE,
      customerId: "customer",
      number: "PT-1",
      status: "confirmed",
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "80.00",
      depositAmount: "0.00",
      totalAmount: "80.00",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: "pt_booking_item_00001",
      reservationId: "pt_booking_000000001",
      productId: created.id as string,
      quantity: 1,
      unitPrice: "40.00",
      depositPerUnit: "0.00",
      totalPrice: "80.00",
      combinationKey: "__default",
      productSnapshot: { name: "Sea kayak", description: null, images: [] },
    });
    await louezDb.db.insert(louezDb.reservationItemUnits).values({
      reservationItemId: "pt_booking_item_00001",
      productUnitId: unit.id as string,
      identifierSnapshot: "SK-1",
    });

    const args = { unitId: unit.id, reason: "repair", startsAt: "2030-06-02T00:00:00Z" };
    const first = await mcpCall(authorization, "products_declare_downtime", args);
    assert.match(JSON.stringify(first.content), /PT-1/);
    const declared = output(
      await mcpCall(authorization, "products_declare_downtime", {
        ...args,
        confirmationToken: tokenOf(first),
      }),
    );
    assert.equal((declared.conflicts as Json[]).length, 1);

    const history = await openApi("GET", `/products/units/${unit.id}/history`, null, {
      authorization,
    });
    assert.equal(history.status, 200, await history.clone().text());
    assert.equal(((await history.json()) as { downtimes: Json[] }).downtimes.length, 1);

    const variant = await openApi(
      "POST",
      "/variants",
      { label: "Couleur", kind: "color", values: [{ label: "Rouge", colorHex: "#FF0000" }] },
      { authorization },
    );
    assert.equal(variant.status, 200, await variant.clone().text());
    const listed = output(await mcpCall(authorization, "products_list_variants", {}));
    assert.deepEqual(
      (listed.items as Json[]).map((item) => item.label),
      ["Couleur"],
    );
    const usage = await openApi("GET", "/variants/usage", null, { authorization });
    assert.equal(usage.status, 200, await usage.clone().text());
  });

  test("an agent reads a product's units a page at a time; the API gets them all", async () => {
    const authorization = await key();
    const created = output(
      await mcpCall(authorization, "products_create", { name: "Paddle fleet", price: "20" }),
    );
    const id = String(created.id);
    await louezDb.db
      .update(louezDb.products)
      .set({ trackUnits: true })
      .where(orm.eq(louezDb.products.id, id));
    // 150 units: identifiers sort as their numbers.
    await louezDb.db.insert(louezDb.productUnits).values(
      Array.from({ length: 150 }, (_, index) => ({
        productId: id,
        identifier: `SUP-${String(index).padStart(3, "0")}`,
      })),
    );
    const identifiers = (units: unknown) => (units as Json[]).map((unit) => unit.identifier);

    // MCP: the first 100, the total, and a cursor products_list_units takes.
    const got = output(await mcpCall(authorization, "products_get", { id }));
    assert.equal((got.units as Json[]).length, 100);
    assert.equal(got.unitsTotal, 150);
    assert.equal(identifiers(got.units)[99], "SUP-099");
    assert.ok(got.unitsNextCursor);
    const rest = output(
      await mcpCall(authorization, "products_list_units", { id, cursor: got.unitsNextCursor }),
    );
    assert.deepEqual(
      identifiers(rest.items),
      Array.from({ length: 50 }, (_, index) => `SUP-${String(index + 100).padStart(3, "0")}`),
    );
    assert.equal(rest.nextCursor, null);
    assert.equal(rest.total, 150);
    // A smaller page reads on from its own cursor.
    const small = output(await mcpCall(authorization, "products_list_units", { id, limit: 2 }));
    assert.deepEqual(identifiers(small.items), ["SUP-000", "SUP-001"]);
    const next = output(
      await mcpCall(authorization, "products_list_units", { id, limit: 2, cursor: small.nextCursor }),
    );
    assert.deepEqual(identifiers(next.items), ["SUP-002", "SUP-003"]);
    const unknown = await mcpCall(authorization, "products_list_units", { id, cursor: "gone" });
    assert.equal(toolError(unknown)?.code, "INVALID_CURSOR");

    // The API (and the dashboard, on RPC) gets every unit, as before.
    const viaOpenApi = await openApi("GET", `/products/${id}`, null, { authorization });
    const product = (await viaOpenApi.json()) as Json;
    assert.equal((product.units as Json[]).length, 150);
    assert.equal(product.unitsTotal, 150);
    assert.equal(product.unitsNextCursor, null);
    const units = await openApi("GET", `/products/${id}/units`, null, { authorization });
    assert.equal(((await units.json()) as { items: Json[] }).items.length, 150);
  });

  test("an agent sends back a page of units: the units it left out stay", async () => {
    const authorization = await key();
    const created = output(
      await mcpCall(authorization, "products_create", { name: "Kayak fleet", price: "30" }),
    );
    const id = String(created.id);
    await louezDb.db
      .update(louezDb.products)
      .set({ trackUnits: true })
      .where(orm.eq(louezDb.products.id, id));
    await louezDb.db.insert(louezDb.productUnits).values(
      Array.from({ length: 150 }, (_, index) => ({
        productId: id,
        identifier: `KAY-${String(index).padStart(3, "0")}`,
      })),
    );
    const activeIdentifiers = async () =>
      (
        await louezDb.db
          .select({ identifier: louezDb.productUnits.identifier })
          .from(louezDb.productUnits)
          .where(
            orm.and(
              orm.eq(louezDb.productUnits.productId, id),
              orm.eq(louezDb.productUnits.lifecycleStatus, "active"),
            ),
          )
      )
        .map((unit) => unit.identifier)
        .sort();

    // products_get's first 100 units, sent back with one renamed.
    const got = output(await mcpCall(authorization, "products_get", { id }));
    const page = (got.units as Json[]).map(({ id: unitId, identifier, attributes }) => ({
      id: unitId,
      identifier: identifier === "KAY-007" ? "KAY-007-NEW" : identifier,
      attributes,
    }));
    assert.equal(page.length, 100);
    const updated = output(await mcpCall(authorization, "products_update", { id, units: page }));
    assert.equal(updated.unitsTotal, 150, "no confirmation: nothing is deleted");
    const after = await activeIdentifiers();
    assert.equal(after.length, 150);
    assert.ok(after.includes("KAY-007-NEW") && !after.includes("KAY-007"));
    assert.ok(after.includes("KAY-149"), "a unit past the page stays");

    // A new unit without an id is added; the others stay.
    output(
      await mcpCall(authorization, "products_update", {
        id,
        units: [{ identifier: "KAY-NEW", attributes: {} }],
      }),
    );
    assert.equal((await activeIdentifiers()).length, 151);

    // Only removeUnitIds deletes, after its confirmation.
    const last = (got.units as Json[])[99].id;
    const removal = { id, removeUnitIds: [last] };
    const token = tokenOf(await mcpCall(authorization, "products_update", removal));
    assert.equal((await activeIdentifiers()).length, 151);
    output(
      await mcpCall(authorization, "products_update", { ...removal, confirmationToken: token }),
    );
    assert.equal((await activeIdentifiers()).length, 150);

    const unknown = await mcpCall(authorization, "products_update", {
      id,
      removeUnitIds: ["not_a_unit_of_it"],
    });
    assert.equal(toolError(unknown)?.code, "PRODUCT_UNITS_TO_REMOVE_UNKNOWN");
    const both = await mcpCall(authorization, "products_update", {
      id,
      units: [page[0]],
      removeUnitIds: [String(page[0].id)],
    });
    assert.equal(toolError(both)?.code, "PRODUCT_UNITS_SENT_AND_REMOVED");
  });

  test("a tool's answer carries the record's links, built from the deployment's urls", async () => {
    const authorization = await key({ ...readOnly, products: "write" });
    await louezDb.db
      .update(louezDb.stores)
      .set({ onboardingCompleted: true })
      .where(orm.eq(louezDb.stores.id, STORE));
    try {
      const created = await mcpCall(authorization, "products_create", {
        name: "Linked kayak",
        price: "30",
      });
      const product = output(created) as { id: string; slug: string; links: Json };
      const dashboard = `${TEST_APP_URL}/dashboard/products/${product.id}?store=${STORE}`;
      const storefront = `https://pt-store-a.louez.test/product/${product.slug}`;
      assert.deepEqual(product.links, { dashboard, storefront });
      const [text] = created.content as Array<{ type: string; text: string }>;
      const line = `Links to give the user: dashboard ${dashboard}, storefront ${storefront}.`;
      assert.ok(text.text.includes(line), text.text);

      // Searched by its name: other tests leave products in the store.
      const listed = output(
        await mcpCall(authorization, "products_list", { search: "Linked kayak" }),
      ) as {
        items: Array<{ id: string; links: Json }>;
      };
      assert.deepEqual(listed.items.find((item) => item.id === product.id)?.links, {
        dashboard,
        storefront,
      });

      // A hand-written tool gives the customer's page in its text.
      const [customer] = await louezDb.db
        .insert(louezDb.customers)
        .values({ storeId: STORE, email: "linked@pt.test", firstName: "Lina", lastName: "Link" })
        .$returningId();
      const found = await mcpCall(authorization, "get_customer", { customerId: customer.id });
      const [customerText] = found.content as Array<{ type: string; text: string }>;
      assert.ok(
        customerText.text.includes(
          `dashboard ${TEST_APP_URL}/dashboard/customers/${customer.id}?store=${STORE}`,
        ),
        customerText.text,
      );
    } finally {
      await louezDb.db
        .update(louezDb.stores)
        .set({ onboardingCompleted: false })
        .where(orm.eq(louezDb.stores.id, STORE));
    }
  });
  test("a reservation's link shows only to a connection that may read reservations", async () => {
    const [customer] = await louezDb.db
      .insert(louezDb.customers)
      .values({ storeId: STORE, email: "scoped@pt.test", firstName: "Sam", lastName: "Scope" })
      .$returningId();
    const reservationId = "pt_scoped_reservation";
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: customer.id,
      number: "PT-SCOPED-1",
      status: "confirmed",
      startDate: new Date("2027-03-01T09:00:00Z"),
      endDate: new Date("2027-03-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
    const reservationLink = `${TEST_APP_URL}/dashboard/reservations/${reservationId}?store=${STORE}`;
    const customerLink = `${TEST_APP_URL}/dashboard/customers/${customer.id}?store=${STORE}`;
    const textOf = async (authorization: string, name: string, args: object) => {
      const result = await mcpCall(authorization, name, args);
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    };

    const blind = await key({ ...readOnly, reservations: "none" });
    const customerText = await textOf(blind, "get_customer", { customerId: customer.id });
    assert.ok(customerText.includes(customerLink), customerText);
    assert.ok(
      !customerText.includes("#PT-SCOPED-1"),
      "no reservation history without reservations read",
    );
    assert.ok(!customerText.includes(reservationId), customerText);
    const paymentsText = await textOf(blind, "list_payments", { reservationId });
    assert.ok(!paymentsText.includes(reservationLink), paymentsText);

    const seeing = await key({ ...readOnly, reservations: "read" });
    const seenText = await textOf(seeing, "get_customer", { customerId: customer.id });
    assert.ok(seenText.includes("#PT-SCOPED-1"), seenText);
    assert.ok(seenText.includes(reservationLink), seenText);
    assert.ok((await textOf(seeing, "list_payments", { reservationId })).includes(reservationLink));
  });
});
