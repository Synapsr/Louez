import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ct.test` } } : null;
        },
      },
    },
  },
});

// The categories, the pilot domain, through the app's real router on the
// three transports: the dashboard's RPC handler, /api/v1 and /api/mcp. The
// same calls give the same results and the same error codes.

const OWNER = "ct_owner_user_000001";
const STORE = "ct_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("categories on every transport (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let rpc: (name: string, input: object) => Promise<unknown>;
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
    database = await createTestDatabase("api_categories_transports");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { RPCHandler } = await import("@orpc/server/fetch");
    const { createORPCClient } = await import("@orpc/client");
    const { RPCLink } = await import("@orpc/client/fetch");
    const { handleMcpRequest } = await import("./transports/http");
    const exposure = createExposure(appRouter);

    // RPC: the whole router, as /api/rpc serves it to the dashboard.
    const rpcHandler = new RPCHandler(appRouter);
    const client = createORPCClient<{
      dashboard: { categories: Record<string, (input: object) => Promise<unknown>> };
    }>(
      new RPCLink({
        url: "http://louez.test/api/rpc",
        headers: { [SESSION_HEADER]: OWNER },
        fetch: async (request) => {
          const { response } = await rpcHandler.handle(request, {
            prefix: "/api/rpc",
            context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
          });
          return response ?? new Response(null, { status: 404 });
        },
      }),
    );
    rpc = (name, input) => client.dashboard.categories[name](input);

    // OpenAPI: the exposed procedures at their REST paths, as /api/v1 serves them.
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

    // MCP: through the real HTTP handler, as /api/mcp serves it.
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

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@ct.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Transport store", slug: "ct-store-a" });
    await louezDb.db.insert(louezDb.storeMembers).values({
      storeId: STORE,
      userId: OWNER,
      role: "owner",
    });
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

  async function key(permissions: Permissions = { ...readOnly, categories: "write" }) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Categories agent",
      permissions,
    });
    return `Bearer ${created.key}`;
  }

  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
  const toolError = (result: ToolResult) =>
    (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
  const text = (result: ToolResult) =>
    (result.content as Array<{ text?: string }>).map((part) => part.text ?? "").join("");

  async function rpcError(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      const { code, data } = error as { code: string; data?: { code?: string } };
      return data?.code ?? code;
    }
    assert.fail("the RPC call succeeded");
  }

  test("list and create give the same results on RPC, OpenAPI and MCP", async () => {
    const authorization = await key();
    const created = json(await rpc("create", { name: "Bikes" }));
    assert.equal(created.created, true);

    const viaRpc = json(await rpc("list", {}));
    const viaApi = await openApi("GET", "/categories", null, { authorization });
    assert.equal(viaApi.status, 200);
    const viaMcp = await mcpCall(authorization, "categories_list", {});
    assert.notEqual(viaMcp.isError, true, text(viaMcp));
    assert.deepEqual(await viaApi.json(), viaRpc);
    assert.deepEqual(viaMcp.structuredContent, viaRpc);
    assert.deepEqual(
      (viaRpc.items as Json[]).map((item) => item.name),
      ["Bikes"],
    );

    // The same name again: the existing category, on every transport.
    const expected = { ...created, created: false };
    assert.deepEqual(json(await rpc("create", { name: "bikes" })), expected);
    const apiCreate = await openApi("POST", "/categories", { name: "BIKES" }, { authorization });
    assert.equal(apiCreate.status, 200);
    assert.deepEqual(await apiCreate.json(), expected);
    const mcpCreate = await mcpCall(authorization, "categories_create", { name: "Bikes" });
    assert.deepEqual(mcpCreate.structuredContent, expected);
  });

  test("errors carry the same codes on RPC, OpenAPI and MCP", async () => {
    const authorization = await key();

    assert.equal(await rpcError(rpc("create", { name: "x" })), "BAD_REQUEST");
    const apiBad = await openApi("POST", "/categories", { name: "x" }, { authorization });
    assert.equal(apiBad.status, 400);
    const mcpBad = await mcpCall(authorization, "categories_create", { name: "x" });
    assert.equal(toolError(mcpBad), "BAD_REQUEST");

    assert.equal(await rpcError(rpc("delete", { id: "missing" })), "CATEGORY_NOT_FOUND");
    const apiMissing = await openApi("DELETE", "/categories/missing", null, { authorization });
    assert.equal(apiMissing.status, 404);
    assert.equal(
      ((await apiMissing.json()) as { data: { code: string } }).data.code,
      "CATEGORY_NOT_FOUND",
    );
    const mcpMissing = await mcpCall(authorization, "categories_delete", { id: "missing" });
    assert.equal(toolError(mcpMissing), "CATEGORY_NOT_FOUND");

    const readOnlyKey = await key(readOnly);
    const apiDenied = await openApi(
      "POST",
      "/categories",
      { name: "Denied" },
      {
        authorization: readOnlyKey,
      },
    );
    assert.equal(apiDenied.status, 403);
    const mcpDenied = await mcpCall(readOnlyKey, "categories_create", { name: "Denied" });
    assert.equal(toolError(mcpDenied), "PERMISSION_DENIED");
  });

  test("delete: the dashboard runs it directly; a key confirms first, on OpenAPI and MCP", async () => {
    const authorization = await key();
    const viaRpc = json(await rpc("create", { name: "Rpc" }));
    assert.deepEqual(json(await rpc("delete", { id: viaRpc.id })), {
      id: viaRpc.id,
      affectedProductCount: 0,
      replacementCategoryId: null,
    });

    // OpenAPI: DELETE /categories/{id}, then again with the token.
    const viaApi = json(await rpc("create", { name: "Api" }));
    const asked = await openApi("DELETE", `/categories/${viaApi.id}`, null, { authorization });
    assert.equal(asked.status, 412);
    const required = (await asked.json()) as {
      data: { code: string; details: { confirmationToken: string; preview: { summary: string } } };
    };
    assert.equal(required.data.code, "CONFIRMATION_REQUIRED");
    assert.match(required.data.details.preview.summary, /"Api"\. No product is linked to it\./);
    const deleted = await openApi("DELETE", `/categories/${viaApi.id}`, null, {
      authorization,
      "louez-confirmation": required.data.details.confirmationToken,
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), {
      id: viaApi.id,
      affectedProductCount: 0,
      replacementCategoryId: null,
    });

    // MCP: the same, with the token as an argument.
    const viaMcp = json(await rpc("create", { name: "Mcp" }));
    const first = await mcpCall(authorization, "categories_delete", { id: viaMcp.id });
    assert.equal(toolError(first), "CONFIRMATION_REQUIRED");
    const token = (first.structuredContent as { error: { details: { confirmationToken: string } } })
      .error.details.confirmationToken;
    const done = await mcpCall(authorization, "categories_delete", {
      id: viaMcp.id,
      confirmationToken: token,
    });
    assert.notEqual(done.isError, true, text(done));
    assert.deepEqual(done.structuredContent, {
      id: viaMcp.id,
      affectedProductCount: 0,
      replacementCategoryId: null,
    });
  });

  test("the tool list shows the categories tools the connection may call, and no legacy one listed", async () => {
    const writer = await mcpTools(await key());
    for (const name of [
      "categories_list",
      "categories_get",
      "categories_create",
      "categories_update",
      "categories_delete",
      "categories_reorder",
      "categories_create_image_upload",
      "categories_complete_image_upload",
    ]) {
      assert.ok(writer.includes(name), `${name} is listed`);
    }
    for (const legacy of [
      "list_categories",
      "create_category",
      "update_category",
      "delete_category",
    ]) {
      assert.ok(!writer.includes(legacy), `${legacy} is not listed`);
    }

    const reader = (await mcpTools(await key(readOnly))).filter((name) =>
      name.startsWith("categories_"),
    );
    assert.deepEqual(reader.sort(), ["categories_get", "categories_list"]);
  });
  test("the former tool names still work, on the same procedures, with their old argument names", async () => {
    const authorization = await key();
    const created = await mcpCall(authorization, "create_category", { name: "Legacy name" });
    assert.notEqual(created.isError, true, JSON.stringify(created.content));
    const id = (created.structuredContent as { id: string }).id;

    const renamed = await mcpCall(authorization, "update_category", {
      categoryId: id,
      name: "Renamed by alias",
    });
    assert.notEqual(renamed.isError, true, JSON.stringify(renamed.content));
    assert.equal((renamed.structuredContent as { name: string }).name, "Renamed by alias");

    const listed = await mcpCall(authorization, "list_categories", {});
    const names = (listed.structuredContent as { items: Array<{ name: string }> }).items.map(
      (category) => category.name,
    );
    assert.ok(names.includes("Renamed by alias"));

    // Same rules as the new name: a confirmation first.
    const removed = await mcpCall(authorization, "delete_category", { categoryId: id });
    assert.equal(
      (removed.structuredContent as { error?: { code?: string } }).error?.code,
      "CONFIRMATION_REQUIRED",
    );
  });
});
