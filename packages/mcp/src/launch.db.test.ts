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

// The launch tools, through the app's real router and the real MCP and
// OpenAPI handlers: their bundle, the server's instructions for a store not
// online yet, and a go-live an agent confirms.

const OWNER = "lx_owner_user_000001";
const MEMBER = "lx_member_user_00001";
const STORE = "lx_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("launch tools (database)", { skip: skipWithoutTestDatabase() }, () => {
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
  let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
  let mcpTools: (authorization: string) => Promise<string[]>;
  let mcpInstructions: (authorization: string) => Promise<string>;

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
    database = await createTestDatabase("api_launch_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
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
    mcpInstructions = async (authorization) => {
      const mcp = await connect(authorization);
      try {
        return mcp.getInstructions() ?? "";
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

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@lx.test" },
      { id: MEMBER, email: "member@lx.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Brest Surf",
      slug: "lx-brest-surf",
      settings: {
        reservationMode: "payment",
        advanceNoticeMinutes: 60,
        currency: "EUR",
        country: "FR",
      },
    });
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
  const readOnly: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function key(
    permissions: Permissions = { ...readOnly, settings: "write", online_store: "write" },
    userId = OWNER,
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId,
      name: "Launch agent",
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

  test("the launch tools are in the daily bundle and listed by their rights", async () => {
    const launch = exposure.procedures.filter((entry) =>
      ["dashboard.stores.getLaunchChecklist", "dashboard.stores.completeOnboarding"].includes(
        entry.path,
      ),
    );
    assert.deepEqual(launch.map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle]).sort(), [
      ["stores_get_launch_checklist", "daily"],
      ["stores_go_live", "daily"],
    ]);
    // A former onboarding route is not exposed.
    assert.ok(!exposure.procedures.some((entry) => entry.path.startsWith("dashboard.onboarding.")));

    const writer = await mcpTools(await key());
    assert.ok(writer.includes("stores_get_launch_checklist"));
    assert.ok(writer.includes("stores_go_live"));
    const reader = await mcpTools(await key(readOnly));
    assert.ok(reader.includes("stores_get_launch_checklist"));
    assert.ok(!reader.includes("stores_go_live"), "a read-only key does not see the launch");
  });

  test("the instructions point a store not online yet to the checklist and the launch", async () => {
    const authorization = await key();
    const instructions = await mcpInstructions(authorization);
    assert.match(
      instructions,
      /not online yet[^\n]*stores_get_launch_checklist[^\n]*stores_go_live/,
    );
  });

  test("an agent reads the checklist, confirms the launch on MCP, and OpenAPI serves the routes", async () => {
    const authorization = await key();
    const checklist = output(await mcpCall(authorization, "stores_get_launch_checklist", {}));
    assert.equal(checklist.online, false);
    assert.equal(checklist.canGoLive, true);
    const items = checklist.items as Array<{ key: string; status: string }>;
    assert.equal(items.find((item) => item.key === "products")?.status, "missing");

    const first = await mcpCall(authorization, "stores_go_live", { reservationMode: "request" });
    const text = (first.content as Array<{ text: string }>)[0]?.text ?? "";
    assert.match(text, /online at https:\/\/lx-brest-surf\.louez\.test/);
    const done = output(
      await mcpCall(authorization, "stores_go_live", {
        reservationMode: "request",
        confirmationToken: tokenOf(first),
      }),
    );
    assert.equal(done.launched, true);
    assert.deepEqual(done.links, {
      dashboard: `${TEST_APP_URL}/dashboard?store=${STORE}`,
      storefront: "https://lx-brest-surf.louez.test",
    });

    const read = await openApi("GET", "/stores/launch-checklist", null, { authorization });
    assert.equal(read.status, 200);
    assert.equal(((await read.json()) as { online: boolean }).online, true);
    // Live already: no confirmation, the URL again.
    const again = await openApi("POST", "/stores/go-live", {}, { authorization });
    assert.equal(again.status, 200);
    const body = (await again.json()) as { launched: boolean; storefrontUrl: string };
    assert.equal(body.launched, false);
    assert.equal(body.storefrontUrl, "https://lx-brest-surf.louez.test");

    // The member's key may read, not launch.
    const member = await key(undefined, MEMBER);
    assert.notEqual((await mcpCall(member, "stores_get_launch_checklist", {})).isError, true);
    assert.equal(toolError(await mcpCall(member, "stores_go_live", {}))?.code, "PERMISSION_DENIED");
  });
});
