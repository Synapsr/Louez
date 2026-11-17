import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// `reservations_create` and `POST /reservations` through the app's real
// router and the real MCP and OpenAPI handlers: listed in the daily bundle,
// refused without an idempotency key, asked of an OAuth connection as its
// option says, a person's approval for an override, and a confirmation
// carried out on the same key.

const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const SESSION_HEADER = "x-test-session-user";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
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
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

const OWNER = "ct_owner_user_000001";
const STORE = "ct_store_a_000000001";
const CUSTOMER = "ct_customer_00000001";
const PRODUCT = "ct_product_000000001";
const CLIENT = "https://claude.ct.test/oauth/client.json";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe(
  "reservations_create over MCP and REST (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let grants: typeof import("@louez/api/services/agent-grants");
    let openApi: (path: string, body: object, headers: Record<string, string>) => Promise<Response>;
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
      emailConfigured: () => true,
    };

    before(async () => {
      tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
      database = await createTestDatabase("mcp_reservation_create");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      grants = await import("@louez/api/services/agent-grants");
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { createOpenApiHandler, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");
      const { handleMcpRequest } = await import("./transports/http");
      const exposure = createExposure(appRouter);

      const openApiHandler = createOpenApiHandler(exposure.router);
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

      const httpOptions = { ports, procedures: exposure.procedures };
      const connect = async (authorization: string) => {
        const mcp = new Client({ name: "test", version: "0.0.0" });
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL(RESOURCE), {
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
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: OWNER,
        name: "Create store",
        slug: "ct-store-a",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: true,
        },
      });
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: OWNER, role: "owner" });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@ct.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
      await louezDb.db.insert(louezDb.products).values({
        id: PRODUCT,
        storeId: STORE,
        name: "Kayak",
        price: "10.00",
        pricingMode: "day",
        quantity: 3,
      });
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        name: "Claude",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://claude.ct.test/callback"]),
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
    const writes: Permissions = {
      reservations: "write",
      products: "read",
      customers: "write",
      categories: "read",
      payments: "read",
      analytics: "read",
      settings: "read",
    };

    async function apiKey(permissions: Permissions = writes) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Booking agent",
        permissions,
      });
      return `Bearer ${created.key}`;
    }

    async function oauthToken(confirmSensitive: boolean) {
      const { id: grantId } = await grants.saveGrant({
        userId: OWNER,
        clientId: CLIENT,
        terms: {
          stores: { all: false, ids: [STORE] },
          preset: "write",
          confirmSensitive,
          bundles: ["daily"],
        },
      });
      return `Bearer ${await tokens.sign({ userId: OWNER, clientId: CLIENT, grantId })}`;
    }

    const errorOf = (result: ToolResult) =>
      (result.structuredContent as { error?: { code?: string; details?: Json } } | undefined)
        ?.error;
    const output = (result: ToolResult) => {
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return result.structuredContent as Json;
    };
    const createdCount = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.reservations.id })
          .from(louezDb.reservations)
          .where(orm.eq(louezDb.reservations.storeId, STORE))
      ).length;

    let day = 0;
    /** A booking on its own day, so the calls never meet in the stock. */
    const args = (extra: Json = {}) => {
      day += 1;
      const start = new Date(Date.UTC(2031, 0, day, 9));
      return {
        customer: { id: CUSTOMER },
        startDate: start.toISOString(),
        endDate: new Date(start.getTime() + 86_400_000).toISOString(),
        lines: [{ productId: PRODUCT, quantity: 1 }],
        status: "quote",
        notifyCustomer: true,
        ...extra,
      };
    };

    test("listed in the daily bundle, and served at POST /reservations", async () => {
      const authorization = await oauthToken(true);
      assert.ok((await mcpTools(authorization)).includes("reservations_create"));

      const response = await openApi("/reservations", args(), {
        authorization: await apiKey(),
        "idempotency-key": "rest-1",
      });
      // A key asks for a confirmation by default.
      assert.equal(response.status, 412);
      const body = (await response.json()) as { data: { code: string } };
      assert.equal(body.data.code, "CONFIRMATION_REQUIRED");
    });

    test("without an idempotency key, an API key and an OAuth token are refused over MCP, nothing written", async () => {
      const before = await createdCount();
      for (const authorization of [await apiKey(), await oauthToken(false)]) {
        const result = await mcpCall(authorization, "reservations_create", args());
        assert.equal(errorOf(result)?.code, "IDEMPOTENCY_KEY_REQUIRED");
      }
      assert.equal(await createdCount(), before);
    });

    test("an OAuth connection confirms by its option, and the confirmation runs on the same key", async () => {
      const asking = await oauthToken(true);
      const input = args();
      const first = await mcpCall(asking, "reservations_create", {
        ...input,
        idempotencyKey: "oa-1",
      });
      assert.equal(errorOf(first)?.code, "CONFIRMATION_REQUIRED");
      const before = await createdCount();
      const token = String((errorOf(first)?.details ?? {}).confirmationToken);
      const done = output(
        await mcpCall(asking, "reservations_create", {
          ...input,
          idempotencyKey: "oa-1",
          confirmationToken: token,
        }),
      );
      assert.equal(await createdCount(), before + 1);
      assert.deepEqual(done.message, {
        sent: true,
        kind: "quote",
        to: "ada@ct.test",
        reason: null,
      });
      // The same key again: the first answer, nothing more.
      const replay = output(
        await mcpCall(asking, "reservations_create", { ...input, idempotencyKey: "oa-1" }),
      );
      assert.equal(replay.id, done.id);
      assert.equal(await createdCount(), before + 1);

      // Its option off: no message, nothing short, it runs at once.
      const silent = await oauthToken(false);
      output(
        await mcpCall(silent, "reservations_create", {
          ...args({ notifyCustomer: false }),
          idempotencyKey: "oa-2",
        }),
      );
      assert.equal(await createdCount(), before + 2);
    });

    test("with its option off, a connection's creation that messages the customer runs at once", async () => {
      const silent = await oauthToken(false);
      const result = await mcpCall(silent, "reservations_create", {
        ...args(),
        idempotencyKey: "msg-1",
      });
      assert.equal((output(result).message as Json).sent, true);
    });

    test("an override asks for the user's approval over MCP, whatever the option", async () => {
      for (const confirmSensitive of [true, false]) {
        const token = await oauthToken(confirmSensitive);
        const result = await mcpCall(token, "reservations_create", {
          ...args({ allowOverbooking: true, notifyCustomer: false }),
          idempotencyKey: `ov-${confirmSensitive}`,
        });
        assert.equal(errorOf(result)?.code, "APPROVAL_REQUIRED");
        assert.match(
          String((errorOf(result)?.details?.approval as { url?: string } | undefined)?.url),
          /^https?:\/\//,
        );
      }
    });

    test("a read-only connection is refused", async () => {
      const result = await mcpCall(
        await apiKey({ ...writes, reservations: "read" }),
        "reservations_create",
        { ...args(), idempotencyKey: "ro-1" },
      );
      assert.equal(errorOf(result)?.code, "PERMISSION_DENIED");
    });
  },
);
