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

// The inbox tools, through the app's real router and the real MCP and
// OpenAPI handlers: their bundle, the server's instructions, and a poll and
// an acknowledgement on both transports.

const OWNER = "ix_owner_user_000001";
const STORE = "ix_store_a_000000001";
const CUSTOMER = "ix_customer_00000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("inbox tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let connect: (authorization: string) => Promise<Client>;

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
    database = await createTestDatabase("api_inbox_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { handleMcpRequest } = await import("./transports/http");
    exposure = createExposure(appRouter);

    const openApiHandler = createOpenApiHandler(exposure.router);
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
      deps: { insertRecordedPayment: async () => undefined },
    };
    connect = async (authorization: string) => {
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      return mcp;
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@ix.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Brest Surf",
      slug: "ix-brest-surf",
      settings: {
        reservationMode: "request",
        advanceNoticeMinutes: 0,
        currency: "EUR",
        country: "FR",
      },
      onboardingCompleted: true,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@ix.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    // A booking request made an hour ago, as a fixture.
    await louezDb.db.insert(louezDb.reservations).values({
      id: "ix_res_000000000001",
      storeId: STORE,
      customerId: CUSTOMER,
      number: "R-1",
      status: "pending",
      startDate: new Date(Date.now() + 2 * 86_400_000),
      endDate: new Date(Date.now() + 4 * 86_400_000),
      subtotalAmount: "20.00",
      depositAmount: "0.00",
      totalAmount: "20.00",
      createdAt: new Date(Date.now() - 3_600_000),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const reader: Permissions = {
    reservations: "read",
    products: "none",
    customers: "read",
    categories: "none",
    payments: "none",
    analytics: "none",
    settings: "none",
  };

  async function key(permissions: Permissions) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Inbox agent",
      permissions,
    });
    return `Bearer ${created.key}`;
  }

  async function withClient<T>(authorization: string, run: (mcp: Client) => Promise<T>) {
    const mcp = await connect(authorization);
    try {
      return await run(mcp);
    } finally {
      await mcp.close();
    }
  }

  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };

  test("the inbox tools are in the daily bundle, listed by their rights, with the polling contract", async () => {
    const entries = exposure.procedures.filter((entry) =>
      entry.path.startsWith("dashboard.inbox."),
    );
    assert.deepEqual(entries.map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle]).sort(), [
      ["inbox_acknowledge", "daily"],
      ["inbox_list", "daily"],
    ]);

    const { tools, instructions } = await withClient(await key(reader), async (mcp) => ({
      tools: (await mcp.listTools()).tools,
      instructions: mcp.getInstructions() ?? "",
    }));
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("inbox_list"));
    assert.ok(!names.includes("inbox_acknowledge"), "a read-only key does not see the write");
    const description = tools.find((tool) => tool.name === "inbox_list")?.description ?? "";
    assert.match(description, /nextCursor/);
    assert.match(instructions, /inbox_list[^\n]*nextCursor[^\n]*returns only what is new/);
    assert.match(instructions, /If the user asks you to keep an eye on the store/);

    // Settings alone lists it; products alone does not.
    const settingsOnly = await withClient(
      await key({ ...reader, reservations: "none", customers: "none", settings: "read" }),
      async (mcp) => (await mcp.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(settingsOnly.includes("inbox_list"));
    const productsOnly = await withClient(
      await key({ ...reader, reservations: "none", customers: "none", products: "read" }),
      async (mcp) => (await mcp.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(!productsOnly.includes("inbox_list"));
  });

  test("an agent polls on MCP and acknowledges on OpenAPI, with the same answers", async () => {
    const authorization = await key({ ...reader, reservations: "write" });
    const first = output(
      await withClient(authorization, (mcp) => mcp.callTool({ name: "inbox_list", arguments: {} })),
    );
    const items = first.items as Array<Json & { links: Json }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, "booking_request:ix_res_000000000001");
    assert.equal(
      items[0]?.links.dashboard,
      `${TEST_APP_URL}/dashboard/reservations/ix_res_000000000001?store=${STORE}`,
    );

    const viaOpenApi = await openApi("GET", "/inbox", null, { authorization });
    assert.equal(viaOpenApi.status, 200);
    const page = (await viaOpenApi.json()) as { items: Json[]; nextCursor: string };
    assert.deepEqual(
      page.items.map((item) => [item.id, item.occurredAt]),
      items.map((item) => [item.id, item.occurredAt]),
    );

    // Nothing new since the cursor.
    const next = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({ name: "inbox_list", arguments: { cursor: first.nextCursor } }),
      ),
    );
    assert.deepEqual(next.items, []);

    const acknowledged = await openApi(
      "POST",
      "/inbox/acknowledge",
      { items: [{ id: items[0]?.id, occurredAt: items[0]?.occurredAt }] },
      { authorization },
    );
    assert.equal(acknowledged.status, 200);
    assert.ok(acknowledged.headers.get("louez-operation-id"));
    assert.deepEqual(await acknowledged.json(), {
      acknowledged: 1,
      alreadyAcknowledged: 0,
      rejected: [],
    });
    const again = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({
          name: "inbox_acknowledge",
          arguments: { items: [{ id: items[0]?.id, occurredAt: items[0]?.occurredAt }] },
        }),
      ),
    );
    assert.deepEqual(again, { acknowledged: 0, alreadyAcknowledged: 1, rejected: [] });
    const empty = output(
      await withClient(authorization, (mcp) => mcp.callTool({ name: "inbox_list", arguments: {} })),
    );
    assert.deepEqual(empty.items, []);

    const badCursor = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "inbox_list", arguments: { cursor: "nope" } }),
    );
    assert.equal(
      (badCursor.structuredContent as { error?: { code?: string } }).error?.code,
      "INVALID_CURSOR",
    );
  });
});
