import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// A write that declares `requiresIdempotencyKey`, on the three transports: an
// API key or an OAuth token without a key is refused before anything is read
// or written, a dashboard session is not asked, and a key runs it once and
// replays. Unflagged writes, their MCP schema and their OpenAPI operation are
// as before. A session is read from a test header and access tokens are signed
// with a test key: Better Auth stays out.

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
          return id ? { user: { id, email: `${id}@ik.test` } } : null;
        },
      },
    },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

const OWNER = "ik_owner_user_000001";
const STORE = "ik_store_a_000000001";
const CLIENT = "https://claude.ik.test/oauth/client.json";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Tool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

describe(
  "a write that requires an idempotency key (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let grants: typeof import("@louez/api/services/agent-grants");
    let exposure: import("@louez/api/platform/exposure").Exposure;
    let rpc: { add: (input: object) => Promise<unknown> };
    let openApi: (path: string, body: object, headers: Record<string, string>) => Promise<Response>;
    let httpOptions: import("./transports/http").McpHttpOptions;
    let handleMcpRequest: typeof import("./transports/http").handleMcpRequest;

    let runs = 0;

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
      database = await createTestDatabase("required_idempotency_key");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      grants = await import("@louez/api/services/agent-grants");
      const { z } = await import("zod");
      const { storeProcedure } = await import("@louez/api/platform/procedures");
      const { requireConfirmation } = await import("@louez/api/platform/confirmation");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { createFixtureRouter, FIXTURE_EXPOSED } = await import("@louez/api/platform/testing");
      const { createOpenApiHandler, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { createORPCClient } = await import("@orpc/client");
      const { RPCLink } = await import("@orpc/client/fetch");
      ({ handleMcpRequest } = await import("./transports/http"));

      // `add` requires a key; `copy` is the same write without the flag.
      const write = (name: "add" | "copy", flagged: boolean) =>
        storeProcedure
          .meta({
            capability: `fixture.notes.${name}`,
            scope: { domain: "categories", level: "write" },
            ...(flagged ? { requiresIdempotencyKey: true as const } : {}),
            mcp: {
              name: `fixture_notes_${name}`,
              title: name === "add" ? "Add Note" : "Copy Note",
              description: "Write a note. A fixture for tests.",
              bundle: "catalog",
              effect: "additive",
            },
          })
          .input(z.object({ title: z.string().min(1) }))
          .output(z.object({ id: z.string(), title: z.string() }))
          .handler(async ({ input }) => {
            runs += 1;
            return { id: `note_${runs}`, title: input.title };
          });
      // A flagged write that asks for a confirmation: the key is asked first.
      const archive = storeProcedure
        .meta({
          capability: "fixture.notes.archive",
          scope: { domain: "categories", level: "write" },
          sensitive: "destructive",
          requiresIdempotencyKey: true,
          mcp: {
            name: "fixture_notes_archive",
            title: "Archive Note",
            description: "Archive a note. A fixture for tests.",
            bundle: "catalog",
            effect: "overwrite",
          },
        })
        .input(z.object({ id: z.string().min(1) }))
        .output(z.object({ id: z.string() }))
        .handler(async ({ context, input, path }) => {
          await requireConfirmation({
            consequences: ["deletion"],
            actor: context.actor,
            headers: context.headers,
            procedure: path.join("."),
            input,
            state: { id: input.id },
            preview: { summary: `Archive note ${input.id}.`, details: { id: input.id } },
          });
          runs += 1;
          return { id: input.id };
        });

      const router = {
        fixture: {
          notes: {
            ...createFixtureRouter().fixture.notes,
            add: write("add", true),
            copy: write("copy", false),
            archive,
          },
        },
      };
      exposure = createExposure(router, [
        ...FIXTURE_EXPOSED,
        "fixture.notes.add",
        "fixture.notes.copy",
        "fixture.notes.archive",
      ]);

      // RPC: the dashboard, with the owner's session.
      const rpcHandler = new RPCHandler(router);
      rpc = createORPCClient<{ fixture: { notes: typeof rpc } }>(
        new RPCLink({
          url: "http://louez.test/rpc",
          headers: { [SESSION_HEADER]: OWNER },
          fetch: async (request) => {
            const { response } = await rpcHandler.handle(request, {
              prefix: "/rpc",
              context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
            });
            return response ?? new Response(null, { status: 404 });
          },
        }),
      ).fixture.notes;

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

      httpOptions = { ports, procedures: exposure.procedures };

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@ik.test" });
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: STORE, userId: OWNER, name: "Key store", slug: "ik-store-a" });
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: OWNER, role: "owner" });
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        name: "Claude",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://claude.ik.test/callback"]),
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    async function apiKey() {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Key agent",
        permissions: {
          reservations: "read",
          products: "read",
          customers: "read",
          categories: "write",
          payments: "read",
          analytics: "read",
          settings: "read",
        },
      });
      return `Bearer ${created.key}`;
    }

    async function oauthToken() {
      const { id: grantId } = await grants.saveGrant({
        userId: OWNER,
        clientId: CLIENT,
        terms: {
          stores: { all: false, ids: [STORE] },
          preset: "write",
          confirmSensitive: true,
          bundles: ["catalog"],
        },
      });
      return `Bearer ${await tokens.sign({ userId: OWNER, clientId: CLIENT, grantId })}`;
    }

    async function withClient<T>(authorization: string, run: (client: Client) => Promise<T>) {
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(RESOURCE), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      try {
        return await run(client);
      } finally {
        await client.close();
      }
    }
    const mcpCall = (authorization: string, name: string, args: Record<string, unknown>) =>
      withClient(authorization, (client) => client.callTool({ name, arguments: args }));

    const errorOf = (result: ToolResult) =>
      (result.structuredContent as { error?: { code?: string; details?: unknown } } | undefined)
        ?.error;
    const text = (result: ToolResult) =>
      (result.content as Array<{ type: string; text?: string }>)
        .map((part) => part.text ?? "")
        .join("");

    /** The write records of a procedure, with how they were made. */
    const records = (procedure: string) =>
      louezDb.db
        .select({
          credentialKind: louezDb.apiOperations.credentialKind,
          idempotencyKey: louezDb.apiOperations.idempotencyKey,
          status: louezDb.apiOperations.status,
        })
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.procedure, procedure));
    const confirmations = () =>
      louezDb.db
        .select({ id: louezDb.apiConfirmations.id })
        .from(louezDb.apiConfirmations)
        .where(orm.eq(louezDb.apiConfirmations.procedure, "fixture.notes.archive"));

    test("an API key without a key is refused over REST and MCP, and nothing runs or is recorded", async () => {
      const authorization = await apiKey();
      const before = { runs, records: (await records("fixture.notes.add")).length };

      const viaRest = await openApi("/fixture/notes/add", { title: "Tents" }, { authorization });
      assert.equal(viaRest.status, 400);
      const body = (await viaRest.json()) as {
        message: string;
        data: { code: string; retryable: boolean; details: unknown };
      };
      assert.equal(body.data.code, "IDEMPOTENCY_KEY_REQUIRED");
      assert.equal(body.data.retryable, false);
      assert.deepEqual(body.data.details, { header: "Idempotency-Key" });
      assert.match(body.message, /Idempotency-Key header/);
      assert.doesNotMatch(body.message, /idempotencyKey|\btool\b|argument/);

      const viaMcp = await mcpCall(authorization, "fixture_notes_add", { title: "Tents" });
      assert.equal(viaMcp.isError, true);
      assert.equal(errorOf(viaMcp)?.code, "IDEMPOTENCY_KEY_REQUIRED");
      assert.deepEqual(errorOf(viaMcp)?.details, { argument: "idempotencyKey" });
      assert.match(text(viaMcp), /idempotencyKey argument/);
      assert.doesNotMatch(text(viaMcp), /Idempotency-Key/);

      assert.equal(runs, before.runs, "the handler never ran");
      assert.equal((await records("fixture.notes.add")).length, before.records, "no operation row");
    });

    test("the key is asked before a confirmation is: no preview is recorded", async () => {
      const authorization = await apiKey();
      const viaMcp = await mcpCall(authorization, "fixture_notes_archive", { id: "note_9" });
      assert.equal(errorOf(viaMcp)?.code, "IDEMPOTENCY_KEY_REQUIRED");
      const viaRest = await openApi("/fixture/notes/archive", { id: "note_9" }, { authorization });
      assert.equal(viaRest.status, 400);
      assert.deepEqual(await confirmations(), []);
      assert.deepEqual(await records("fixture.notes.archive"), []);

      // With a key, the confirmation is asked as before.
      const withKey = await mcpCall(authorization, "fixture_notes_archive", {
        id: "note_9",
        idempotencyKey: "ik-archive-1",
      });
      assert.equal(errorOf(withKey)?.code, "CONFIRMATION_REQUIRED");
    });

    test("an OAuth token without a key is refused; with one it runs", async () => {
      const authorization = await oauthToken();
      const before = { runs, records: (await records("fixture.notes.add")).length };
      const refused = await mcpCall(authorization, "fixture_notes_add", { title: "Kayaks" });
      assert.equal(refused.isError, true);
      assert.equal(errorOf(refused)?.code, "IDEMPOTENCY_KEY_REQUIRED");
      assert.equal(runs, before.runs);
      assert.equal((await records("fixture.notes.add")).length, before.records);

      const ran = await mcpCall(authorization, "fixture_notes_add", {
        title: "Kayaks",
        idempotencyKey: "ik-oauth-1",
      });
      assert.notEqual(ran.isError, true, text(ran));
      assert.equal(runs, before.runs + 1);
    });

    test("a dashboard session is not asked for a key", async () => {
      const before = runs;
      const result = (await rpc.add({ title: "Bikes" })) as { title: string };
      assert.equal(result.title, "Bikes");
      assert.equal(runs, before + 1);
      const session = (await records("fixture.notes.add")).filter(
        (row) => row.credentialKind === "session",
      );
      assert.deepEqual(session, [
        { credentialKind: "session", idempotencyKey: null, status: "succeeded" },
      ]);
    });

    test("with a key, the write runs once and a retry replays it, over MCP and REST", async () => {
      const authorization = await apiKey();
      const before = runs;
      const args = { title: "Canoes", idempotencyKey: "ik-mcp-1" };
      const first = await mcpCall(authorization, "fixture_notes_add", args);
      const again = await mcpCall(authorization, "fixture_notes_add", args);
      assert.notEqual(first.isError, true, text(first));
      assert.deepEqual(again.structuredContent, first.structuredContent);
      assert.equal(again._meta?.["io.louez/replayed"], true);
      assert.equal(runs, before + 1);

      const headers = { authorization, "idempotency-key": "ik-rest-1" };
      const restFirst = await openApi("/fixture/notes/add", { title: "Paddles" }, headers);
      const restAgain = await openApi("/fixture/notes/add", { title: "Paddles" }, headers);
      assert.equal(restFirst.status, 200);
      assert.equal(restAgain.status, 200);
      assert.equal(restAgain.headers.get("louez-replayed"), "true");
      assert.deepEqual(await restAgain.json(), await restFirst.json());
      assert.equal(runs, before + 2);
    });

    test("an unflagged write still runs without a key", async () => {
      const authorization = await apiKey();
      const before = runs;
      const viaRest = await openApi("/fixture/notes/copy", { title: "Tents" }, { authorization });
      assert.equal(viaRest.status, 200);
      const viaMcp = await mcpCall(authorization, "fixture_notes_copy", { title: "Tents" });
      assert.notEqual(viaMcp.isError, true, text(viaMcp));
      assert.equal(runs, before + 2);
    });

    test("the MCP schema of a flagged tool requires the key and says why; an unflagged one is unchanged", async () => {
      const tools = await withClient(
        await apiKey(),
        async (client) => (await client.listTools()).tools,
      );
      const byName = (name: string) => tools.find((tool) => tool.name === name) as Tool;
      const add = byName("fixture_notes_add").inputSchema;
      const copy = byName("fixture_notes_copy").inputSchema;

      // The unflagged write's arguments, byte for byte as the bridge gave them before.
      assert.equal(JSON.stringify(copy), COPY_INPUT_SCHEMA);

      assert.deepEqual(add.required, ["title", "idempotencyKey"]);
      const key = (add.properties as Record<string, { description: string }>).idempotencyKey;
      assert.doesNotMatch(key.description, /^Optional/);
      assert.match(key.description, /^Required/);
      assert.match(key.description, /retr/);
      // Only `required` and the key's description differ from the unflagged write.
      const { required: _required, properties: addProperties, ...addRest } = add;
      const { required: _copyRequired, properties: copyProperties, ...copyRest } = copy;
      assert.deepEqual(addRest, copyRest);
      const { idempotencyKey: addKey, ...addOthers } = addProperties as Record<string, object>;
      const { idempotencyKey: copyKey, ...copyOthers } = copyProperties as Record<string, object>;
      assert.deepEqual(addOthers, copyOthers);
      assert.deepEqual({ ...addKey, description: "" }, { ...copyKey, description: "" });
    });

    test("the OpenAPI document marks the header required on flagged operations only", async () => {
      const { generateOpenApiDocument } = await import("@louez/api/platform/openapi");
      const document = (await generateOpenApiDocument(exposure.router)) as unknown as {
        info: { description: string };
        components: { parameters: Record<string, { name: string; in: string; required: boolean }> };
        paths: Record<string, { post: { parameters?: Array<{ $ref?: string }> } }>;
      };
      const { IdempotencyKey, IdempotencyKeyRequired } = document.components.parameters;
      assert.deepEqual(
        [IdempotencyKey.name, IdempotencyKey.in, IdempotencyKey.required],
        ["Idempotency-Key", "header", false],
      );
      assert.deepEqual(
        [IdempotencyKeyRequired.name, IdempotencyKeyRequired.in, IdempotencyKeyRequired.required],
        ["Idempotency-Key", "header", true],
      );
      const refs = (path: string) =>
        (document.paths[path].post.parameters ?? []).map((parameter) => parameter.$ref);
      assert.deepEqual(refs("/fixture/notes/add"), [
        "#/components/parameters/IdempotencyKeyRequired",
      ]);
      assert.deepEqual(refs("/fixture/notes/archive"), [
        "#/components/parameters/IdempotencyKeyRequired",
        "#/components/parameters/LouezConfirmation",
      ]);
      assert.deepEqual(refs("/fixture/notes/copy"), ["#/components/parameters/IdempotencyKey"]);
      assert.deepEqual(refs("/fixture/notes/remove"), [
        "#/components/parameters/IdempotencyKey",
        "#/components/parameters/LouezConfirmation",
      ]);
      assert.match(document.info.description, /IDEMPOTENCY_KEY_REQUIRED/);
    });
  },
);

/** `fixture_notes_copy`'s input schema as the bridge listed it before the rule existed. */
const COPY_INPUT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
    idempotencyKey: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description:
        "Optional. A unique string for this action, such as a UUID. Retrying with the same key and the same arguments returns the first result instead of acting twice.",
    },
  },
  required: ["title"],
});
