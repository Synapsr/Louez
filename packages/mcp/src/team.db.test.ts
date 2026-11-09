import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
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
          return id ? { user: { id, email: `${id}@tt.test` } } : null;
        },
      },
    },
  },
});

// The team, through the app's real router on the three transports: the
// dashboard's RPC handler, /api/v1 and /api/mcp. The same calls give the same
// results and errors; an agent's invitation and removal always confirm; the
// dashboard's own procedures are not served to agents.

const OWNER = "tt_owner_user_000001";
const MEMBER = "tt_member_user_00001";
const STORE = "tt_store_a_000000001";
const MEMBER_ID = "tt_m_member_00000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("team on RPC, OpenAPI and MCP (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let rpc: (name: string, input: object) => Promise<unknown>;
  /** The RPC endpoint called with other headers than the owner's session (an API key). */
  let rpcWith: (headers: Record<string, string>, name: string, input: object) => Promise<unknown>;
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
    team: { collaboratorLimit: async () => null, emailConfigured: () => true },
  };

  before(async () => {
    database = await createTestDatabase("api_team_transports");
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
    exposure = createExposure(appRouter);

    // RPC: the whole router, as /api/rpc serves it to the dashboard.
    const rpcHandler = new RPCHandler(appRouter);
    const clientWith = (headers: Record<string, string>) =>
      createORPCClient<{
        dashboard: { team: Record<string, (input: object) => Promise<unknown>> };
      }>(
        new RPCLink({
          url: "http://louez.test/api/rpc",
          headers,
          fetch: async (request) => {
            const { response } = await rpcHandler.handle(request, {
              prefix: "/api/rpc",
              context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
            });
            return response ?? new Response(null, { status: 404 });
          },
        }),
      );
    const client = clientWith({ [SESSION_HEADER]: OWNER });
    rpc = (name, input) => client.dashboard.team[name](input);
    rpcWith = (headers, name, input) => clientWith(headers).dashboard.team[name](input);

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
      deps: { insertRecordedPayment: async () => undefined },
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
      { id: OWNER, email: "owner@tt.test", name: "Olivia Owner" },
      { id: MEMBER, email: "member@tt.test", name: "Maël Member" },
    ]);
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Transport store", slug: "tt-store-a" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.storeInvitations);
    await louezDb.db.delete(louezDb.storeMembers);
    await louezDb.db.insert(louezDb.storeMembers).values([
      {
        storeId: STORE,
        userId: OWNER,
        role: "owner",
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      },
      {
        id: MEMBER_ID,
        storeId: STORE,
        userId: MEMBER,
        role: "member",
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
    ]);
    await louezDb.db.delete(louezDb.apiConfirmations);
    await louezDb.db.delete(louezDb.apiRateLimits);
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
    team: "read",
  };

  /** An API key on the store; `confirm: false` turns its confirmations off. */
  async function key(permissions: Permissions = { ...readOnly, team: "write" }, confirm = true) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Team agent",
      permissions,
    });
    if (!confirm) {
      await apiKeys.setApiKeyConfirmation({
        db: louezDb.db,
        storeId: STORE,
        keyId: created.id,
        confirmSensitive: false,
      });
    }
    return `Bearer ${created.key}`;
  }

  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };
  const toolError = (result: ToolResult) =>
    (
      result.structuredContent as
        | { error?: { code?: string; details?: { confirmationToken?: string } } }
        | undefined
    )?.error;
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

  test("the team tools are in the team bundle; the dashboard's own are not served", () => {
    const team = exposure.procedures.filter((entry) => entry.path.startsWith("dashboard.team."));
    assert.deepEqual(
      team.map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle]),
      [
        ["team_list_members", "team"],
        ["team_list_invitations", "team"],
        ["team_invite_member", "team"],
        ["team_cancel_invitation", "team"],
        ["team_remove_member", "team"],
      ],
    );
    const paths = team.map((entry) => entry.path);
    assert.ok(!paths.includes("dashboard.team.resendInvitation"));
    assert.ok(!paths.includes("dashboard.team.invitationLink"));
  });

  test("the members read the same on RPC, OpenAPI and MCP", async () => {
    const authorization = await key(readOnly);
    const viaRpc = json(await rpc("listMembers", {}));
    const viaOpenApi = await openApi("GET", "/team/members", null, { authorization });
    assert.equal(viaOpenApi.status, 200);
    const viaMcp = output(await mcpCall(authorization, "team_list_members", {}));

    assert.deepEqual(await viaOpenApi.json(), viaRpc);
    assert.deepEqual(viaMcp, viaRpc);
    assert.deepEqual(
      (viaRpc.items as Array<{ email: string; role: string }>).map((m) => [m.email, m.role]),
      [
        ["member@tt.test", "member"],
        ["owner@tt.test", "owner"],
      ],
    );
    assert.equal(
      (viaRpc.links as { dashboard: string }).dashboard,
      `${TEST_APP_URL}/dashboard/team?store=${STORE}`,
    );
  });

  /** The approval link's token, the last segment of its URL. */
  const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

  test("an invitation runs at once from the dashboard; an agent's only asks for approval, on MCP and OpenAPI", async () => {
    const viaRpc = json(await rpc("invite", { email: "a@tt.test" }));
    assert.equal(viaRpc.outcome, "invited");

    // Confirmations off change nothing: the tool takes no confirmation token at all.
    const authorization = await key({ ...readOnly, team: "write" }, false);
    const asked = output(await mcpCall(authorization, "team_invite_member", { email: "b@tt.test" }));
    assert.equal(asked.outcome, "approval_requested");
    const approval = asked.approval as { url: string; handoff: { id: string } };
    assert.match(approval.url, /\/handoffs\/[A-Za-z0-9_-]{64}$/);
    const viaOpenApi = await openApi("POST", "/team/invitations", { email: "c@tt.test" }, { authorization });
    assert.equal(viaOpenApi.status, 200);
    assert.equal(((await viaOpenApi.json()) as Json).outcome, "approval_requested");
    const created = (await louezDb.db.select().from(louezDb.storeInvitations)).map((row) => row.email);
    assert.deepEqual(created, ["a@tt.test"], "nothing created for the agent's requests");

    // The owner approves from the link's page, signed in.
    assert.equal(
      json(await rpc("decideInvitation", { token: tokenOf(approval.url), decision: "approve" })).decision,
      "approved",
    );
    const handoff = output(await mcpCall(authorization, "handoffs_get", { id: approval.handoff.id }));
    assert.equal(handoff.status, "completed");
    const row = (await louezDb.db.select().from(louezDb.storeInvitations)).find(
      (invitation) => invitation.email === "b@tt.test",
    );
    assert.ok(row, "the invitation exists once approved");
    assert.doesNotMatch(JSON.stringify(handoff), new RegExp(row?.token ?? "-"));
  });

  test("no transport lets an agent approve an invitation", async () => {
    const authorization = await key({ ...readOnly, team: "write" }, false);
    const asked = output(await mcpCall(authorization, "team_invite_member", { email: "d@tt.test" }));
    const token = tokenOf((asked.approval as { url: string }).url);

    // MCP and OpenAPI do not serve it; the RPC endpoint refuses a key.
    assert.ok(!(await mcpTools(authorization)).some((name) => name.includes("decide")));
    await assert.rejects(
      mcpCall(authorization, "team_decide_invitation", { token, decision: "approve" }),
      /not found/,
    );
    for (const path of ["/team/decide", "/dashboard/team/decideInvitation"]) {
      const viaOpenApi = await openApi("POST", path, { token, decision: "approve" }, { authorization });
      assert.equal(viaOpenApi.status, 404);
    }
    let refused: unknown = null;
    await rpcWith({ authorization }, "decideInvitation", { token, decision: "approve" }).catch(
      (error: unknown) => {
        refused = error;
      },
    );
    assert.ok(refused, "the RPC endpoint refused the key");
    assert.equal(
      (await louezDb.db.select().from(louezDb.storeInvitations)).filter((row) => row.email === "d@tt.test").length,
      0,
    );
  });

  test("another role is refused on every transport", async () => {
    const authorization = await key({ ...readOnly, team: "write" }, false);
    assert.equal(await rpcError(rpc("invite", { email: "a@tt.test", role: "owner" })), "BAD_REQUEST");
    const viaOpenApi = await openApi(
      "POST",
      "/team/invitations",
      { email: "a@tt.test", role: "owner" },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 400);
    const viaMcp = await mcpCall(authorization, "team_invite_member", {
      email: "a@tt.test",
      role: "owner",
    });
    assert.equal(viaMcp.isError, true);
    assert.equal(
      (await louezDb.db.select().from(louezDb.storeInvitations)).length,
      0,
      "nothing was invited",
    );
  });

  test("errors carry the same codes on RPC, OpenAPI and MCP", async () => {
    const authorization = await key({ ...readOnly, team: "write" }, false);
    assert.equal(await rpcError(rpc("invite", { email: "member@tt.test" })), "TEAM_ALREADY_MEMBER");
    const viaOpenApi = await openApi(
      "POST",
      "/team/invitations",
      { email: "member@tt.test" },
      { authorization },
    );
    assert.equal(viaOpenApi.status, 409);
    assert.equal(((await viaOpenApi.json()) as { data: { code: string } }).data.code, "TEAM_ALREADY_MEMBER");
    const viaMcp = await mcpCall(authorization, "team_invite_member", { email: "member@tt.test" });
    assert.equal(toolError(viaMcp)?.code, "TEAM_ALREADY_MEMBER");

    assert.equal(
      await rpcError(rpc("removeMember", { id: "tt_missing_member_01" })),
      "TEAM_MEMBER_NOT_FOUND",
    );
    const missing = await mcpCall(authorization, "team_remove_member", { id: "tt_missing_member_01" });
    assert.equal(toolError(missing)?.code, "TEAM_MEMBER_NOT_FOUND");
  });

  test("removing a member: the dashboard runs it directly; an agent confirms first, on OpenAPI and MCP", async () => {
    const authorization = await key({ ...readOnly, team: "write" }, false);
    const viaOpenApi = await openApi("DELETE", `/team/members/${MEMBER_ID}`, null, {
      authorization,
    });
    assert.equal(viaOpenApi.status, 412);

    const first = await mcpCall(authorization, "team_remove_member", { id: MEMBER_ID });
    assert.equal(toolError(first)?.code, "CONFIRMATION_REQUIRED");
    assert.match(text(first), /Maël Member \(member@tt\.test\)/);
    const done = output(
      await mcpCall(authorization, "team_remove_member", {
        id: MEMBER_ID,
        confirmationToken: toolError(first)?.details?.confirmationToken,
      }),
    );
    assert.equal(done.removed, true);

    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ id: MEMBER_ID, storeId: STORE, userId: MEMBER, role: "member" });
    assert.equal(json(await rpc("removeMember", { id: MEMBER_ID })).removed, true);
  });

  test("a read-only connection lists the team's reads only; one without team lists none", async () => {
    const readTools = (await mcpTools(await key(readOnly))).filter((name) => name.startsWith("team_"));
    assert.deepEqual(readTools.sort(), ["team_list_invitations", "team_list_members"]);

    const writeTools = (await mcpTools(await key({ ...readOnly, team: "write" }))).filter((name) =>
      name.startsWith("team_"),
    );
    assert.deepEqual(writeTools.sort(), [
      "team_cancel_invitation",
      "team_invite_member",
      "team_list_invitations",
      "team_list_members",
      "team_remove_member",
    ]);

    const none = (await mcpTools(await key({ ...readOnly, team: "none" }))).filter((name) =>
      name.startsWith("team_"),
    );
    assert.deepEqual(none, []);

    // Listed or not, the procedure decides: a read-only key's invitation is refused.
    const refused = await mcpCall(await key(readOnly), "team_invite_member", { email: "x@tt.test" });
    assert.equal(toolError(refused)?.code, "PERMISSION_DENIED");
  });
});
