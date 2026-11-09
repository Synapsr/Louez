import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "team-test-secret";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// The team procedures end to end, through `call()`: the dashboard's session,
// an API key and an agent over OAuth, on the database. Better Auth stays out:
// a session is read from a test header, access tokens are signed with a test
// key.

const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const SESSION_HEADER = "x-test-session-user";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;

mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@tm.test` } } : null;
        },
      },
    },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

const OWNER = "tm_owner_user_000001";
const CO_OWNER = "tm_coowner_user_0001";
const MEMBER = "tm_member_user_00001";
const OTHER_MEMBER = "tm_other_member_0001";
const EXISTING = "tm_existing_user_001";
const STORE = "tm_store_a_000000001";
const OTHER_STORE = "tm_store_b_000000001";
const CLIENT = "https://claude.tm.test/oauth/client.json";

describe("team procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let grants: typeof import("../../services/agent-grants");
  let router: typeof import("./team").dashboardTeamRouter;

  let dispatched: string[] = [];
  let collaboratorLimit: number | null = null;
  let emailConfigured = true;
  let events: Array<{ type: string }> = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: (ids: readonly string[]) => {
      dispatched.push(...ids);
    },
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (event: { type: string }) => {
      events.push(event);
    },
    team: {
      collaboratorLimit: async () => collaboratorLimit,
      emailConfigured: () => emailConfigured,
    },
  };

  before(async () => {
    tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
    database = await createTestDatabase("api_team");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    grants = await import("../../services/agent-grants");
    ({ dashboardTeamRouter: router } = await import("./team"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@tm.test", name: "Olivia Owner" },
      { id: CO_OWNER, email: "coowner@tm.test", name: "Cleo Coowner" },
      { id: MEMBER, email: "member@tm.test", name: "Maël Member" },
      { id: OTHER_MEMBER, email: "other@tm.test", name: "Otto Other" },
      { id: EXISTING, email: "existing@tm.test", name: "Eva Existing" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Brest Surf", slug: "tm-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "Quimper Bikes", slug: "tm-store-b" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: "Claude",
      uri: "https://claude.tm.test",
      clientDiscoveryId: "cimd",
      redirectUris: JSON.stringify(["https://client.tm.test/callback"]),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const TEAM = [
    { id: "tm_m_owner_000000001", storeId: STORE, userId: OWNER, role: "owner" as const },
    { id: "tm_m_coowner_0000001", storeId: STORE, userId: CO_OWNER, role: "owner" as const },
    { id: "tm_m_member_00000001", storeId: STORE, userId: MEMBER, role: "member" as const },
    { id: "tm_m_owner_b_0000001", storeId: OTHER_STORE, userId: OWNER, role: "owner" as const },
    { id: "tm_m_other_b_0000001", storeId: OTHER_STORE, userId: OTHER_MEMBER, role: "member" as const },
  ];
  const membership = (userId: string, storeId = STORE) =>
    TEAM.find((row) => row.userId === userId && row.storeId === storeId)?.id ?? "";

  beforeEach(async () => {
    dispatched = [];
    events = [];
    collaboratorLimit = null;
    emailConfigured = true;
    await louezDb.db.delete(louezDb.storeInvitations);
    await louezDb.db.delete(louezDb.storeMembers);
    // Spread out in time, so the newest-first order is certain.
    await louezDb.db.insert(louezDb.storeMembers).values(
      TEAM.map((row, index) => ({
        ...row,
        createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
        updatedAt: new Date(Date.UTC(2026, 0, 1 + index)),
      })),
    );
    await louezDb.db.delete(louezDb.apiAgentGrants);
    await louezDb.db.delete(louezDb.apiKeys);
    await louezDb.db.delete(louezDb.apiOperations);
    await louezDb.db.delete(louezDb.apiConfirmations);
    await louezDb.db.delete(louezDb.apiRateLimits);
    await louezDb.db.delete(louezDb.apiEffects);
  });

  // --- Callers --------------------------------------------------------------

  const session = (userId = OWNER, store = STORE) => ({
    headers: new Headers({ [SESSION_HEADER]: userId, cookie: `louez_active_store=${store}` }),
    transport: "rpc" as const,
    ports,
    receipt: {} as { operationId?: string; replayed?: boolean },
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const teamWrite: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
    team: "write",
  };

  /** An API key on the store; `confirm: false` turns its confirmations off. */
  async function apiKey(
    options: { userId?: string; permissions?: Permissions; confirm?: boolean } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: options.userId ?? OWNER,
      name: "Team agent",
      permissions: options.permissions ?? teamWrite,
    });
    if (options.confirm === false) {
      await apiKeys.setApiKeyConfirmation({
        db: louezDb.db,
        storeId: STORE,
        keyId: created.id,
        confirmSensitive: false,
      });
    }
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  /** An agent over OAuth, with a grant over all the owner's stores, acting on STORE. */
  async function agent(
    options: { userId?: string; preset?: "read" | "write"; confirm?: boolean } = {},
  ) {
    const userId = options.userId ?? OWNER;
    await grants.saveGrant({
      userId,
      clientId: CLIENT,
      terms: {
        stores: { all: true },
        preset: options.preset ?? "write",
        confirmSensitive: options.confirm ?? true,
        bundles: ["team"],
      },
    });
    const grant = await grants.loadActiveGrant({ userId, clientId: CLIENT });
    const token = await tokens.sign({ userId, clientId: CLIENT, grantId: grant?.id ?? null });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({
        authorization: `Bearer ${token}`,
        "louez-store": STORE,
        ...extra,
      }),
      transport: "mcp" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  /** Calls a team procedure as the dashboard, the API or MCP would, with its full path. */
  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "team"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as {
      message: string;
      data: { code: string; details?: Record<string, unknown> & { confirmationToken?: string } };
    };
  }

  const invitations = () => louezDb.db.select().from(louezDb.storeInvitations);
  const memberIds = async (storeId = STORE) =>
    (
      await louezDb.db
        .select({ userId: louezDb.storeMembers.userId })
        .from(louezDb.storeMembers)
        .where(orm.eq(louezDb.storeMembers.storeId, storeId))
    )
      .map((row) => row.userId)
      .sort();
  const effectRows = () => louezDb.db.select().from(louezDb.apiEffects);

  // --- Reads ----------------------------------------------------------------

  test("each caller reads the store's members, newest first, and only this store's", async () => {
    for (const context of [session(), (await apiKey())(), (await agent())()]) {
      const page = await run("listMembers", {}, context);
      assert.deepEqual(
        page.items.map((member: { userId: string }) => member.userId),
        [MEMBER, CO_OWNER, OWNER],
        "OTHER_MEMBER, of the other store, is not there",
      );
      const owner = page.items.find((member: { userId: string }) => member.userId === OWNER);
      assert.deepEqual(Object.keys(owner).sort(), [
        "email",
        "id",
        "imageUrl",
        "joinedAt",
        "name",
        "role",
        "userId",
      ]);
      assert.equal(owner.role, "owner");
      assert.equal(owner.name, "Olivia Owner");
      assert.deepEqual(page.memberLimit, { current: 1, limit: null, canAddMember: true });
      assert.equal(page.links.dashboard, `${TEST_APP_URL}/dashboard/team?store=${STORE}`);
      assert.equal(page.nextCursor, null);
    }
  });

  test("the member list pages with a cursor, and refuses one of another store", async () => {
    const first = await run("listMembers", { limit: 2 }, session());
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await run("listMembers", { cursor: first.nextCursor, limit: 2 }, session());
    assert.deepEqual(
      [...first.items, ...second.items].map((member: { userId: string }) => member.userId),
      [MEMBER, CO_OWNER, OWNER],
    );
    assert.equal(second.nextCursor, null);

    await rejects(
      run("listMembers", { cursor: membership(OTHER_MEMBER, OTHER_STORE) }, session()),
      "INVALID_CURSOR",
    );
  });

  test("the seats count members, not owners, against the plan's limit", async () => {
    collaboratorLimit = 1;
    const page = await run("listMembers", {}, session());
    assert.deepEqual(page.memberLimit, { current: 1, limit: 1, canAddMember: false });
  });

  test("each caller reads the pending invitations, never their token, and only this store's", async () => {
    const now = Date.now();
    await louezDb.db.insert(louezDb.storeInvitations).values([
      {
        id: "tm_inv_pending_00001",
        storeId: STORE,
        email: "new@tm.test",
        token: "tm-token-pending-000000000000001",
        invitedBy: OWNER,
        expiresAt: new Date(now + 86_400_000),
        createdAt: new Date(now - 60_000),
      },
      {
        id: "tm_inv_expired_00001",
        storeId: STORE,
        email: "late@tm.test",
        token: "tm-token-expired-000000000000001",
        invitedBy: OWNER,
        expiresAt: new Date(now - 60_000),
        createdAt: new Date(now - 8 * 86_400_000),
      },
      {
        id: "tm_inv_cancelled_001",
        storeId: STORE,
        email: "gone@tm.test",
        token: "tm-token-cancelled-0000000000001",
        status: "cancelled",
        invitedBy: OWNER,
        expiresAt: new Date(now + 86_400_000),
      },
      {
        id: "tm_inv_other_store01",
        storeId: OTHER_STORE,
        email: "elsewhere@tm.test",
        token: "tm-token-other-00000000000000001",
        invitedBy: OWNER,
        expiresAt: new Date(now + 86_400_000),
      },
    ]);

    for (const context of [session(), session(MEMBER), (await apiKey())(), (await agent())()]) {
      const page = await run("listInvitations", {}, context);
      assert.deepEqual(
        page.items.map((invitation: { email: string; expired: boolean; role: string }) => [
          invitation.email,
          invitation.role,
          invitation.expired,
        ]),
        [
          ["new@tm.test", "member", false],
          ["late@tm.test", "member", true],
        ],
      );
      assert.doesNotMatch(JSON.stringify(page), /tm-token-/);
      assert.equal(page.links.dashboard, `${TEST_APP_URL}/dashboard/team?store=${STORE}`);
    }
  });

  test("a connection without team access reads nothing", async () => {
    const noTeam = await apiKey({ permissions: { ...teamWrite, team: "none" } });
    await rejects(run("listMembers", {}, noTeam()), "PERMISSION_DENIED");
    await rejects(run("listInvitations", {}, noTeam()), "PERMISSION_DENIED");
  });

  // --- Invite ---------------------------------------------------------------

  test("a session invites at once, as a member, and the e-mail goes to the outbox", async () => {
    const result = await run("invite", { email: "New.Person@TM.test" }, session());
    assert.equal(result.outcome, "invited");
    assert.equal(result.invitationEmail, "queued");
    assert.equal(result.invitation.email, "new.person@tm.test");
    assert.equal(result.invitation.role, "member");
    assert.equal(result.member, null);
    const days = (result.invitation.expiresAt.getTime() - result.invitation.invitedAt.getTime()) / 86_400_000;
    assert.equal(days, 7);

    const [row] = await invitations();
    assert.equal(row?.role, "member");
    assert.equal(row?.token.length, 32);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(row?.token ?? "-"));

    const [effect] = await effectRows();
    assert.equal(effect?.type, "team.invitationEmail");
    assert.deepEqual(effect?.payload, {
      invitationId: row?.id,
      store: { name: "Brest Surf", logoUrl: null, country: null },
      inviterName: "Olivia Owner",
    });
    assert.doesNotMatch(JSON.stringify(effect?.payload), new RegExp(row?.token ?? "-"));
    assert.deepEqual(dispatched, [effect?.id]);
    assert.deepEqual(events.map((event) => event.type), ["team.memberInvited"]);
  });

  test("someone with a Louez account joins at once as a member", async () => {
    const result = await run("invite", { email: "existing@tm.test" }, session());
    assert.equal(result.outcome, "added");
    assert.equal(result.invitationEmail, null);
    assert.equal(result.member.userId, EXISTING);
    assert.equal(result.member.role, "member");
    assert.deepEqual(await memberIds(), [CO_OWNER, EXISTING, MEMBER, OWNER].sort());
    assert.equal((await effectRows()).length, 0, "no e-mail, as the dashboard always did");
  });

  test("an instance without e-mail queues nothing and says so", async () => {
    emailConfigured = false;
    const result = await run("invite", { email: "new@tm.test" }, session());
    assert.equal(result.invitationEmail, "not_configured");
    assert.equal((await effectRows()).length, 0);
  });

  test("an agent always confirms an invitation, even with confirmations off, and the token is bound to the address", async () => {
    for (const context of [await apiKey({ confirm: false }), await agent({ confirm: false })]) {
      await louezDb.db.delete(louezDb.storeInvitations);
      const refused = await rejects(
        run("invite", { email: "new@tm.test" }, context()),
        "CONFIRMATION_REQUIRED",
      );
      assert.match(refused.message, /new@tm\.test/);
      assert.match(refused.message, /as a member/);
      assert.match(refused.message, /customers, reservations, payments/);
      const preview = refused.data.details?.preview as { details: Record<string, unknown> };
      assert.equal(preview.details.email, "new@tm.test");
      assert.equal(preview.details.role, "member");
      assert.equal((await invitations()).length, 0, "nothing happened yet");

      const token = refused.data.details?.confirmationToken ?? "";
      // Another address with this token: refused.
      await rejects(
        run("invite", { email: "someone@tm.test" }, context({ "louez-confirmation": token })),
        "CONFIRMATION_INVALID",
      );
      const again = await rejects(
        run("invite", { email: "new@tm.test" }, context()),
        "CONFIRMATION_REQUIRED",
      );
      const result = await run(
        "invite",
        { email: "new@tm.test" },
        context({ "louez-confirmation": again.data.details?.confirmationToken ?? "" }),
      );
      assert.equal(result.outcome, "invited");
      assert.equal(result.invitation.role, "member");
      assert.doesNotMatch(JSON.stringify(result), /invitation\//, "never the link");
      const [row] = await invitations();
      assert.doesNotMatch(JSON.stringify(result), new RegExp(row?.token ?? "-"));
    }
  });

  test("no caller may invite with another role than member", async () => {
    for (const context of [session(), (await apiKey({ confirm: false }))(), (await agent())()]) {
      for (const role of ["owner", "admin", "platform_admin"]) {
        await rejects(
          run("invite", { email: "new@tm.test", role } as never, context),
          "BAD_REQUEST",
        );
      }
    }
    assert.equal((await invitations()).length, 0);
    assert.deepEqual(await memberIds(), [CO_OWNER, MEMBER, OWNER].sort());

    // "member", the one role it takes, is accepted.
    const result = await run("invite", { email: "new@tm.test", role: "member" }, session());
    assert.equal(result.invitation.role, "member");
  });

  test("an existing member, a pending invitation and full seats are refused before any preview", async () => {
    const context = await agent();
    await rejects(run("invite", { email: "member@tm.test" }, context()), "TEAM_ALREADY_MEMBER");
    await rejects(run("invite", { email: "Owner@tm.test" }, context()), "TEAM_ALREADY_MEMBER");

    await run("invite", { email: "new@tm.test" }, session());
    const pending = await rejects(
      run("invite", { email: "NEW@tm.test" }, context()),
      "TEAM_INVITATION_ALREADY_SENT",
    );
    assert.equal(pending.data.details?.email, "new@tm.test");
    assert.equal((await invitations()).length, 1);

    collaboratorLimit = 1;
    const full = await rejects(
      run("invite", { email: "another@tm.test" }, session()),
      "TEAM_LIMIT_REACHED",
    );
    assert.deepEqual(full.data.details, { current: 1, limit: 1 });

    const confirmations = await louezDb.db.select().from(louezDb.apiConfirmations);
    assert.equal(confirmations.length, 0, "no preview was ever issued");
  });

  test("only an owner invites: a member's session or key is refused", async () => {
    await rejects(run("invite", { email: "new@tm.test" }, session(MEMBER)), "PERMISSION_DENIED");
    const memberKey = await apiKey({ userId: MEMBER, confirm: false });
    await rejects(run("invite", { email: "new@tm.test" }, memberKey()), "PERMISSION_DENIED");
    const readOnly = await agent({ preset: "read" });
    await rejects(run("invite", { email: "new@tm.test" }, readOnly()), "PERMISSION_DENIED");
    assert.equal((await invitations()).length, 0);
  });

  // --- Dashboard only ---------------------------------------------------------

  test("sending again and reading the link are the dashboard's only", async () => {
    const { invitation } = await run("invite", { email: "new@tm.test" }, session());
    const [before] = await invitations();

    for (const context of [(await apiKey({ confirm: false }))(), (await agent())()]) {
      await rejects(
        run("resendInvitation", { id: invitation.id }, context),
        "SESSION_ONLY",
      );
      await rejects(
        run("invitationLink", { id: invitation.id }, context),
        "SESSION_ONLY",
      );
    }

    dispatched = [];
    const resent = await run("resendInvitation", { id: invitation.id }, session());
    assert.equal(resent.invitationEmail, "queued");
    const [afterResend] = await invitations();
    assert.notEqual(afterResend?.token, before?.token, "a new link");
    assert.equal(dispatched.length, 1);

    const link = await run("invitationLink", { id: invitation.id }, session());
    assert.equal(link.url, `${TEST_APP_URL}/invitation/${afterResend?.token}`);
    await rejects(run("invitationLink", { id: invitation.id }, session(MEMBER)), "PERMISSION_DENIED");
  });

  // --- Cancel ---------------------------------------------------------------

  test("cancelling an invitation always asks an agent, names the person, and stops the link", async () => {
    const { invitation } = await run("invite", { email: "new@tm.test" }, session());
    const context = await apiKey({ confirm: false });

    const refused = await rejects(
      run("cancelInvitation", { id: invitation.id }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.match(refused.message, /new@tm\.test/);
    assert.equal((await invitations())[0]?.status, "pending");

    const result = await run(
      "cancelInvitation",
      { id: invitation.id },
      context({ "louez-confirmation": refused.data.details?.confirmationToken ?? "" }),
    );
    assert.deepEqual(
      { id: result.id, email: result.email, cancelled: result.cancelled },
      { id: invitation.id, email: "new@tm.test", cancelled: true },
    );
    assert.equal((await invitations())[0]?.status, "cancelled");
    await rejects(
      run("cancelInvitation", { id: invitation.id }, session()),
      "TEAM_INVITATION_NOT_FOUND",
    );
  });

  test("a session cancels at once; another store's invitation is not found", async () => {
    const { invitation } = await run("invite", { email: "new@tm.test" }, session());
    const result = await run("cancelInvitation", { id: invitation.id }, session());
    assert.equal(result.cancelled, true);

    const other = await run("invite", { email: "b@tm.test" }, session(OWNER, OTHER_STORE));
    await rejects(
      run("cancelInvitation", { id: other.invitation.id }, session()),
      "TEAM_INVITATION_NOT_FOUND",
    );
    await rejects(
      run("cancelInvitation", { id: other.invitation.id }, (await agent())()),
      "TEAM_INVITATION_NOT_FOUND",
    );
  });

  // --- Remove ---------------------------------------------------------------

  test("removing a member always asks an agent, names the person, and binds the token to them", async () => {
    for (const context of [await apiKey({ confirm: false }), await agent({ confirm: false })]) {
      const refused = await rejects(
        run("removeMember", { id: membership(MEMBER) }, context()),
        "CONFIRMATION_REQUIRED",
      );
      assert.match(refused.message, /Maël Member \(member@tm\.test\)/);
      assert.match(refused.message, /lose access/);
      const preview = refused.data.details?.preview as {
        details: { member: { email: string; role: string } };
      };
      assert.equal(preview.details.member.email, "member@tm.test");
      assert.ok((await memberIds()).includes(MEMBER), "nothing happened yet");

      // The same token for someone else: refused.
      await louezDb.db.insert(louezDb.storeMembers).values({
        id: "tm_m_existing_000001",
        storeId: STORE,
        userId: EXISTING,
        role: "member",
      });
      const token = refused.data.details?.confirmationToken ?? "";
      await rejects(
        run("removeMember", { id: "tm_m_existing_000001" }, context({ "louez-confirmation": token })),
        "CONFIRMATION_INVALID",
      );
      await louezDb.db
        .delete(louezDb.storeMembers)
        .where(orm.eq(louezDb.storeMembers.id, "tm_m_existing_000001"));

      const again = await rejects(
        run("removeMember", { id: membership(MEMBER) }, context()),
        "CONFIRMATION_REQUIRED",
      );
      const result = await run(
        "removeMember",
        { id: membership(MEMBER) },
        context({ "louez-confirmation": again.data.details?.confirmationToken ?? "" }),
      );
      assert.deepEqual(
        { userId: result.userId, email: result.email, removed: result.removed },
        { userId: MEMBER, email: "member@tm.test", removed: true },
      );
      assert.deepEqual(await memberIds(), [CO_OWNER, OWNER].sort());

      await louezDb.db.insert(louezDb.storeMembers).values(TEAM[2]!);
    }
  });

  test("a removed member loses access on their next call", async () => {
    const memberSession = session(MEMBER);
    await run("listMembers", {}, memberSession);
    await run("removeMember", { id: membership(MEMBER) }, session());
    assert.deepEqual(events.map((event) => event.type), ["team.changed"]);
    await assert.rejects(run("listMembers", {}, session(MEMBER)));
  });

  test("an owner is never removed, so the store always keeps its owner, and nobody removes themselves", async () => {
    const context = await agent({ confirm: false });
    // Another owner: refused before any preview.
    await rejects(
      run("removeMember", { id: membership(CO_OWNER) }, session()),
      "TEAM_OWNER_NOT_REMOVABLE",
    );
    await rejects(
      run("removeMember", { id: membership(CO_OWNER) }, context()),
      "TEAM_OWNER_NOT_REMOVABLE",
    );
    // The caller's own membership, the last owner once the co-owner is gone.
    await louezDb.db
      .delete(louezDb.storeMembers)
      .where(orm.eq(louezDb.storeMembers.id, membership(CO_OWNER)));
    await rejects(
      run("removeMember", { id: membership(OWNER) }, session()),
      "TEAM_CANNOT_REMOVE_SELF",
    );
    await rejects(
      run("removeMember", { id: membership(OWNER) }, context()),
      "TEAM_CANNOT_REMOVE_SELF",
    );
    assert.deepEqual(await memberIds(), [MEMBER, OWNER].sort());
    assert.equal((await louezDb.db.select().from(louezDb.apiConfirmations)).length, 0);
  });

  test("a member may not remove anyone, and another store's member is not found", async () => {
    await rejects(
      run("removeMember", { id: membership(OWNER) }, session(MEMBER)),
      "PERMISSION_DENIED",
    );
    await rejects(
      run("removeMember", { id: membership(OTHER_MEMBER, OTHER_STORE) }, session()),
      "TEAM_MEMBER_NOT_FOUND",
    );
    await rejects(
      run("removeMember", { id: membership(OTHER_MEMBER, OTHER_STORE) }, (await agent())()),
      "TEAM_MEMBER_NOT_FOUND",
    );
    assert.deepEqual(await memberIds(OTHER_STORE), [OTHER_MEMBER, OWNER].sort());
  });
});
