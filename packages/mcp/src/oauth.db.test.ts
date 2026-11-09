import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";
import { openAiProfileProblem } from "./testing/openai-profile";

// An MCP client connected through OAuth, on /api/mcp's real handler and the
// app's router: discovery on a 401, tool bundles, the store a request names
// (header or `storeId` argument), and a revoked grant. Access tokens are
// signed with a test key and checked by the real verifier.

const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const RESOURCE_METADATA = "https://app.louez.test/.well-known/oauth-protected-resource/api/mcp";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: { api: { getSession: async () => null } },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

const OWNER = "mo_owner_user_000001";
const STORE_A = "mo_store_a_000000001";
const STORE_B = "mo_store_b_000000001";
const STORE_ELSEWHERE = "mo_store_x_000000001";
const CLIENT = "https://claude.mo.test/oauth/client.json";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

describe("MCP over OAuth (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let grants: typeof import("@louez/api/services/agent-grants");
  let apiKeys: typeof import("@louez/api/services");
  let handleMcpRequest: typeof import("./transports/http").handleMcpRequest;
  let httpOptions: import("./transports/http").McpHttpOptions;

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
    tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
    database = await createTestDatabase("mcp_oauth");
    louezDb = await import("@louez/db");
    grants = await import("@louez/api/services/agent-grants");
    apiKeys = await import("@louez/api/services");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    ({ handleMcpRequest } = await import("./transports/http"));
    httpOptions = {
      ports,
      procedures: createExposure(appRouter).procedures,
      resourceMetadataUrl: RESOURCE_METADATA,
      deps: {
        insertRecordedPayment: async () => undefined,
      },
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@mo.test" });
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE_A, userId: OWNER, name: "A store", slug: "mo-store-a" },
      { id: STORE_B, userId: OWNER, name: "B store", slug: "mo-store-b" },
      { id: STORE_ELSEWHERE, userId: OWNER, name: "X store", slug: "mo-store-x" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE_A, userId: OWNER, role: "owner" },
      { storeId: STORE_B, userId: OWNER, role: "owner" },
      { storeId: STORE_ELSEWHERE, userId: OWNER, role: "owner" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: "Claude",
      clientDiscoveryId: "cimd",
      redirectUris: JSON.stringify(["https://claude.mo.test/callback"]),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.apiAgentGrants);
    await louezDb.db.delete(louezDb.apiRateLimits);
  });

  const grant = (terms: Partial<Parameters<typeof grants.saveGrant>[0]["terms"]> = {}) =>
    grants.saveGrant({
      userId: OWNER,
      clientId: CLIENT,
      terms: {
        stores: { all: false, ids: [STORE_A] },
        preset: "write",
        confirmSensitive: true,
        bundles: ["daily"],
        ...terms,
      },
    });

  const post = (headers: Record<string, string>) =>
    handleMcpRequest(
      new Request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      httpOptions,
    );

  async function withClient<T>(
    headers: Record<string, string>,
    run: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(RESOURCE), {
        requestInit: { headers },
        fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
      }),
    );
    try {
      return await run(client);
    } finally {
      await client.close();
    }
  }

  const bearer = async () => ({
    authorization: `Bearer ${await tokens.sign({
      userId: OWNER,
      clientId: CLIENT,
      grantId: (await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT }))?.id ?? null,
    })}`,
  });
  const errorCode = (result: ToolResult) =>
    (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;

  test("a request without a credential points the client to where it signs in", async () => {
    const anonymous = await post({});
    assert.equal(anonymous.status, 401);
    const challenge = anonymous.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, new RegExp(`resource_metadata="${RESOURCE_METADATA}"`));
    assert.doesNotMatch(challenge, /invalid_token/);

    const refused = await post({ authorization: "Bearer not.a.token" });
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
  });

  test("a token issued for another resource or by another issuer is refused", async () => {
    const { id: grantId } = await grant();
    assert.equal((await post(await bearer())).status, 200, "the same token for this resource");
    for (const claims of [
      { audience: "https://app.louez.test/api/v1" },
      { audience: "https://other.example/api/mcp" },
      { issuer: "https://other.example/api/auth" },
    ]) {
      const token = await tokens.sign({ userId: OWNER, clientId: CLIENT, grantId, ...claims });
      const refused = await post({ authorization: `Bearer ${token}` });
      assert.equal(refused.status, 401, JSON.stringify(claims));
      const challenge = refused.headers.get("www-authenticate") ?? "";
      assert.match(challenge, /error="invalid_token"/);
      assert.match(challenge, new RegExp(`resource_metadata="${RESOURCE_METADATA}"`));
    }
  });

  test("a grant lists the tools of its bundles; an API key lists every bundle", async () => {
    await grant({ bundles: ["daily"] });
    const daily = await withClient(await bearer(), async (client) =>
      (await client.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(daily.includes("stores_list"));
    assert.ok(daily.includes("get_dashboard_stats"), "a daily hand-written tool");
    assert.ok(!daily.includes("categories_list"), "the catalog bundle is not listed");
    assert.ok(!daily.includes("products_list"));

    // Not listed is not forbidden: the call is authorized where it runs.
    const hidden = await withClient(await bearer(), (client) =>
      client.callTool({ name: "categories_list", arguments: {} }),
    );
    assert.equal(hidden.isError, undefined, JSON.stringify(hidden.content));

    await grant({ bundles: ["daily", "catalog"] });
    const both = await withClient(await bearer(), async (client) =>
      (await client.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(both.includes("categories_list"));
    assert.ok(both.includes("products_list"));
    assert.ok(!both.includes("list_products"), "a former name is callable, never listed");

    const key = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE_A,
      userId: OWNER,
      name: "Every bundle",
      permissions: {
        reservations: "read",
        products: "read",
        customers: "read",
        categories: "read",
        payments: "read",
        analytics: "read",
        settings: "read",
      },
    });
    const all = await withClient({ authorization: `Bearer ${key.key}` }, async (client) =>
      (await client.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(all.includes("categories_list") && all.includes("reservations_list"));
  });

  test("ChatGPT neither sees nor calls the billing tools, whatever its grant", async () => {
    const { CHATGPT_CLIENT_ID } = await import("@louez/api/platform/agent-clients");
    const REGISTERED = "mo_dcr_chatgpt_client";
    await louezDb.db.insert(louezDb.oauthClients).values([
      {
        clientId: CHATGPT_CLIENT_ID,
        name: "ChatGPT",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://chatgpt.com/connector_platform_oauth_redirect"]),
      },
      // ChatGPT registering itself (dynamic registration) under its name.
      {
        clientId: REGISTERED,
        name: "ChatGPT",
        redirectUris: JSON.stringify(["https://chatgpt.com/connector/oauth/abc"]),
      },
    ]);
    const terms = {
      stores: { all: false as const, ids: [STORE_A] },
      preset: "write" as const,
      confirmSensitive: true,
      bundles: ["daily" as const, "billing" as const],
    };

    // Claude, with the billing bundle, lists them.
    await grant({ bundles: terms.bundles });
    const claude = await withClient(await bearer(), async (client) =>
      (await client.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(claude.includes("billing_get_status") && claude.includes("billing_start_card_setup"));

    for (const clientId of [CHATGPT_CLIENT_ID, REGISTERED]) {
      const { id: grantId } = await grants.saveGrant({ userId: OWNER, clientId, terms });
      const token = await tokens.sign({ userId: OWNER, clientId, grantId });
      await withClient({ authorization: `Bearer ${token}` }, async (client) => {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        assert.ok(names.includes("reservations_list"), clientId);
        assert.deepEqual(
          names.filter((name) => name.startsWith("billing_")),
          [],
          clientId,
        );
        const instructions = client.getInstructions() ?? "";
        assert.doesNotMatch(instructions, /billing/i, clientId);
        for (const name of ["billing_get_status", "billing_start_card_setup"]) {
          const refused = await client.callTool({ name, arguments: {} });
          assert.equal(errorCode(refused), "NOT_AVAILABLE_TO_THIS_AGENT", `${clientId} ${name}`);
        }
      });
    }

    // The consent page and the editor never offer it to ChatGPT.
    const offered = await grants.offeredBundles({ clientId: CHATGPT_CLIENT_ID, name: "ChatGPT" });
    assert.ok(!offered.includes("billing"));
    assert.ok(offered.includes("daily"));
    const current = await grants.currentTerms({ userId: OWNER, clientId: CHATGPT_CLIENT_ID });
    assert.deepEqual(current?.bundles, ["daily"]);
  });

  test("a grant over several stores names the store in each call", async () => {
    await grant({ stores: { all: false, ids: [STORE_A, STORE_B] }, bundles: ["daily", "catalog"] });
    const headers = await bearer();

    const { tools, instructions } = await withClient(headers, async (client) => ({
      tools: (await client.listTools()).tools,
      instructions: client.getInstructions() ?? "",
    }));
    const categories = tools.find((tool) => tool.name === "categories_list");
    assert.ok(categories?.inputSchema.properties?.storeId, "store tools take storeId");
    const storesTool = tools.find((tool) => tool.name === "stores_list");
    assert.equal(storesTool?.inputSchema.properties?.storeId, undefined);
    assert.match(instructions, /stores_list/);

    const listed = await withClient(headers, (client) =>
      client.callTool({ name: "stores_list", arguments: {} }),
    );
    assert.deepEqual(
      (listed.structuredContent as { items: Array<{ id: string }> }).items.map((store) => store.id),
      [STORE_A, STORE_B],
    );

    const unnamed = await withClient(headers, (client) =>
      client.callTool({ name: "categories_list", arguments: {} }),
    );
    assert.equal(unnamed.isError, true);
    assert.equal(errorCode(unnamed), "STORE_REQUIRED");
    const legacy = await withClient(headers, (client) =>
      client.callTool({ name: "list_reservations", arguments: {} }),
    );
    assert.equal(legacy.isError, true);
    assert.match(JSON.stringify(legacy.content), /STORE_REQUIRED/);

    const named = await withClient(headers, (client) =>
      client.callTool({ name: "categories_list", arguments: { storeId: STORE_B } }),
    );
    assert.equal(named.isError, undefined, JSON.stringify(named.content));

    // A store of the user that the grant does not cover: the call says so.
    const outside = await withClient(headers, (client) =>
      client.callTool({ name: "categories_list", arguments: { storeId: STORE_ELSEWHERE } }),
    );
    assert.equal(outside.isError, true);
    assert.equal(errorCode(outside), "NO_STORE_ACCESS");

    // The header works too, and then names the store of every call.
    const byHeader = await withClient({ ...headers, "louez-store": STORE_B }, (client) =>
      client.callTool({ name: "list_reservations", arguments: {} }),
    );
    assert.equal(byHeader.isError, undefined, JSON.stringify(byHeader.content));
  });

  test("the profile tool names the account, with no store to choose", async () => {
    await grant({ stores: { all: false, ids: [STORE_A, STORE_B] }, bundles: ["daily"] });
    const headers = await bearer();
    const call = () =>
      withClient(headers, (client) =>
        client.callTool({ name: "account_get_profile", arguments: {} }),
      );

    const setName = (name: string | null) =>
      louezDb.db.update(louezDb.users).set({ name }).where(eq(louezDb.users.id, OWNER));

    // No name, or a blank one: left out, never null, as ChatGPT's profile takes it.
    for (const name of [null, "   "]) {
      await setName(name);
      const unnamed = (await call()).structuredContent;
      assert.deepEqual(unnamed, { id: OWNER });
      assert.equal(openAiProfileProblem(unnamed), null);
    }
    await setName(" Morgane Owner ");
    const named = await call();
    assert.deepEqual(named.structuredContent, { id: OWNER, name: "Morgane Owner" });
    assert.equal(openAiProfileProblem(named.structuredContent), null);
    assert.doesNotMatch(JSON.stringify(named), /owner@mo\.test/, "never the e-mail");
    await setName(null);
  });

  test("a grant over all stores of an account with none creates its first store", async () => {
    const NEWCOMER = "mo_newcomer_user_001";
    await louezDb.db.insert(louezDb.users).values({ id: NEWCOMER, email: "new@mo.test" });
    const grantNewcomer = (preset: "read" | "write") =>
      grants.saveGrant({
        userId: NEWCOMER,
        clientId: CLIENT,
        terms: { stores: { all: true }, preset, confirmSensitive: true, bundles: ["daily"] },
      });
    const newcomer = async () => ({
      authorization: `Bearer ${await tokens.sign({
        userId: NEWCOMER,
        clientId: CLIENT,
        grantId: (await grants.loadActiveGrant({ userId: NEWCOMER, clientId: CLIENT }))?.id ?? null,
      })}`,
    });

    // Read-only: the door opens, but stores_create is not offered.
    await grantNewcomer("read");
    const readOnly = await withClient(await newcomer(), async (client) => ({
      tools: (await client.listTools()).tools.map((tool) => tool.name),
      instructions: client.getInstructions() ?? "",
    }));
    assert.ok(readOnly.tools.includes("stores_list"));
    assert.ok(!readOnly.tools.includes("stores_create"));
    assert.match(readOnly.instructions, /reaches no store yet/);

    await grantNewcomer("write");
    const headers = await newcomer();
    const { tools, instructions } = await withClient(headers, async (client) => ({
      tools: (await client.listTools()).tools,
      instructions: client.getInstructions() ?? "",
    }));
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("stores_create"), "shown whatever the bundles");
    assert.ok(names.includes("stores_check_slug_availability"));
    assert.ok(names.includes("reservations_list"), "the store's tools, listed as for its owner");
    const createTool = tools.find((tool) => tool.name === "stores_create");
    assert.ok(createTool?.inputSchema.properties?.idempotencyKey);
    assert.ok(createTool?.inputSchema.properties?.confirmationToken);
    assert.equal(createTool?.inputSchema.properties?.storeId, undefined);
    assert.ok(
      tools.find((tool) => tool.name === "reservations_list")?.inputSchema.properties?.storeId,
      "store tools take storeId: the grant may gain stores",
    );
    assert.match(instructions, /no store yet/);
    assert.match(instructions, /stores_create/);

    const empty = await withClient(headers, (client) =>
      client.callTool({ name: "stores_list", arguments: {} }),
    );
    assert.deepEqual((empty.structuredContent as { items: unknown[] }).items, []);
    assert.match(String((empty.structuredContent as { hint?: string }).hint), /stores_create/);

    for (const name of ["reservations_list", "list_reservations"]) {
      const refused = await withClient(headers, (client) =>
        client.callTool({ name, arguments: {} }),
      );
      assert.equal(refused.isError, true, name);
      assert.match(JSON.stringify(refused.content), /NO_STORE_YET/, name);
    }

    const args = {
      name: "Brest Surf",
      slug: "mo-brest-surf",
      country: "FR",
      currency: "EUR",
      idempotencyKey: "mo-create-1",
    };
    const asked = await withClient(headers, (client) =>
      client.callTool({ name: "stores_create", arguments: args }),
    );
    assert.equal(errorCode(asked), "CONFIRMATION_REQUIRED");
    const token = String(
      (asked.structuredContent as { error: { details: { confirmationToken: string } } }).error
        .details.confirmationToken,
    );
    const created = await withClient(headers, (client) =>
      client.callTool({ name: "stores_create", arguments: { ...args, confirmationToken: token } }),
    );
    assert.equal(created.isError, undefined, JSON.stringify(created.content));
    const storeId = (created.structuredContent as { id: string }).id;
    assert.match(JSON.stringify(created.content), /dashboard\?store=/);

    // The same connection now reaches the store it created.
    const listed = await withClient(await newcomer(), (client) =>
      client.callTool({ name: "stores_list", arguments: {} }),
    );
    assert.deepEqual(
      (listed.structuredContent as { items: Array<{ id: string }> }).items.map((store) => store.id),
      [storeId],
    );
    const reservations = await withClient(await newcomer(), (client) =>
      client.callTool({ name: "reservations_list", arguments: {} }),
    );
    assert.equal(reservations.isError, undefined, JSON.stringify(reservations.content));
  });

  test("a revoked grant refuses the next request", async () => {
    const { id } = await grant();
    const headers = await bearer();
    assert.equal((await post(headers)).status, 200);
    await grants.revokeGrant({ userId: OWNER, id });
    const refused = await post(headers);
    assert.equal(refused.status, 401);
    assert.equal(
      ((await refused.json()) as { data?: { code?: string } }).data?.code,
      "UNAUTHENTICATED",
    );
  });
});
