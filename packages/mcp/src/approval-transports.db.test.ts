import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

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
          return id ? { user: { id, email: `${id}@at.test` } } : null;
        },
      },
    },
  },
});

// What an agent receives and sends, on each transport, when a call needs a
// confirmation or a person's approval: the transport tests' fixture
// (`fixture.notes.remove`, `fixture.notes.erase`) and the real
// `handoffs_get`, served through the real OpenAPI handler of /api/v1 and the
// real MCP handler of /api/mcp, the person deciding through the dashboard's
// RPC handler with a session, as the approval's page does.

const OWNER = "at_owner_user_000001";
const STORE = "at_store_a_000000001";
const EXPOSED = ["fixture.notes.remove", "fixture.notes.erase", "dashboard.handoffs.get"];

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe(
  "confirmations and approvals on each transport (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let appDocument: () => Promise<unknown>;
    /** The routers as each transport serves them: `token` asks for tokens only, `live` makes `money` a person's. */
    let serve: Record<
      "token" | "live",
      {
        openApi: (
          method: string,
          path: string,
          body: object | null,
          headers: Record<string, string>,
        ) => Promise<Response>;
        mcp: (
          authorization: string,
          name: string,
          args: object,
          headers?: Record<string, string>,
        ) => Promise<ToolResult>;
        tools: (authorization: string) => Promise<Array<{ name: string; inputSchema: Json }>>;
      }
    >;

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
      database = await createTestDatabase("api_approval_transports");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { createFixtureRouter } = await import("@louez/api/platform/testing");
      const { createOpenApiHandler, generateOpenApiDocument, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");
      const { handleMcpRequest } = await import("./transports/http");

      appDocument = () => generateOpenApiDocument(createExposure(appRouter).router);

      const served = (router: object) => {
        const exposure = createExposure(router as never, EXPOSED);
        const openApiHandler = createOpenApiHandler(exposure.router);
        const httpOptions = { ports, procedures: exposure.procedures };
        const connect = async (authorization: string, headers: Record<string, string> = {}) => {
          const client = new Client({ name: "test", version: "0.0.0" });
          await client.connect(
            new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
              requestInit: { headers: { authorization, ...headers } },
              fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
            }),
          );
          return client;
        };
        return {
          openApi: async (
            method: string,
            path: string,
            body: object | null,
            headers: Record<string, string>,
          ) =>
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
            )) ?? new Response(null, { status: 404 }),
          mcp: async (
            authorization: string,
            name: string,
            args: object,
            headers: Record<string, string> = {},
          ) => {
            const client = await connect(authorization, headers);
            try {
              return await client.callTool({ name, arguments: args as Record<string, unknown> });
            } finally {
              await client.close();
            }
          },
          tools: async (authorization: string) => {
            const client = await connect(authorization);
            try {
              return (await client.listTools()).tools as Array<{ name: string; inputSchema: Json }>;
            } finally {
              await client.close();
            }
          },
        };
      };
      const routerOf = (fixture: ReturnType<typeof createFixtureRouter>) => ({
        ...fixture,
        dashboard: { handoffs: appRouter.dashboard.handoffs },
      });
      serve = {
        token: served(routerOf(createFixtureRouter())),
        live: served(routerOf(createFixtureRouter({ liveConsequences: ["money"] }))),
      };

      await louezDb.db.insert(louezDb.users).values([{ id: OWNER, email: "owner@at.test" }]);
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      const { db } = louezDb;
      for (const table of [
        louezDb.apiHandoffs,
        louezDb.apiOperations,
        louezDb.apiConfirmations,
        louezDb.apiKeys,
        louezDb.apiRateLimits,
        louezDb.categories,
        louezDb.storeMembers,
        louezDb.stores,
      ]) {
        await db.delete(table);
      }
      await db
        .insert(louezDb.stores)
        .values({ id: STORE, userId: OWNER, name: "Roscoff Voile", slug: "at-roscoff" });
      await db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: OWNER, role: "owner" });
    });

    /** An API key of the owner, writing categories (the fixture's domain). */
    async function apiKey() {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Store agent",
        permissions: {
          reservations: "read",
          products: "none",
          customers: "none",
          categories: "write",
          payments: "none",
          analytics: "none",
          settings: "none",
          team: "none",
        },
      });
      return { id: created.id, authorization: `Bearer ${created.key}` };
    }

    /** A note the fixture's erase erases: a category of the store, by its id. */
    const addNote = (id: string) =>
      louezDb.db.insert(louezDb.categories).values({ id, storeId: STORE, name: `Note ${id}` });

    const text = (result: ToolResult) =>
      (result.content as Array<{ type: string; text?: string }>)
        .map((part) => part.text ?? "")
        .join("");
    const errorOf = (result: ToolResult) =>
      (result.structuredContent as { error: Json & { details: Json } }).error;

    /** The headers of an answer, but its date; the operation a refused write recorded named, not its id. */
    const headersOf = (response: Response) =>
      Object.fromEntries(
        [...response.headers]
          .filter(([name]) => name !== "date")
          .map(([name, value]) => [
            name,
            name === "louez-operation-id" && /^[A-Za-z0-9_-]{21}$/.test(value) ? "(id)" : value,
          ]),
      );

    // --- The token flow, as it stands before pull request 5 -------------------

    test("MCP: CONFIRMATION_REQUIRED and CONFIRMATION_INVALID, their text and structured content", async () => {
      const { authorization } = await apiKey();
      for (const [name, args, summary, details] of [
        ["fixture_notes_remove", { id: "note_1" }, "Remove note note_1.", { id: "note_1" }],
        [
          "fixture_notes_erase",
          { id: "note_1", consequences: ["money"], amount: 40 },
          "Erase note note_1 of Roscoff Voile.",
          { id: "note_1", amount: 40 },
        ],
      ] as const) {
        const asked = await serve.token.mcp(authorization, name, args);
        assert.equal(asked.isError, true);
        const error = errorOf(asked);
        const token = String(error.details.confirmationToken);
        const expiresAt = String(error.details.expiresAt);
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        assert.deepEqual(asked.structuredContent, {
          error: {
            message: `${summary} Nothing was done yet. To go ahead, call again with the same input and this confirmation token.`,
            code: "CONFIRMATION_REQUIRED",
            retryable: false,
            details: { preview: { summary, details }, confirmationToken: token, expiresAt },
          },
        });
        assert.equal(
          text(asked),
          [
            `Confirmation required: ${summary}`,
            `Check: ${JSON.stringify(details)}`,
            "Nothing was done yet. Show this to the user and ask them to confirm.",
            `If they confirm, call ${name} again with the same arguments and confirmationToken: "${token}" (valid until ${expiresAt}, once).`,
            "code: CONFIRMATION_REQUIRED",
            "retryable: false",
          ].join("\n"),
        );

        const invalid = await serve.token.mcp(authorization, name, {
          ...args,
          confirmationToken: "x".repeat(43),
        });
        assert.equal(invalid.isError, true);
        const message =
          "The confirmation token is unknown, expired, already used, or no longer matches the input or the current state. Call again without it to get a new preview.";
        assert.deepEqual(invalid.structuredContent, {
          error: { message, code: "CONFIRMATION_INVALID", retryable: false },
        });
        assert.equal(text(invalid), `${message}\ncode: CONFIRMATION_INVALID\nretryable: false`);
      }
    });

    test("MCP: the confirmationToken argument of a sensitive tool", async () => {
      const tools = await serve.token.tools((await apiKey()).authorization);
      for (const name of ["fixture_notes_remove", "fixture_notes_erase"]) {
        const tool = tools.find((entry) => entry.name === name);
        assert.ok(tool, name);
        assert.deepEqual((tool.inputSchema.properties as Json).confirmationToken, {
          type: "string",
          description:
            "Leave it out on the first call: the tool answers CONFIRMATION_REQUIRED with a preview and this token. After the user confirms, call again with the same arguments and the token.",
        });
      }
    });

    test("OpenAPI: CONFIRMATION_REQUIRED and CONFIRMATION_INVALID, their status, body and headers", async () => {
      const { authorization } = await apiKey();
      await addNote("note_2");
      const body = { id: "note_2", consequences: ["money"], amount: 40 };
      const asked = await serve.token.openApi("POST", "/fixture/notes/erase", body, {
        authorization,
        "idempotency-key": "erase-note-2",
      });
      assert.equal(asked.status, 412);
      // A refused write is recorded too: its operation is named, as a refusal's own trace.
      assert.deepEqual(headersOf(asked), {
        "content-type": "application/json",
        "louez-operation-id": "(id)",
      });
      const required = (await asked.json()) as Json & { data: { details: Json } };
      const token = String(required.data.details.confirmationToken);
      const summary = "Erase note note_2 of Roscoff Voile.";
      assert.deepEqual(required, {
        defined: false,
        code: "PRECONDITION_FAILED",
        status: 412,
        message: `${summary} Nothing was done yet. To go ahead, call again with the same input and this confirmation token.`,
        data: {
          code: "CONFIRMATION_REQUIRED",
          retryable: false,
          details: {
            preview: { summary, details: { id: "note_2", amount: 40 } },
            confirmationToken: token,
            expiresAt: required.data.details.expiresAt,
          },
        },
      });

      const invalid = await serve.token.openApi("POST", "/fixture/notes/erase", body, {
        authorization,
        "louez-confirmation": "y".repeat(43),
      });
      assert.equal(invalid.status, 412);
      assert.deepEqual(headersOf(invalid), {
        "content-type": "application/json",
        "louez-operation-id": "(id)",
      });
      assert.deepEqual(await invalid.json(), {
        defined: false,
        code: "PRECONDITION_FAILED",
        status: 412,
        message:
          "The confirmation token is unknown, expired, already used, or no longer matches the input or the current state. Call again without it to get a new preview.",
        data: { code: "CONFIRMATION_INVALID", retryable: false },
      });

      // The same key and input, with the token: it runs, with its receipt.
      const done = await serve.token.openApi("POST", "/fixture/notes/erase", body, {
        authorization,
        "idempotency-key": "erase-note-2",
        "louez-confirmation": token,
      });
      assert.equal(done.status, 200);
      assert.ok(done.headers.get("louez-operation-id"));
      assert.equal(((await done.json()) as { erased: boolean }).erased, true);
    });

    test("OpenAPI: RATE_LIMITED answers 429 with details.retryAfterSeconds, and no Retry-After header", async () => {
      const key = await apiKey();
      const call = () =>
        serve.token.openApi(
          "POST",
          "/fixture/notes/remove",
          { id: "note_3" },
          { authorization: key.authorization },
        );
      await call();
      const rows = louezDb.apiRateLimits;
      const now = Date.now();
      await louezDb.db
        .update(rows)
        .set({ count: 120, windowStart: now - (now % 60_000) })
        .where(orm.eq(rows.key, `api_key:${key.id}`));
      const limited = await call();
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), null);
      const answer = (await limited.json()) as { data: { code: string; details: Json } };
      assert.equal(answer.data.code, "RATE_LIMITED");
      assert.equal(typeof answer.data.details.retryAfterSeconds, "number");
    });

    test("the app's OpenAPI document names no approval code, and the confirmation header as before", async () => {
      const document = JSON.stringify(await appDocument());
      assert.doesNotMatch(document, /\b(APPROVAL_[A-Z_]+|APPROVALS_FULL)\b/);
      const { components } = (await appDocument()) as {
        components: { parameters: Record<string, Json> };
      };
      assert.deepEqual(components.parameters.LouezConfirmation, {
        name: "Louez-Confirmation",
        in: "header",
        required: false,
        description:
          "The token a CONFIRMATION_REQUIRED error returned. Send the same input again with it to go ahead. Valid 10 minutes, once.",
        schema: { type: "string" },
      });
    });
  },
);
