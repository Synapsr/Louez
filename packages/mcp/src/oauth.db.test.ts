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
        // ChatGPT's model reads the structured content: the text does not repeat it.
        const stores = await client.callTool({ name: "stores_list", arguments: {} });
        const text = (stores.content as Array<{ text: string }>)[0].text;
        assert.ok(stores.structuredContent, clientId);
        assert.doesNotMatch(text, /"items":/, clientId);
      });
    }

    // Claude's text keeps the JSON.
    await withClient(await bearer(), async (client) => {
      const stores = await client.callTool({ name: "stores_list", arguments: {} });
      assert.match((stores.content as Array<{ text: string }>)[0].text, /"items":/);
    });

    // The consent page and the editor never offer it to ChatGPT.
    const offered = await grants.offeredBundles({ clientId: CHATGPT_CLIENT_ID, name: "ChatGPT" });
    assert.ok(!offered.includes("billing"));
    assert.ok(offered.includes("daily"));
    const current = await grants.currentTerms({ userId: OWNER, clientId: CHATGPT_CLIENT_ID });
    assert.deepEqual(current?.bundles, ["daily"]);
  });

  test("a long registered name is read whole: the billing exclusion holds at consent and at run time", async () => {
    // A client registered itself with a name past the audit column's 100
    // characters, OpenAI's after them. The name is the client's own choice:
    // this is the directory's policy, not a security boundary.
    const LONG_NAME_CLIENT = "mo_dcr_long_name_client";
    const name = `${"x".repeat(100)} ChatGPT`;
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: LONG_NAME_CLIENT,
      name,
      redirectUris: JSON.stringify(["https://long.mo.test/callback"]),
    });
    const terms = {
      stores: { all: false as const, ids: [STORE_A] },
      preset: "write" as const,
      confirmSensitive: true,
      bundles: ["daily" as const, "billing" as const],
    };
    const offered = await grants.offeredBundles({ clientId: LONG_NAME_CLIENT, name });
    assert.ok(!offered.includes("billing"), "consent hides it");
    const { id: grantId } = await grants.saveGrant({
      userId: OWNER,
      clientId: LONG_NAME_CLIENT,
      terms,
    });
    const saved = await grants.loadActiveGrant({ userId: OWNER, clientId: LONG_NAME_CLIENT });
    assert.equal(saved?.clientName.length, 100, "the audit keeps 100 characters");
    assert.equal(saved?.registeredName, name);
    const token = await tokens.sign({ userId: OWNER, clientId: LONG_NAME_CLIENT, grantId });
    await withClient({ authorization: `Bearer ${token}` }, async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.deepEqual(
        names.filter((tool) => tool.startsWith("billing_")),
        [],
      );
      const refused = await client.callTool({ name: "billing_get_status", arguments: {} });
      assert.equal(errorCode(refused), "NOT_AVAILABLE_TO_THIS_AGENT");
    });
  });

  test("ChatGPT hands the store's creation to the user through a link", async () => {
    const { CHATGPT_CLIENT_ID } = await import("@louez/api/platform/agent-clients");
    const handoffs = await import("@louez/api/services/handoffs");
    await louezDb.db
      .insert(louezDb.oauthClients)
      .values({
        clientId: CHATGPT_CLIENT_ID,
        name: "ChatGPT",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://chatgpt.com/connector_platform_oauth_redirect"]),
      })
      .onDuplicateKeyUpdate({ set: { name: "ChatGPT" } });
    const { id: grantId } = await grants.saveGrant({
      userId: OWNER,
      clientId: CHATGPT_CLIENT_ID,
      terms: {
        stores: { all: true },
        preset: "write",
        confirmSensitive: true,
        bundles: ["daily", "settings", "catalog"],
      },
    });
    const chatgpt = {
      authorization: `Bearer ${await tokens.sign({ userId: OWNER, clientId: CHATGPT_CLIENT_ID, grantId })}`,
    };
    // What OpenAI forbids a plugin to show: Louez's plans, fees and subscription.
    const LOUEZ_PRICING =
      /pay-as-you-go|subscription|\bplans?\b|billing relationship|fee per reservation|feePerReservation|freeReservations|welcome gift|\boffer\b/i;
    const ownStores = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.stores.id })
          .from(louezDb.stores)
          .where(eq(louezDb.stores.userId, OWNER))
      ).map((store) => store.id);
    const before = await ownStores();
    const proposal = { name: "Brest Paddle", slug: "mo-brest-paddle", country: "FR", currency: "EUR" };

    const first = await withClient(chatgpt, async (client) => {
      const tools = (await client.listTools()).tools;
      const create = tools.find((tool) => tool.name === "stores_create");
      assert.ok(create, "listed under its usual name");
      assert.equal(create.inputSchema.properties?.confirmationToken, undefined, "no preview to confirm");
      // Nothing a ChatGPT connection reads names Louez's pricing.
      for (const tool of tools) assert.doesNotMatch(tool.description ?? "", LOUEZ_PRICING, tool.name);
      assert.doesNotMatch(client.getInstructions() ?? "", LOUEZ_PRICING);
      assert.match(client.getInstructions() ?? "", /stores_create gives the user a link/);

      const result = await client.callTool({ name: "stores_create", arguments: proposal });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      assert.doesNotMatch(JSON.stringify(result), LOUEZ_PRICING);
      return result.structuredContent as {
        url: string;
        handoff: { id: string; kind: string; status: string; storeId: string | null };
      };
    });
    assert.equal(first.handoff.kind, "store_creation");
    assert.equal(first.handoff.status, "pending");
    assert.equal(first.handoff.storeId, null);
    assert.deepEqual(await ownStores(), before, "nothing is created until the user does");

    // Asking again while it is open replaces the link of the same step.
    const again = await withClient(chatgpt, async (client) =>
      client.callTool({ name: "stores_create", arguments: { ...proposal, name: "Brest Paddle Co" } }),
    );
    const second = again.structuredContent as typeof first;
    assert.equal(second.handoff.id, first.handoff.id);
    assert.notEqual(second.url, first.url);
    const token = second.url.split("/handoffs/")[1] ?? "";
    assert.equal((await handoffs.readHandoffLink(first.url.split("/handoffs/")[1] ?? "", OWNER)).ok, false);

    // The user opens the link: only them, and the dashboard's store step starts from the proposal.
    assert.equal((await handoffs.readHandoffLink(token, "someone_else")).ok, false);
    const continued = await handoffs.continueHandoff(token, OWNER);
    assert.ok(continued.ok && continued.state);
    const launch = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    assert.ok(launch.ok && launch.redirect.includes(`/onboarding?new=true&handoff=${first.handoff.id}`));
    const handed = await handoffs.readStoreCreationHandoff(first.handoff.id, OWNER);
    assert.equal(handed?.payload.store?.name, "Brest Paddle Co");
    assert.equal(await handoffs.readStoreCreationHandoff(first.handoff.id, "someone_else"), null);

    const read = (id: string) =>
      withClient(chatgpt, async (client) => {
        const result = await client.callTool({ name: "handoffs_get", arguments: { id } });
        assert.notEqual(result.isError, true, JSON.stringify(result.content));
        return result.structuredContent as { status: string; storeId: string | null };
      });
    assert.equal((await read(first.handoff.id)).status, "opened");

    // The user creates the store in the dashboard; it completes the handoff.
    const NEW_STORE = "mo_store_paddle_0001";
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: NEW_STORE, userId: OWNER, name: "Brest Paddle Co", slug: "mo-brest-paddle" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: NEW_STORE, userId: OWNER, role: "owner" });
    assert.equal(
      await handoffs.completeStoreCreation(first.handoff.id, "someone_else", NEW_STORE),
      false,
      "another user's step",
    );
    assert.equal(
      await handoffs.completeStoreCreation(first.handoff.id, OWNER, STORE_ELSEWHERE.replace("x", "z")),
      false,
      "a store they do not own",
    );
    assert.equal(await handoffs.completeStoreCreation(first.handoff.id, OWNER, NEW_STORE), true);
    const done = await read(first.handoff.id);
    assert.equal(done.status, "completed");
    assert.equal(done.storeId, NEW_STORE);

    // The connection reaches the new store at once, and its setup answers
    // name no plan or fee either.
    await withClient(chatgpt, async (client) => {
      const listed = await client.callTool({ name: "stores_list", arguments: {} });
      const ids = (listed.structuredContent as { items: Array<{ id: string }> }).items.map(
        (store) => store.id,
      );
      assert.ok(ids.includes(NEW_STORE));
      const checklist = await client.callTool({
        name: "stores_get_launch_checklist",
        arguments: { storeId: NEW_STORE },
      });
      assert.notEqual(checklist.isError, true, JSON.stringify(checklist.content));
      assert.doesNotMatch(JSON.stringify(checklist), LOUEZ_PRICING);
      const goLive = await client.callTool({ name: "stores_go_live", arguments: { storeId: NEW_STORE } });
      assert.doesNotMatch(JSON.stringify(goLive), LOUEZ_PRICING);
    });

    // A link the user never used expires; asking again gives a new one.
    const expiring = await withClient(chatgpt, async (client) =>
      client.callTool({ name: "stores_create", arguments: { ...proposal, slug: "mo-brest-sup" } }),
    );
    const open = (expiring.structuredContent as typeof first).handoff.id;
    assert.notEqual(open, first.handoff.id, "a completed step is not reused");
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(louezDb.apiHandoffs.id, open));
    assert.equal((await read(open)).status, "expired");
    const renewed = await withClient(chatgpt, async (client) =>
      client.callTool({ name: "stores_create", arguments: proposal }),
    );
    const renewedView = (renewed.structuredContent as typeof first).handoff;
    assert.equal(renewedView.id, open);
    assert.equal(renewedView.status, "pending");

    // Claude keeps creating the store itself, after its preview with the pricing.
    const CLAUDE_USER = "mo_claude_user_00001";
    await louezDb.db.insert(louezDb.users).values({ id: CLAUDE_USER, email: "claude@mo.test" });
    const claudeGrant = await grants.saveGrant({
      userId: CLAUDE_USER,
      clientId: CLIENT,
      terms: { stores: { all: true }, preset: "write", confirmSensitive: true, bundles: ["daily"] },
    });
    const claude = {
      authorization: `Bearer ${await tokens.sign({ userId: CLAUDE_USER, clientId: CLIENT, grantId: claudeGrant.id })}`,
    };
    await withClient(claude, async (client) => {
      const create = (await client.listTools()).tools.find((tool) => tool.name === "stores_create");
      assert.match(create?.description ?? "", /billing relationship/);
      const preview = await client.callTool({
        name: "stores_create",
        arguments: { ...proposal, slug: "mo-claude-store" },
      });
      assert.equal(errorCode(preview), "CONFIRMATION_REQUIRED");
      // And it reads nothing of another user's step.
      const foreign = await client.callTool({ name: "handoffs_get", arguments: { id: open } });
      assert.equal(errorCode(foreign), "HANDOFF_NOT_FOUND");
    });
    assert.deepEqual((await ownStores()).sort(), [...before, NEW_STORE].sort());
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
    // A hand-written tool too.
    const legacy = await withClient(headers, (client) =>
      client.callTool({ name: "list_customers", arguments: {} }),
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
      client.callTool({ name: "list_customers", arguments: {} }),
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

    for (const name of ["reservations_list", "list_customers"]) {
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
