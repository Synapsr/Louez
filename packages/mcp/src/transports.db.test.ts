import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
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
          return id ? { user: { id, email: `${id}@tr.test` } } : null;
        },
      },
    },
  },
});

// The three transports over the same procedures: the dashboard's RPC handler,
// the OpenAPI handler of /api/v1 and the MCP bridge of /api/mcp. They give the
// same result and the same errors, because the procedure decides. RPC takes a
// session only, so its refusal is a member's session without the role; the
// key cases run on OpenAPI and MCP.

const OWNER = "tr_owner_user_000001";
const MEMBER = "tr_member_user_00001";
const STORE = "tr_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

describe("API transports (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let rpc: {
    list: (input: object) => Promise<unknown>;
    remove: (input: object) => Promise<unknown>;
  };
  let openApi: (path: string, body: object, headers: Record<string, string>) => Promise<Response>;
  let mcpCall: (headers: Headers, name: string, args: object) => Promise<ToolResult>;
  let httpOptions: import("./transports/http").McpHttpOptions;
  let handleMcpRequest: typeof import("./transports/http").handleMcpRequest;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };
  const allRead = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  } as const;
  const allWrite = {
    ...allRead,
    categories: "write",
    customers: "write",
    products: "write",
    settings: "write",
  } as const;

  before(async () => {
    database = await createTestDatabase("api_transports");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createFixtureRouter, FIXTURE_EXPOSED } = await import("@louez/api/platform/testing");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { RPCHandler } = await import("@orpc/server/fetch");
    const { createORPCClient } = await import("@orpc/client");
    const { RPCLink } = await import("@orpc/client/fetch");
    ({ handleMcpRequest } = await import("./transports/http"));

    const router = createFixtureRouter();
    exposure = createExposure(router, FIXTURE_EXPOSED);

    // RPC: the whole router, as /api/rpc serves it, with a member's session.
    const rpcHandler = new RPCHandler(router);
    const rpcClient = createORPCClient<{
      fixture: {
        notes: {
          list: (input: object) => Promise<unknown>;
          remove: (input: object) => Promise<unknown>;
        };
      };
    }>(
      new RPCLink({
        url: "http://louez.test/rpc",
        headers: { [SESSION_HEADER]: MEMBER },
        fetch: async (request) => {
          const { response } = await rpcHandler.handle(request, {
            prefix: "/rpc",
            context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
          });
          return response ?? new Response(null, { status: 404 });
        },
      }),
    );
    rpc = rpcClient.fixture.notes;

    // OpenAPI: only the exposed procedures, as /api/v1 serves them.
    const openApiHandler = createOpenApiHandler(exposure.router, { docs: false });
    openApi = async (path, body, headers) =>
      (await handleOpenApiRequest(
        openApiHandler,
        new Request(`http://louez.test/api/v1${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
        { ports },
      )) ?? new Response(null, { status: 404 });

    // MCP: through the real HTTP handler, one server per request built from
    // the context of that request, as /api/mcp serves it.
    mcpCall = async (headers, name, args) => {
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: Object.fromEntries(headers) },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      try {
        return await client.callTool({ name, arguments: args as Record<string, unknown> });
      } finally {
        await client.close();
      }
    };

    httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: {
        changeReservationStatus: async () => ({ ok: false, error: "not_found" }),
        insertRecordedPayment: async () => undefined,
      },
    };

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@tr.test" },
      { id: MEMBER, email: "member@tr.test" },
    ]);
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Transport store", slug: "tr-store-a" });
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  async function key(options: { userId?: string; permissions?: Permissions } = {}) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: options.userId ?? OWNER,
      name: "Transport agent",
      permissions: options.permissions ?? allWrite,
    });
    return { ...created, authorization: `Bearer ${created.key}` };
  }

  const mcpHeaders = (authorization: string) => new Headers({ authorization });
  const errorCode = (result: ToolResult) =>
    (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
  const text = (result: ToolResult) =>
    (result.content as Array<{ type: string; text?: string }>)
      .map((part) => part.text ?? "")
      .join("");

  /** Our code (`data.code`), else oRPC's own (input validation). */
  async function rpcErrorCode(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      const { code, data } = error as { code: string; data?: { code?: string } };
      return data?.code ?? code;
    }
    assert.fail("the RPC call succeeded");
  }

  test("a read gives the same result on every transport", async () => {
    const { authorization } = await key();
    const expected = {
      storeId: STORE,
      items: [{ id: "note_1", title: "A-First", createdAt: "2026-01-02T03:04:05.000Z" }],
    };

    const viaRpc = await rpc.list({ prefix: "A-" });
    assert.deepEqual(JSON.parse(JSON.stringify(viaRpc)), expected);

    const viaOpenApi = await openApi("/fixture/notes/list", { prefix: "A-" }, { authorization });
    assert.equal(viaOpenApi.status, 200);
    assert.deepEqual(await viaOpenApi.json(), expected);

    const viaMcp = await mcpCall(mcpHeaders(authorization), "fixture_notes_list", { prefix: "A-" });
    assert.notEqual(viaMcp.isError, true, text(viaMcp));
    assert.deepEqual(viaMcp.structuredContent, expected);
  });

  test("a bad input fails the same way on every transport", async () => {
    const { authorization } = await key();
    const tooLong = { prefix: "x".repeat(21) };

    assert.equal(await rpcErrorCode(rpc.list(tooLong)), "BAD_REQUEST");
    const viaOpenApi = await openApi("/fixture/notes/list", tooLong, { authorization });
    assert.equal(viaOpenApi.status, 400);
    assert.equal(((await viaOpenApi.json()) as { code: string }).code, "BAD_REQUEST");
    const viaMcp = await mcpCall(mcpHeaders(authorization), "fixture_notes_list", tooLong);
    assert.equal(viaMcp.isError, true);
    assert.equal(errorCode(viaMcp), "BAD_REQUEST");
  });

  test("a read-only key, or a member without the role, is refused with PERMISSION_DENIED", async () => {
    const readOnly = await key({ permissions: allRead });

    // RPC: a member's session; deleting needs the `delete` permission.
    assert.equal(await rpcErrorCode(rpc.remove({ id: "note_1" })), "PERMISSION_DENIED");

    const viaOpenApi = await openApi(
      "/fixture/notes/remove",
      { id: "note_1" },
      { authorization: readOnly.authorization },
    );
    assert.equal(viaOpenApi.status, 403);
    const body = (await viaOpenApi.json()) as {
      message: string;
      data: { code: string; retryable: boolean };
    };
    assert.equal(body.data.code, "PERMISSION_DENIED");
    assert.equal(body.data.retryable, false);

    const viaMcp = await mcpCall(mcpHeaders(readOnly.authorization), "fixture_notes_remove", {
      id: "note_1",
    });
    assert.equal(viaMcp.isError, true);
    assert.equal(errorCode(viaMcp), "PERMISSION_DENIED");
    assert.match(text(viaMcp), /code: PERMISSION_DENIED\nretryable: false/);
  });

  test("a sensitive write asks for a confirmation, then runs with the token, then replays its key", async () => {
    // OpenAPI.
    const viaApi = await key();
    const first = await openApi(
      "/fixture/notes/remove",
      { id: "note_api" },
      { authorization: viaApi.authorization, "idempotency-key": "api-key-1" },
    );
    assert.equal(first.status, 412);
    const required = (await first.json()) as {
      data: { code: string; details: { confirmationToken: string; preview: { summary: string } } };
    };
    assert.equal(required.data.code, "CONFIRMATION_REQUIRED");
    assert.equal(required.data.details.preview.summary, "Remove note note_api.");

    const confirmed = await openApi(
      "/fixture/notes/remove",
      { id: "note_api" },
      {
        authorization: viaApi.authorization,
        "idempotency-key": "api-key-2",
        "louez-confirmation": required.data.details.confirmationToken,
      },
    );
    assert.equal(confirmed.status, 200);
    const result = (await confirmed.json()) as { runs: number };
    const operationId = confirmed.headers.get("louez-operation-id");
    assert.ok(operationId);
    assert.equal(confirmed.headers.get("louez-replayed"), null);

    const replay = await openApi(
      "/fixture/notes/remove",
      { id: "note_api" },
      { authorization: viaApi.authorization, "idempotency-key": "api-key-2" },
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), result, "replayed, not run again");
    assert.equal(replay.headers.get("louez-operation-id"), operationId);
    assert.equal(replay.headers.get("louez-replayed"), "true");

    // MCP: the same steps, with the arguments the bridge maps onto headers.
    const viaMcp = await key();
    const headers = mcpHeaders(viaMcp.authorization);
    const asked = await mcpCall(headers, "fixture_notes_remove", {
      id: "note_mcp",
      idempotencyKey: "mcp-key-1",
    });
    assert.equal(asked.isError, true);
    assert.equal(errorCode(asked), "CONFIRMATION_REQUIRED");
    const token = (asked.structuredContent as { error: { details: { confirmationToken: string } } })
      .error.details.confirmationToken;
    assert.match(text(asked), /Confirmation required: Remove note note_mcp\./);
    assert.match(text(asked), /ask them to confirm/);
    assert.ok(text(asked).includes(`confirmationToken: "${token}"`));

    const done = await mcpCall(headers, "fixture_notes_remove", {
      id: "note_mcp",
      idempotencyKey: "mcp-key-2",
      confirmationToken: token,
    });
    assert.notEqual(done.isError, true, text(done));
    const mcpResult = done.structuredContent as { id: string; removed: boolean; runs: number };
    assert.deepEqual(
      { id: mcpResult.id, removed: mcpResult.removed },
      { id: "note_mcp", removed: true },
    );
    assert.equal(mcpResult.runs, result.runs + 1);
    const mcpOperation = done._meta?.["io.louez/operationId"];
    assert.equal(typeof mcpOperation, "string");

    const again = await mcpCall(headers, "fixture_notes_remove", {
      id: "note_mcp",
      idempotencyKey: "mcp-key-2",
    });
    assert.deepEqual(again.structuredContent, done.structuredContent, "replayed, not run again");
    assert.equal(again._meta?.["io.louez/operationId"], mcpOperation);
    assert.equal(again._meta?.["io.louez/replayed"], true);

    // The token was used once: it works no more.
    const reused = await mcpCall(headers, "fixture_notes_remove", {
      id: "note_mcp",
      confirmationToken: token,
    });
    assert.equal(errorCode(reused), "CONFIRMATION_INVALID");
  });

  async function connectHttp(authorization: string) {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
        requestInit: { headers: { authorization } },
        fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
      }),
    );
    return client;
  }

  test("over HTTP, a revoked key fails on the next request", async () => {
    const revoked = await key();
    const client = await connectHttp(revoked.authorization);
    const listed = await client.callTool({ name: "fixture_notes_list", arguments: {} });
    assert.notEqual(listed.isError, true, text(listed));

    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: revoked.id });
    await assert.rejects(
      client.callTool({ name: "fixture_notes_list", arguments: {} }),
      /401|nauthori/i,
    );
    await client.close().catch(() => undefined);

    const response = await handleMcpRequest(
      new Request("http://louez.test/api/mcp", {
        method: "POST",
        headers: { authorization: revoked.authorization, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      httpOptions,
    );
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer/);
    const body = (await response.json()) as { data: { code: string } };
    assert.equal(body.data.code, "UNAUTHENTICATED");
  });

  test("over HTTP, the tool list shows only what the connection may call", async () => {
    const names = async (authorization: string) => {
      const client = await connectHttp(authorization);
      try {
        const { tools } = await client.listTools();
        return tools.map((tool) => tool.name);
      } finally {
        await client.close();
      }
    };

    const owner = await names((await key()).authorization);
    assert.ok(owner.includes("fixture_notes_list"));
    assert.ok(owner.includes("fixture_notes_remove"));

    const readOnly = await names((await key({ permissions: allRead })).authorization);
    assert.ok(readOnly.includes("fixture_notes_list"));
    assert.ok(!readOnly.includes("fixture_notes_remove"), "a read-only key does not see writes");

    const member = await names((await key({ userId: MEMBER })).authorization);
    assert.ok(!member.includes("fixture_notes_remove"), "nor a member, who may not delete");

    // The arguments of a write: the input, plus the headers the bridge maps.
    const client = await connectHttp((await key()).authorization);
    const { tools } = await client.listTools();
    await client.close();
    const remove = tools.find((tool) => tool.name === "fixture_notes_remove");
    assert.deepEqual(Object.keys(remove?.inputSchema.properties ?? {}).sort(), [
      "confirmationToken",
      "id",
      "idempotencyKey",
    ]);
    assert.deepEqual(remove?.annotations, { destructiveHint: true });
  });

  test("over HTTP, resources and prompts are still served, and GET has no session to open", async () => {
    const { authorization } = await key();
    const client = await connectHttp(authorization);
    try {
      const info = await client.readResource({ uri: "louez://store/info" });
      assert.match(JSON.stringify(info.contents), /Store: Transport store/);
      const { prompts } = await client.listPrompts();
      assert.ok(prompts.some((prompt) => prompt.name === "daily-briefing"));
    } finally {
      await client.close();
    }

    const get = await handleMcpRequest(
      new Request("http://louez.test/api/mcp", { headers: { authorization } }),
      httpOptions,
    );
    assert.equal(get.status, 405);
  });

  test("a malformed idempotency key is refused, never silently dropped", async () => {
    const { authorization } = await key();
    const result = await mcpCall(mcpHeaders(authorization), "fixture_notes_remove", {
      id: "note_bad_key",
      idempotencyKey: 42,
    });
    assert.equal(result.isError, true);
    assert.equal(errorCode(result), "INVALID_ARGUMENT");
  });

  test("over HTTP, a body past 4 MiB is refused, and an anonymous one is not even read", async () => {
    const { authorization } = await key();
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { pad: "x".repeat(4 * 1024 * 1024) },
    });
    const tooLarge = await handleMcpRequest(
      new Request("http://louez.test/api/mcp", {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: big,
      }),
      httpOptions,
    );
    assert.equal(tooLarge.status, 413);

    const anonymous = await handleMcpRequest(
      new Request("http://louez.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
      }),
      httpOptions,
    );
    assert.equal(anonymous.status, 401);
  });

  test("over HTTP, every message of a batch counts on the rate limit", async () => {
    const created = await key();
    const orm = await import("drizzle-orm");
    const counter = async () => {
      const [row] = await louezDb.db
        .select({ count: louezDb.apiRateLimits.count })
        .from(louezDb.apiRateLimits)
        .where(orm.eq(louezDb.apiRateLimits.key, `api_key:${created.id}`));
      return row?.count ?? 0;
    };
    const before = await counter();
    await handleMcpRequest(
      new Request("http://louez.test/api/mcp", {
        method: "POST",
        headers: {
          authorization: created.authorization,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify([1, 2, 3].map((id) => ({ jsonrpc: "2.0", id, method: "ping" }))),
      }),
      httpOptions,
    );
    assert.equal((await counter()) - before, 3);
  });

  test("hand-written tools are listed only when the connection may call them", async () => {
    const client = await connectHttp((await key({ permissions: allRead })).authorization);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(names.includes("list_customers"));
      assert.ok(!names.includes("create_customer"), "a read-only key does not see writes");
      assert.ok(!names.includes("update_store_info"));
    } finally {
      await client.close();
    }
  });

  test("hand-written tools: a domain missing from the key is none", async () => {
    // A key written before `customers` was a domain of its permissions.
    const old = await key();
    const { customers: _customers, ...withoutCustomers } = allWrite;
    const orm = await import("drizzle-orm");
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ permissions: withoutCustomers as unknown as Permissions })
      .where(orm.eq(louezDb.apiKeys.id, old.id));

    const client = await connectHttp(old.authorization);
    try {
      const denied = await client.callTool({ name: "list_customers", arguments: {} });
      assert.equal(denied.isError, true);
      assert.match(text(denied), /needs customers:read/);
      assert.match(text(denied), /code: PERMISSION_DENIED/);

      const allowed = await client.callTool({ name: "list_reservations", arguments: {} });
      assert.notEqual(allowed.isError, true, text(allowed));
    } finally {
      await client.close();
    }
  });

  test("hand-written tools: a member's key cannot do more than the member", async () => {
    const memberKey = await key({ userId: MEMBER });
    const member = await connectHttp(memberKey.authorization);
    try {
      // The dashboard lets only the owner change the store's settings.
      const denied = await member.callTool({
        name: "update_store_info",
        arguments: { phone: "+41 00" },
      });
      assert.equal(denied.isError, true);
      assert.match(text(denied), /code: PERMISSION_DENIED/);
      // A member may still write what a member writes.
      const created = await member.callTool({
        name: "create_customer",
        arguments: { email: "member-made@tr.test", firstName: "Ada", lastName: "Lovelace" },
      });
      assert.notEqual(created.isError, true, text(created));
    } finally {
      await member.close();
    }

    const owner = await connectHttp((await key()).authorization);
    try {
      const updated = await owner.callTool({
        name: "update_store_info",
        arguments: { phone: "+41 00" },
      });
      assert.notEqual(updated.isError, true, text(updated));
    } finally {
      await owner.close();
    }
  });
});
