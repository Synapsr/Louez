import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq, sql } from "drizzle-orm";

import type { ApiPorts } from "@louez/api";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestProductImages } from "@louez/api/platform/test-product-images";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { createTestAccessTokens } from "@louez/auth/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// ChatGPT signs in with OAuth: its access tokens are signed with a test key.
let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: { api: { getSession: async () => null } },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

// The AI photo tools and jobs_get through the app's real router and the real
// MCP and OpenAPI handlers: the same answers and error codes on both, the
// confirmation every agent gets before credits are spent, and the undo. The
// pipeline is a fake: no provider is called.

const OWNER = "pj_owner_user_000001";
const STORE = "pj_store_a_000000001";
const FILES = "https://files.louez.test";
const SOURCE = `${FILES}/${STORE}/products/tent.png`;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("AI photo tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let runJob: typeof import("@louez/api/services/jobs").runJob;
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let connect: (authorization: string) => Promise<Client>;

  let fake = createTestProductImages(FILES);
  const dispatched: string[] = [];
  const ports: ApiPorts = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    dispatchJobs: (ids) => {
      dispatched.push(...ids);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    get productImages() {
      return fake.port;
    },
  };

  before(async () => {
    tokens = await createTestAccessTokens({
      issuer: "https://app.louez.test/api/auth",
      audience: "https://app.louez.test/api/mcp",
    });
    database = await createTestDatabase("api_photo_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    ({ runJob } = await import("@louez/api/services/jobs"));
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest, routeBodyLimits } =
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
        { ports, bodyLimits: routeBodyLimits(exposure.procedures) },
      )) ?? new Response(null, { status: 404 });

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
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

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@pj.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Brest Camping",
      slug: "pj-brest-camping",
      onboardingCompleted: true,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    fake = createTestProductImages(FILES);
    dispatched.length = 0;
    await louezDb.db.delete(louezDb.apiJobs);
    await louezDb.db.delete(louezDb.products);
  });

  /** A key whose confirmations are off: spending credits still asks. */
  async function key() {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Photo agent",
      permissions: {
        reservations: "read",
        products: "write",
        customers: "none",
        categories: "read",
        payments: "none",
        analytics: "none",
        settings: "read",
      },
    });
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ confirmSensitive: false })
      .where(eq(louezDb.apiKeys.id, created.id));
    return `Bearer ${created.key}`;
  }

  async function product() {
    const [row] = await louezDb.db
      .insert(louezDb.products)
      .values({
        storeId: STORE,
        name: "Tente 4 places",
        price: "30",
        pricingMode: "day",
        status: "active",
        images: [SOURCE],
      })
      .$returningId();
    assert.ok(row);
    return row.id;
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
  const errorOf = (result: ToolResult) => {
    assert.equal(result.isError, true);
    return (result.structuredContent as { error: { code: string; details?: Json } }).error;
  };

  test("the tools are in the catalog bundle, say how to undo, and the instructions say to show before and after", async () => {
    const names = exposure.procedures
      .filter((entry) =>
        [
          "dashboard.products.enhanceImage",
          "dashboard.products.removeImageBackground",
          "dashboard.products.useImageVersion",
          "dashboard.jobs.get",
        ].includes(entry.path),
      )
      .map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle])
      .sort();
    assert.deepEqual(names, [
      ["jobs_get", "catalog"],
      ["products_enhance_image", "catalog"],
      ["products_remove_image_background", "catalog"],
      ["products_use_image_version", "catalog"],
    ]);

    const { tools, instructions } = await withClient(await key(), async (mcp) => ({
      tools: (await mcp.listTools()).tools,
      instructions: mcp.getInstructions() ?? "",
    }));
    for (const name of ["products_enhance_image", "products_remove_image_background"]) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      assert.match(description, /the result replaces the photo on the product/);
      assert.match(
        description,
        /products_use_image_version with the job's source\.versionId puts it back/,
      );
      assert.match(description, /before \(source\.url\)[^.]*after \(result\.url\)/);
      assert.match(description, /always answers CONFIRMATION_REQUIRED/);
    }
    assert.match(instructions, /the before and after images to show the user/);
    assert.match(instructions, /To undo, products_use_image_version takes the original's id/);
    assert.match(instructions, /jobs_get with the job's id/);
  });

  test("an agent confirms the price, follows the job on both transports, and undoes it", async () => {
    const id = await product();
    const authorization = await key();

    // MCP: the first call previews, even with confirmations off.
    const previewed = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: { id, imageUrl: SOURCE } }),
    );
    const refusal = errorOf(previewed);
    assert.equal(refusal.code, "CONFIRMATION_REQUIRED");
    // OpenAPI answers the same.
    const viaOpenApi = await openApi(
      "POST",
      `/products/${id}/images/enhance`,
      { imageUrl: SOURCE },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 412);
    assert.equal(((await viaOpenApi.json()) as { data: Json }).data.code, "CONFIRMATION_REQUIRED");

    const started = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({
          name: "products_enhance_image",
          arguments: {
            id,
            imageUrl: SOURCE,
            confirmationToken: refusal.details?.confirmationToken as string,
          },
        }),
      ),
    ) as Json & { id: string; source: { url: string; versionId: string } };
    assert.equal(started.status, "queued");
    assert.equal(started.source.url, SOURCE);
    assert.deepEqual(dispatched, [started.id]);

    await runJob(started.id, ports);

    const viaMcp = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({ name: "jobs_get", arguments: { id: started.id } }),
      ),
    ) as Json & { result: { url: string; creditsCharged: number } };
    assert.equal(viaMcp.status, "succeeded");
    assert.equal(viaMcp.result.creditsCharged, 2);
    const read = await openApi("GET", `/jobs/${started.id}`, null, { authorization });
    assert.equal(read.status, 200);
    const body = (await read.json()) as Json & { result: { url: string } };
    assert.equal(body.status, "succeeded");
    assert.equal(body.result.url, viaMcp.result.url);

    // Undo over OpenAPI: the original is back on the product.
    const undone = await openApi(
      "POST",
      `/products/${id}/images/use-version`,
      { versionId: started.source.versionId },
      { authorization },
    );
    assert.equal(undone.status, 200);
    assert.deepEqual(((await undone.json()) as { images: string[] }).images, [SOURCE]);

    // A job of another store is not found, on both transports.
    const missing = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "jobs_get", arguments: { id: "nope" } }),
    );
    assert.equal(errorOf(missing).code, "JOB_NOT_FOUND");
    assert.equal((await openApi("GET", "/jobs/nope", null, { authorization })).status, 404);
  });

  test("a refusal has the same code on both transports", async () => {
    const id = await product();
    const authorization = await key();
    const other = `${FILES}/${STORE}/products/other.png`;
    const viaMcp = await withClient(authorization, (mcp) =>
      mcp.callTool({
        name: "products_remove_image_background",
        arguments: { id, imageUrl: other },
      }),
    );
    assert.equal(errorOf(viaMcp).code, "IMAGE_NOT_ON_PRODUCT");
    const viaOpenApi = await openApi(
      "POST",
      `/products/${id}/images/remove-background`,
      { imageUrl: other },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 400);
    assert.equal(((await viaOpenApi.json()) as { data: Json }).data.code, "IMAGE_NOT_ON_PRODUCT");
  });

  test("ChatGPT neither sees nor calls the AI photo tools nor jobs_get, before any confirmation; the version switch stays", async () => {
    const grants = await import("@louez/api/services/agent-grants");
    const { ProductImageFailure } = await import("@louez/api/platform/ports");
    const { CHATGPT_CLIENT_ID } = await import("@louez/api/platform/agent-clients");
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
        stores: { all: false, ids: [STORE] },
        preset: "write",
        confirmSensitive: true,
        bundles: ["daily", "catalog"],
      },
    });
    const chatgpt = `Bearer ${await tokens.sign({ userId: OWNER, clientId: CHATGPT_CLIENT_ID, grantId })}`;
    const apiKey = await key();
    const id = await product();
    const PURCHASE = /buy|recharge|top.?up|upgrade|plan|ai-credits|credit/i;
    const WITHHELD = ["products_enhance_image", "products_remove_image_background", "jobs_get"];

    // Its list and instructions name none of them, nor how a photo is improved.
    const { names, instructions } = await withClient(chatgpt, async (mcp) => ({
      names: (await mcp.listTools()).tools.map((tool) => tool.name),
      instructions: mcp.getInstructions() ?? "",
    }));
    for (const name of WITHHELD) {
      assert.ok(!names.includes(name), name);
      assert.ok(!instructions.includes(name), name);
    }
    assert.ok(names.includes("products_use_image_version"));
    assert.doesNotMatch(instructions, /improve a product photo|AI credits/);

    // A call is refused before its preview, even out of credits, with nothing to buy;
    // the same call again, under its idempotency key or with a token, replays nothing.
    const written = async () => ({
      confirmations: (
        await louezDb.db
          .select({ id: louezDb.apiConfirmations.id })
          .from(louezDb.apiConfirmations)
          .where(eq(louezDb.apiConfirmations.storeId, STORE))
      ).length,
      operations: (
        await louezDb.db
          .select({ id: louezDb.apiOperations.id })
          .from(louezDb.apiOperations)
          .where(eq(louezDb.apiOperations.credentialId, grantId))
      ).length,
      jobs: (await louezDb.db.select({ id: louezDb.apiJobs.id }).from(louezDb.apiJobs)).length,
    });
    const before = await written();
    fake.state.quote = {
      ...fake.state.quote,
      credits: { allowed: false, monthlyRemainingMicro: 0, prepaidMicro: 0 },
    };
    for (const name of ["products_enhance_image", "products_remove_image_background"]) {
      const idempotencyKey = `pj-chatgpt-${name}`;
      for (const args of [
        { id, imageUrl: SOURCE, idempotencyKey },
        { id, imageUrl: SOURCE, idempotencyKey },
        { id, imageUrl: SOURCE, idempotencyKey, confirmationToken: "pj-not-a-token" },
      ]) {
        const refused = await withClient(chatgpt, (mcp) => mcp.callTool({ name, arguments: args }));
        const error = errorOf(refused);
        assert.equal(error.code, "NOT_AVAILABLE_TO_THIS_AGENT", name);
        assert.equal(error.details?.confirmationToken, undefined, name);
        assert.equal(refused._meta, undefined, `${name}: no operation was replayed`);
        assert.doesNotMatch(JSON.stringify(refused), PURCHASE, name);
      }
      const keyed = await louezDb.db
        .select({ id: louezDb.apiOperations.id })
        .from(louezDb.apiOperations)
        .where(eq(louezDb.apiOperations.idempotencyKey, idempotencyKey));
      assert.deepEqual(keyed, [], `${name}: no idempotency key was claimed`);
    }
    const job = await withClient(chatgpt, (mcp) =>
      mcp.callTool({ name: "jobs_get", arguments: { id: "nope" } }),
    );
    assert.equal(errorOf(job).code, "NOT_AVAILABLE_TO_THIS_AGENT");
    assert.deepEqual(await written(), before, "no confirmation, operation or job was written");
    // The version switch is reached: it answers about the version, not the agent.
    const version = await withClient(chatgpt, (mcp) =>
      mcp.callTool({ name: "products_use_image_version", arguments: { id, versionId: "nope" } }),
    );
    assert.equal(errorOf(version).code, "IMAGE_VERSION_NOT_FOUND");

    // Another agent still gets the way to buy more.
    const other = await withClient(apiKey, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: { id, imageUrl: SOURCE } }),
    );
    assert.match(JSON.stringify(other), /ai-credits\?recharge=1/);

    // A failed photo job, started by another agent, is not in ChatGPT's inbox: it can neither follow nor retry it.
    fake = createTestProductImages(FILES);
    const preview = await withClient(apiKey, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: { id, imageUrl: SOURCE } }),
    );
    const confirmationToken = errorOf(preview).details?.confirmationToken as string;
    const started = output(
      await withClient(apiKey, (mcp) =>
        mcp.callTool({
          name: "products_enhance_image",
          arguments: { id, imageUrl: SOURCE, confirmationToken },
        }),
      ),
    ) as Json & { id: string };
    fake.state.failNext = new ProductImageFailure("IMAGE_EMPTY", "empty", false);
    await runJob(started.id, ports);
    await louezDb.db
      .update(louezDb.apiJobs)
      .set({ finishedAt: sql`NOW(3) - INTERVAL 1 MINUTE` })
      .where(eq(louezDb.apiJobs.id, started.id));
    const failedItems = async (authorization: string) => {
      const listed = output(
        await withClient(authorization, (mcp) =>
          mcp.callTool({ name: "inbox_list", arguments: {} }),
        ),
      ) as { items: Array<{ type: string; tools: string[] }> };
      return listed.items.filter((item) => item.type === "image_job_failed");
    };
    assert.deepEqual(await failedItems(chatgpt), []);
    assert.deepEqual(
      (await failedItems(apiKey)).map((item) => item.tools),
      [["jobs_get", "products_enhance_image"]],
    );

    // Nor an operation of its own, from before, whose outcome is unknown on a tool it lost.
    const unknown = (procedure: string) => ({
      storeId: STORE,
      userId: OWNER,
      credentialKind: "oauth" as const,
      credentialId: grantId,
      clientName: "ChatGPT",
      transport: "mcp" as const,
      procedure,
      actorKey: grantId,
      inputHash: "0".repeat(64),
      status: "unknown" as const,
      targetId: id,
      createdAt: sql`NOW(3) - INTERVAL 1 HOUR`,
      updatedAt: sql`NOW(3) - INTERVAL 2 MINUTE`,
    });
    await louezDb.db
      .insert(louezDb.apiOperations)
      .values([
        unknown("dashboard.products.enhanceImage"),
        unknown("dashboard.products.removeImageBackground"),
        unknown("dashboard.products.update"),
      ]);
    const listed = output(
      await withClient(chatgpt, (mcp) => mcp.callTool({ name: "inbox_list", arguments: {} })),
    ) as { items: Array<{ type: string; details: Json }> };
    assert.deepEqual(
      listed.items
        .filter((item) => item.type === "operation_unknown")
        .map((item) => item.details.procedure),
      ["dashboard.products.update"],
    );
    assert.doesNotMatch(JSON.stringify(listed), /enhanceImage|removeImageBackground|enhance_image/);
  });

  test("Claude neither sees nor calls products_enhance_image, a replay included; other agents keep it", async () => {
    const grants = await import("@louez/api/services/agent-grants");
    const { ProductImageFailure } = await import("@louez/api/platform/ports");
    const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const AGENT = "pj_dcr_desktop_agent";
    await louezDb.db.insert(louezDb.oauthClients).values([
      {
        clientId: CLAUDE,
        name: "Claude",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]),
      },
      {
        clientId: AGENT,
        name: "Desktop agent",
        redirectUris: JSON.stringify(["https://agent.pj.test/callback"]),
      },
    ]);
    const bearer = async (clientId: string) => {
      const { id: grantId } = await grants.saveGrant({
        userId: OWNER,
        clientId,
        terms: {
          stores: { all: false, ids: [STORE] },
          preset: "write",
          confirmSensitive: false,
          bundles: ["daily", "catalog"],
        },
      });
      return `Bearer ${await tokens.sign({ userId: OWNER, clientId, grantId })}`;
    };
    const claude = await bearer(CLAUDE);
    const agent = await bearer(AGENT);
    const apiKey = await key();
    const id = await product();

    // Claude's list and instructions leave the AI enhancement out, and keep the rest.
    for (const [who, authorization, enhances] of [
      ["Claude", claude, false],
      ["another agent", agent, true],
      ["an API key", apiKey, true],
    ] as const) {
      const { names, instructions } = await withClient(authorization, async (mcp) => ({
        names: (await mcp.listTools()).tools.map((tool) => tool.name),
        instructions: mcp.getInstructions() ?? "",
      }));
      assert.equal(names.includes("products_enhance_image"), enhances, who);
      for (const name of [
        "products_remove_image_background",
        "products_use_image_version",
        "jobs_get",
      ]) {
        assert.ok(names.includes(name), `${who}: ${name}`);
      }
      assert.equal(instructions.includes("products_enhance_image"), enhances, who);
      assert.match(
        instructions,
        /products_remove_image_background, with one of the product's images/,
      );
    }

    // A direct call is refused before its preview; the background removal still previews.
    const refused = await withClient(claude, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: { id, imageUrl: SOURCE } }),
    );
    assert.equal(errorOf(refused).code, "NOT_AVAILABLE_TO_THIS_AGENT");
    const removal = await withClient(claude, (mcp) =>
      mcp.callTool({
        name: "products_remove_image_background",
        arguments: { id, imageUrl: SOURCE },
      }),
    );
    assert.equal(errorOf(removal).code, "CONFIRMATION_REQUIRED");

    // Another agent enhances under an idempotency key...
    const IDEMPOTENCY = "pj-enhance-1";
    const preview = await withClient(agent, (mcp) =>
      mcp.callTool({
        name: "products_enhance_image",
        arguments: { id, imageUrl: SOURCE, idempotencyKey: IDEMPOTENCY },
      }),
    );
    const confirmationToken = errorOf(preview).details?.confirmationToken as string;
    const args = { id, imageUrl: SOURCE, idempotencyKey: IDEMPOTENCY, confirmationToken };
    const started = output(
      await withClient(agent, (mcp) =>
        mcp.callTool({ name: "products_enhance_image", arguments: args }),
      ),
    ) as Json & { id: string };
    // ...then its client turns out to be Claude: the same call is refused, not replayed.
    await louezDb.db
      .update(louezDb.oauthClients)
      .set({ name: "Claude Desktop" })
      .where(eq(louezDb.oauthClients.clientId, AGENT));
    const replay = await withClient(agent, (mcp) =>
      mcp.callTool({ name: "products_enhance_image", arguments: args }),
    );
    assert.equal(errorOf(replay).code, "NOT_AVAILABLE_TO_THIS_AGENT");
    assert.equal(replay._meta, undefined, "no operation was replayed");

    // A failed enhancement in Claude's inbox names only the job.
    fake.state.failNext = new ProductImageFailure("IMAGE_EMPTY", "empty", false);
    await runJob(started.id, ports);
    await louezDb.db
      .update(louezDb.apiJobs)
      .set({ finishedAt: sql`NOW(3) - INTERVAL 1 MINUTE` })
      .where(eq(louezDb.apiJobs.id, started.id));
    const failedItemTools = async (authorization: string) => {
      const listed = output(
        await withClient(authorization, (mcp) =>
          mcp.callTool({ name: "inbox_list", arguments: {} }),
        ),
      ) as { items: Array<{ type: string; tools: string[] }> };
      return listed.items.find((item) => item.type === "image_job_failed")?.tools;
    };
    assert.deepEqual(await failedItemTools(claude), ["jobs_get"]);
    assert.deepEqual(await failedItemTools(apiKey), ["jobs_get", "products_enhance_image"]);
  });

  test("a client recognised by its redirect URIs gets its vendor's directory rules, whatever its name", async () => {
    const grants = await import("@louez/api/services/agent-grants");
    const { MCP_BUNDLES } = await import("@louez/api/platform/meta");
    // Clients that registered themselves: every one named "Evil" but the
    // neutral one, which says what an unrestricted grant lists.
    const clients = {
      neutral: ["https://agent.pj.test/callback"],
      openAi: ["https://chatgpt.com/connector/oauth/pj1", "https://platform.openai.com/pj"],
      anthropic: ["https://claude.ai/api/mcp/auth_callback"],
      openAiAndLoopback: ["https://chatgpt.com/connector/oauth/pj2", "http://127.0.0.1:8787/cb"],
      anthropicAndElsewhere: ["https://claude.ai/api/mcp/auth_callback", "https://evil.pj.test/cb"],
    };
    await louezDb.db.insert(louezDb.oauthClients).values(
      Object.entries(clients).map(([key, redirectUris]) => ({
        clientId: `pj_dcr_${key}`,
        name: key === "neutral" ? "Desktop agent" : "Evil",
        redirectUris: JSON.stringify(redirectUris),
      })),
    );
    const listed = async (key: keyof typeof clients) => {
      const clientId = `pj_dcr_${key}`;
      const { id: grantId } = await grants.saveGrant({
        userId: OWNER,
        clientId,
        terms: {
          stores: { all: true },
          preset: "write",
          confirmSensitive: true,
          bundles: [...MCP_BUNDLES],
        },
      });
      const authorization = `Bearer ${await tokens.sign({ userId: OWNER, clientId, grantId })}`;
      return withClient(authorization, async (mcp) => ({
        names: (await mcp.listTools()).tools.map((tool) => tool.name),
        instructions: mcp.getInstructions() ?? "",
      }));
    };
    const neutral = await listed("neutral");
    const missingFrom = async (key: keyof typeof clients) => {
      const { names } = await listed(key);
      return neutral.names.filter((name) => !names.includes(name)).sort();
    };

    // Only OpenAI receives its codes: OpenAI's set, exactly.
    assert.deepEqual(await missingFrom("openAi"), [
      "billing_get_status",
      "billing_start_card_setup",
      "jobs_get",
      "products_enhance_image",
      "products_remove_image_background",
      "stores_create",
    ]);
    const openAi = await listed("openAi");
    assert.doesNotMatch(openAi.instructions, /billing|stores_create|products_enhance_image/);
    // Only Anthropic: the AI enhancement alone.
    assert.deepEqual(await missingFrom("anthropic"), ["products_enhance_image"]);
    // A redirect elsewhere: nothing from the redirects, as before.
    assert.deepEqual(await missingFrom("openAiAndLoopback"), []);
    assert.deepEqual(await missingFrom("anthropicAndElsewhere"), []);

    // A call is refused too, as for ChatGPT's own client.
    const { id: grantId } = await grants.saveGrant({
      userId: OWNER,
      clientId: "pj_dcr_openAi",
      terms: { stores: { all: true }, preset: "write", confirmSensitive: true, bundles: ["daily"] },
    });
    const token = await tokens.sign({ userId: OWNER, clientId: "pj_dcr_openAi", grantId });
    const refused = await withClient(`Bearer ${token}`, (mcp) =>
      mcp.callTool({ name: "billing_get_status", arguments: {} }),
    );
    assert.equal(errorOf(refused).code, "NOT_AVAILABLE_TO_THIS_AGENT");
  });
});
