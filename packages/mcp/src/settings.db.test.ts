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

// The settings tools, through the app's real router and the real MCP and
// OpenAPI handlers: the settings bundle, the former tool names kept as
// aliases, and a confirmation an agent goes through.

const OWNER = "sx_owner_user_000001";
const MEMBER = "sx_member_user_00001";
const STORE = "sx_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("settings tools (database)", { skip: skipWithoutTestDatabase() }, () => {
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
    database = await createTestDatabase("api_settings_tools");
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
    mcpTools = async (authorization) => {
      const mcp = await connect(authorization);
      try {
        return (await mcp.listTools()).tools.map((tool) => tool.name);
      } finally {
        await mcp.close();
      }
    };

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@sx.test" },
      { id: MEMBER, email: "member@sx.test" },
    ]);
    await louezDb.db
      .insert(louezDb.stores)
      .values({
        id: STORE,
        userId: OWNER,
        name: "Brest Surf",
        slug: "sx-brest-surf",
        latitude: "48.3904000",
        longitude: "-4.4861000",
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
    permissions: Permissions = { ...readOnly, settings: "write" },
    userId = OWNER,
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId,
      name: "Settings agent",
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

  test("every settings tool is in the settings bundle, and the former names are not listed", async () => {
    const settings = exposure.procedures.filter((entry) =>
      entry.path.startsWith("dashboard.settings."),
    );
    assert.deepEqual(settings.map((entry) => entry.meta.mcp.name).sort(), [
      "settings_create_location",
      "settings_get",
      "settings_set_location_active",
      "settings_update_business_hours",
      "settings_update_company",
      "settings_update_delivery",
      "settings_update_legal",
      "settings_update_location",
      "settings_update_reservation_rules",
      "settings_update_store_info",
      "settings_update_taxes",
    ]);
    assert.deepEqual([...new Set(settings.map((entry) => entry.meta.mcp.bundle))], ["settings"]);
    const aliases = settings.flatMap((entry) =>
      (entry.meta.mcp.aliases ?? []).map((alias) => alias.name),
    );
    assert.deepEqual(aliases.sort(), [
      "get_store_settings",
      "update_store_info",
      "update_store_legal",
    ]);

    const writer = await mcpTools(await key());
    for (const entry of settings)
      assert.ok(writer.includes(entry.meta.mcp.name), entry.meta.mcp.name);
    for (const alias of aliases) assert.ok(!writer.includes(alias), `${alias} is not listed`);

    const reader = await mcpTools(await key(readOnly));
    assert.ok(reader.includes("settings_get"));
    assert.ok(!reader.includes("settings_update_taxes"), "a read-only key does not see writes");
  });

  test("the former tool names still work with their former arguments", async () => {
    const authorization = await key();
    const info = output(
      await mcpCall(authorization, "update_store_info", {
        name: "Brest Surf School",
        email: "hello@sx.test",
        description: "Boards and wetsuits.",
      }),
    );
    assert.equal((info.store as Json).name, "Brest Surf School");
    const legal = output(
      await mcpCall(authorization, "update_store_legal", {
        cgv: "<p>Terms</p><script>x()</script>",
        legalNotice: "Brest Surf SAS",
        includeCgvInContract: true,
      }),
    );
    // The former tool stored its HTML as sent; the script tag is gone now.
    const texts = legal.legal as Json;
    assert.doesNotMatch(String(texts.cgv), /<script/);
    assert.match(String(texts.cgv), /^<p>Terms<\/p>/);
    assert.equal(texts.legalNotice, "<p>Brest Surf SAS</p>");
    assert.equal(texts.includeCgvInContract, true);
    const settings = output(await mcpCall(authorization, "get_store_settings", {}));
    assert.equal((settings.store as Json).email, "hello@sx.test");
    assert.equal(
      (settings.links as Json).dashboard,
      `${TEST_APP_URL}/dashboard/settings?store=${STORE}`,
    );

    const denied = await mcpCall(await key(readOnly), "update_store_info", { name: "No" });
    assert.equal(toolError(denied)?.code, "PERMISSION_DENIED");
    // The dashboard lets only the owner change the store's settings; so does a member's key.
    const member = await key(undefined, MEMBER);
    const memberDenied = await mcpCall(member, "update_store_info", { phone: "+41 22 345 67 89" });
    assert.equal(toolError(memberDenied)?.code, "PERMISSION_DENIED");
    assert.notEqual((await mcpCall(member, "settings_get", {})).isError, true);
  });

  test("an agent confirms a tax change on MCP; OpenAPI serves the REST paths", async () => {
    const authorization = await key();
    const first = await mcpCall(authorization, "settings_update_taxes", {
      enabled: true,
      defaultRate: 20,
      displayMode: "inclusive",
    });
    const token = tokenOf(first);
    const done = output(
      await mcpCall(authorization, "settings_update_taxes", {
        enabled: true,
        defaultRate: 20,
        displayMode: "inclusive",
        confirmationToken: token,
      }),
    );
    assert.equal((done.taxes as Json).enabled, true);

    const read = await openApi("GET", "/settings", null, { authorization });
    assert.equal(read.status, 200);
    assert.equal(((await read.json()) as { taxes: Json }).taxes.defaultRate, 20);

    const created = await openApi(
      "POST",
      "/settings/locations",
      { name: "Moulin Blanc", address: "Rue du Moulin Blanc" },
      { authorization },
    );
    assert.equal(created.status, 200);
    const location = (await created.json()) as { id: string };
    const hidden = await openApi(
      "POST",
      `/settings/locations/${location.id}/active`,
      { isActive: false },
      { authorization },
    );
    assert.equal(((await hidden.json()) as { isActive: boolean }).isActive, false);
    const hours = await openApi(
      "PATCH",
      "/settings/business-hours",
      { schedule: { saturday: { isOpen: false, ranges: [] } } },
      { authorization },
    );
    assert.equal(hours.status, 200);
  });
});
