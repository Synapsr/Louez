import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";

import { INVITATION_EMAILS_PER_DAY, MAX_OPEN_INVITATION_APPROVALS } from "../../contracts/team";
import { sha256 } from "../../platform/hash";
import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "team-test-secret";
process.env.NODE_ENV = "test";
// An owner joining marks the store's billing snapshot only with the billing service on.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

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
const THIRD_STORE = "tm_store_c_000000001";
const STRANGER = "tm_stranger_user_001";
const CLIENT = "https://claude.tm.test/oauth/client.json";

describe("team procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let grants: typeof import("../../services/agent-grants");
  let router: typeof import("./team").dashboardTeamRouter;
  let handoffsRouter: typeof import("./handoffs").dashboardHandoffsRouter;
  let issueHandoff: typeof import("../../services/handoffs").issueHandoff;
  let inboxRouter: typeof import("./inbox").dashboardInboxRouter;

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
    ({ dashboardHandoffsRouter: handoffsRouter } = await import("./handoffs"));
    ({ issueHandoff } = await import("../../services/handoffs"));
    ({ dashboardInboxRouter: inboxRouter } = await import("./inbox"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@tm.test", name: "Olivia Owner" },
      { id: CO_OWNER, email: "coowner@tm.test", name: "Cleo Coowner" },
      { id: MEMBER, email: "member@tm.test", name: "Maël Member" },
      { id: OTHER_MEMBER, email: "other@tm.test", name: "Otto Other" },
      { id: EXISTING, email: "existing@tm.test", name: "Eva Existing" },
      { id: STRANGER, email: "stranger@tm.test", name: "Sam Stranger" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Brest Surf", slug: "tm-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "Quimper Bikes", slug: "tm-store-b" },
      { id: THIRD_STORE, userId: STRANGER, name: "Morlaix Kayaks", slug: "tm-store-c" },
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
    { id: "tm_m_stranger_c_0001", storeId: THIRD_STORE, userId: STRANGER, role: "owner" as const },
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
    await louezDb.db.delete(louezDb.apiHandoffs);
    // The accounts a test made, as someone registering.
    await louezDb.db.delete(louezDb.users).where(orm.like(louezDb.users.id, "tm_new_%"));
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

  // --- An agent's invitation: approved by an owner from a link ----------------

  /** The approval link's token, the last segment of its URL. */
  const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);
  const handoffs = () => louezDb.db.select().from(louezDb.apiHandoffs);
  const readHandoff = async (id: string, context: BaseContext) =>
    (await orpc.call(handoffsRouter.get, { id }, {
      context,
      path: ["dashboard", "handoffs", "get"],
    })) as { status: string; failure: { code: string } | null; invitation: unknown };

  test("an agent's invitation creates nothing, even with confirmations off, until the owner approves it from the link", async () => {
    for (const context of [await apiKey({ confirm: false }), await agent({ confirm: false })]) {
      await louezDb.db.delete(louezDb.storeInvitations);
      await louezDb.db.delete(louezDb.apiHandoffs);
      await louezDb.db.delete(louezDb.apiEffects);
      const asked = await run("invite", { email: "New@tm.test" }, context());
      assert.equal(asked.outcome, "approval_requested");
      assert.equal(asked.invitation, null);
      assert.equal(asked.member, null);
      assert.ok(asked.approval);
      assert.match(asked.approval.url, new RegExp(`^${TEST_APP_URL}/handoffs/[A-Za-z0-9_-]{64}$`));
      assert.deepEqual(asked.approval.handoff.invitation, {
        email: "new@tm.test",
        role: "member",
        joinsAtOnce: false,
      });
      assert.equal(asked.approval.handoff.status, "pending");

      // Nothing exists yet, and no token was handed out that could grant anything.
      assert.equal((await invitations()).length, 0);
      assert.deepEqual(await memberIds(), [CO_OWNER, MEMBER, OWNER].sort());
      assert.equal((await effectRows()).length, 0);
      assert.equal((await louezDb.db.select().from(louezDb.apiConfirmations)).length, 0);

      const decided = await run(
        "decideInvitation",
        { token: tokenOf(asked.approval.url), decision: "approve" },
        session(),
      );
      assert.deepEqual(decided, {
        handoffId: asked.approval.handoff.id,
        decision: "approved",
        outcome: "invited",
      });
      const [row] = await invitations();
      assert.equal(row?.email, "new@tm.test");
      assert.equal(row?.role, "member");
      assert.equal((await effectRows()).length, 1, "the invitation e-mail is queued");

      // The agent sees it done, and a second answer changes nothing.
      const seen = await readHandoff(asked.approval.handoff.id, context());
      assert.equal(seen.status, "completed");
      await rejects(
        run("decideInvitation", { token: tokenOf(asked.approval.url), decision: "approve" }, session()),
        "TEAM_APPROVAL_INVALID",
      );
      assert.equal((await invitations()).length, 1);
    }
  });

  test("an approval for someone with an account adds them at once, as the owner was shown", async () => {
    const asked = await run("invite", { email: "existing@tm.test" }, (await agent())());
    assert.equal(asked.approval?.handoff.invitation?.joinsAtOnce, true);
    assert.deepEqual(await memberIds(), [CO_OWNER, MEMBER, OWNER].sort());

    const decided = await run(
      "decideInvitation",
      { token: tokenOf(asked.approval?.url ?? ""), decision: "approve" },
      session(),
    );
    assert.equal(decided.outcome, "added");
    assert.deepEqual(await memberIds(), [CO_OWNER, EXISTING, MEMBER, OWNER].sort());
  });

  test("no agent approves, and only the link's owner does: not another owner, not another store's", async () => {
    const asked = await run("invite", { email: "new@tm.test" }, (await agent())());
    const token = tokenOf(asked.approval?.url ?? "");

    for (const context of [(await apiKey({ confirm: false }))(), (await agent())()]) {
      await rejects(
        run("decideInvitation", { token, decision: "approve" }, context),
        "SESSION_ONLY",
      );
    }
    // Another store's owner, and the store's other owner: the link is not theirs.
    for (const userId of [STRANGER, CO_OWNER]) {
      const refused = await rejects(
        run("decideInvitation", { token, decision: "approve" }, session(userId)),
        "TEAM_APPROVAL_INVALID",
      );
      assert.equal(refused.data.details?.reason, "other_user");
    }
    // The link's user, no longer allowed to manage the team.
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "member" })
      .where(orm.eq(louezDb.storeMembers.id, membership(OWNER)));
    const demoted = await rejects(
      run("decideInvitation", { token, decision: "approve" }, session()),
      "TEAM_APPROVAL_INVALID",
    );
    assert.equal(demoted.data.details?.reason, "not_allowed");

    assert.equal((await invitations()).length, 0);
    assert.equal((await handoffs())[0]?.status, "pending");
  });

  test("a declined approval creates nothing, and the agent reads why", async () => {
    const context = await agent();
    const asked = await run("invite", { email: "new@tm.test" }, context());
    const decided = await run(
      "decideInvitation",
      { token: tokenOf(asked.approval?.url ?? ""), decision: "decline" },
      session(),
    );
    assert.equal(decided.decision, "declined");
    assert.equal((await invitations()).length, 0);
    const seen = await readHandoff(asked.approval?.handoff.id ?? "", context());
    assert.equal(seen.status, "failed");
    assert.equal(seen.failure?.code, "declined");

    // Asked again later: a new approval.
    const again = await run("invite", { email: "new@tm.test" }, context());
    assert.notEqual(again.approval?.handoff.id, asked.approval?.handoff.id);
  });

  test("an expired approval cannot be approved; asking again gives the same approval a new link", async () => {
    const context = await agent();
    const asked = await run("invite", { email: "new@tm.test" }, context());
    const id = asked.approval?.handoff.id ?? "";
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.id, id));

    const refused = await rejects(
      run("decideInvitation", { token: tokenOf(asked.approval?.url ?? ""), decision: "approve" }, session()),
      "TEAM_APPROVAL_INVALID",
    );
    assert.equal(refused.data.details?.reason, "expired");
    assert.equal((await readHandoff(id, context())).status, "expired");
    assert.equal((await invitations()).length, 0);

    const again = await run("invite", { email: "new@tm.test" }, context());
    assert.equal(again.approval?.handoff.id, id, "the same approval");
    await run(
      "decideInvitation",
      { token: tokenOf(again.approval?.url ?? ""), decision: "approve" },
      session(),
    );
    assert.equal((await invitations()).length, 1);
  });

  test("the same address asked twice is one approval: the first link stops, the second approves", async () => {
    const context = await apiKey();
    const first = await run("invite", { email: "new@tm.test" }, context());
    const second = await run("invite", { email: "NEW@tm.test" }, context());
    assert.equal(second.approval?.handoff.id, first.approval?.handoff.id);
    assert.equal((await handoffs()).length, 1);

    await rejects(
      run("decideInvitation", { token: tokenOf(first.approval?.url ?? ""), decision: "approve" }, session()),
      "TEAM_APPROVAL_INVALID",
    );
    await run(
      "decideInvitation",
      { token: tokenOf(second.approval?.url ?? ""), decision: "approve" },
      session(),
    );
    assert.equal((await invitations()).length, 1);

    // Another address is another approval.
    const other = await run("invite", { email: "other-new@tm.test" }, context());
    assert.notEqual(other.approval?.handoff.id, first.approval?.handoff.id);
  });

  test(`a store holds at most ${MAX_OPEN_INVITATION_APPROVALS} open approvals; an open one may still be asked again`, async () => {
    const context = await apiKey();
    for (let index = 0; index < MAX_OPEN_INVITATION_APPROVALS; index += 1) {
      await run("invite", { email: `crew-${index}@tm.test` }, context());
    }
    const full = await rejects(
      run("invite", { email: "one-more@tm.test" }, context()),
      "TEAM_APPROVALS_FULL",
    );
    assert.equal(full.data.details?.max, MAX_OPEN_INVITATION_APPROVALS);
    await run("invite", { email: "crew-0@tm.test" }, context());

    // An expired one leaves room.
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.subject, sha256("crew-1@tm.test")));
    await run("invite", { email: "one-more@tm.test" }, context());
  });

  test(`a store sends at most ${INVITATION_EMAILS_PER_DAY} invitation e-mails a day, from the dashboard and agents`, async () => {
    const recent = Array.from({ length: INVITATION_EMAILS_PER_DAY }, (_, index) => ({
      id: `tm_eff_quota_${String(index).padStart(7, "0")}`,
      storeId: STORE,
      type: "team.invitationEmail",
      payload: { invitationId: "gone", store: { name: "x", logoUrl: null, country: null }, inviterName: "x" },
      status: "sent" as const,
    }));
    await louezDb.db.insert(louezDb.apiEffects).values(recent);

    await rejects(run("invite", { email: "new@tm.test" }, session()), "TEAM_INVITATION_EMAIL_LIMIT");
    await rejects(
      run("invite", { email: "new@tm.test" }, (await apiKey())()),
      "TEAM_INVITATION_EMAIL_LIMIT",
    );
    // Adding someone with an account sends no e-mail.
    assert.equal((await run("invite", { email: "existing@tm.test" }, session())).outcome, "added");

    // A day later, the count starts over.
    await louezDb.db
      .update(louezDb.apiEffects)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(orm.eq(louezDb.apiEffects.type, "team.invitationEmail"));
    assert.equal((await run("invite", { email: "new@tm.test" }, session())).outcome, "invited");
  });

  test("Codex's scenario: an expired approval asked again counts toward the cap", async () => {
    const context = await apiKey();
    const first = await run("invite", { email: "crew-a@tm.test" }, context());
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.id, first.approval?.handoff.id ?? ""));
    for (let index = 0; index < MAX_OPEN_INVITATION_APPROVALS; index += 1) {
      await run("invite", { email: `crew-b${index}@tm.test` }, context());
    }
    // Ten are open: bringing the expired one back would make eleven.
    await rejects(run("invite", { email: "crew-a@tm.test" }, context()), "TEAM_APPROVALS_FULL");
    const open = (await handoffs()).filter((row) => row.expiresAt.getTime() > Date.now());
    assert.equal(open.length, MAX_OPEN_INVITATION_APPROVALS);
  });

  test("a key with team write alone follows its approval: handoffs_get, the inbox and its acknowledgement", async () => {
    const none = {
      reservations: "none",
      products: "none",
      customers: "none",
      categories: "none",
      payments: "none",
      analytics: "none",
      settings: "none",
    } as const;
    const teamOnly = await apiKey({ permissions: { ...none, team: "write" } });
    const asked = await run("invite", { email: "new@tm.test" }, teamOnly());
    const id = asked.approval?.handoff.id ?? "";
    assert.equal((await readHandoff(id, teamOnly())).status, "pending");

    // A Stripe step of the same store stays settings' business.
    const stripe = await issueHandoff(
      {
        storeId: STORE,
        userId: OWNER,
        credentialKind: "session",
        credentialId: null,
        clientName: null,
      },
      "stripe_connect_onboarding",
      { urls: ports.urls },
    );
    await rejects(readHandoff(stripe.handoff.id, teamOnly()), "PERMISSION_DENIED");

    // Both have waited more than an hour.
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ linkIssuedAt: new Date(Date.now() - 2 * 3_600_000) });
    type Item = { id: string; type: string; occurredAt: Date; details: { kind?: string } };
    const waiting = async (context: BaseContext) =>
      (
        (await orpc.call(inboxRouter.list, {}, {
          context,
          path: ["dashboard", "inbox", "list"],
        })) as { items: Item[] }
      ).items.filter((item) => item.type === "handoff_waiting");

    const items = await waiting(teamOnly());
    assert.deepEqual(
      items.map((item) => item.details.kind),
      ["team_invitation"],
      "the approval, not the Stripe step",
    );
    const settingsOnly = await apiKey({ permissions: { ...none, settings: "read" } });
    assert.deepEqual(
      (await waiting(settingsOnly())).map((item) => item.details.kind),
      ["stripe_connect_onboarding"],
    );

    const acknowledged = (await orpc.call(
      inboxRouter.acknowledge,
      { items: [{ id: items[0]?.id ?? "", occurredAt: items[0]?.occurredAt ?? new Date() }] },
      { context: teamOnly(), path: ["dashboard", "inbox", "acknowledge"] },
    )) as { acknowledged: number };
    assert.equal(acknowledged.acknowledged, 1);

    // Reading the team is not changing it: a team read key acknowledges nothing.
    const teamRead = await apiKey({ permissions: { ...none, team: "read" } });
    const [stripeItem] = await waiting((await apiKey({ permissions: { ...none, settings: "read", team: "read" } }))());
    assert.equal(stripeItem?.details.kind, "stripe_connect_onboarding");
    await rejects(
      orpc.call(
        inboxRouter.acknowledge,
        { items: [{ id: stripeItem?.id ?? "", occurredAt: stripeItem?.occurredAt ?? new Date() }] },
        { context: teamRead(), path: ["dashboard", "inbox", "acknowledge"] },
      ),
      "PERMISSION_DENIED",
    );
  });

  test("an approval whose address got an account since ends as changed, and creates nothing", async () => {
    const context = await agent();
    const asked = await run("invite", { email: "tm_new_late@tm.test" }, context());
    await louezDb.db.insert(louezDb.users).values({ id: "tm_new_late_user_001", email: "tm_new_late@tm.test" });

    await rejects(
      run("decideInvitation", { token: tokenOf(asked.approval?.url ?? ""), decision: "approve" }, session()),
      "TEAM_APPROVAL_CHANGED",
    );
    assert.deepEqual(await memberIds(), [CO_OWNER, MEMBER, OWNER].sort());
    const seen = await readHandoff(asked.approval?.handoff.id ?? "", context());
    assert.equal(seen.failure?.code, "request_changed");
  });

  // --- A removed member never comes back through an old invitation -----------

  test("Codex's scenario: invite, register, invite again, remove, accept the first link: no way back", async () => {
    const first = await run("invite", { email: "tm_new_back@tm.test" }, session());
    const [pending] = await invitations();
    // The person registers with the invited address.
    await louezDb.db.insert(louezDb.users).values({ id: "tm_new_back_user_001", email: "tm_new_back@tm.test" });

    // Inviting again no longer adds them at once beside a pending invitation.
    await rejects(
      run("invite", { email: "tm_new_back@tm.test" }, session()),
      "TEAM_INVITATION_ALREADY_SENT",
    );
    // They accept the first one, then the owner removes them.
    await run("acceptInvitation", { token: pending?.token ?? "" }, session("tm_new_back_user_001"));
    const added = (await louezDb.db.select().from(louezDb.storeMembers)).find(
      (row) => row.userId === "tm_new_back_user_001",
    );
    await run("removeMember", { id: added?.id ?? "" }, session());

    // The link they used is spent: it lets nobody back.
    await rejects(
      run("acceptInvitation", { token: pending?.token ?? "" }, session("tm_new_back_user_001")),
      "TEAM_INVITATION_INVALID",
    );
    assert.equal(first.outcome, "invited");
    assert.ok(!(await memberIds()).includes("tm_new_back_user_001"));
  });

  test("removing a member cancels their pending invitations to the store", async () => {
    // A pending invitation left over for a member (data from before this fix).
    await louezDb.db.insert(louezDb.storeInvitations).values({
      id: "tm_inv_leftover_0001",
      storeId: STORE,
      email: "member@tm.test",
      token: "tm-token-leftover-000000000000001",
      invitedBy: OWNER,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await run("removeMember", { id: membership(MEMBER) }, session());
    assert.equal((await invitations())[0]?.status, "cancelled");
    await rejects(
      run("acceptInvitation", { token: "tm-token-leftover-000000000000001" }, session(MEMBER)),
      "TEAM_INVITATION_INVALID",
    );
    assert.ok(!(await memberIds()).includes(MEMBER));
  });

  // --- Accepting an invitation ------------------------------------------------

  async function pendingInvitation(email: string, role: "member" | "owner" = "member") {
    const token = `tm-token-${Math.random().toString(36).slice(2).padEnd(22, "0")}`;
    await louezDb.db.insert(louezDb.storeInvitations).values({
      storeId: STORE,
      email,
      role,
      token,
      invitedBy: OWNER,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return token;
  }

  test("accepting joins the store with the invitation's role and spends it; checks the address and the time", async () => {
    const token = await pendingInvitation("existing@tm.test");
    await rejects(run("acceptInvitation", { token }, session(MEMBER)), "TEAM_INVITATION_EMAIL_MISMATCH");
    for (const context of [(await apiKey())(), (await agent())()]) {
      await rejects(run("acceptInvitation", { token }, context), "SESSION_ONLY");
    }
    const accepted = await run("acceptInvitation", { token, name: "Eva" }, session(EXISTING));
    assert.deepEqual(accepted, { storeId: STORE });
    assert.ok((await memberIds()).includes(EXISTING));
    assert.equal((await invitations())[0]?.status, "accepted");
    await rejects(run("acceptInvitation", { token }, session(EXISTING)), "TEAM_INVITATION_INVALID");

    const late = await pendingInvitation("late@tm.test");
    await louezDb.db
      .update(louezDb.storeInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.storeInvitations.token, late));
    await louezDb.db.insert(louezDb.users).values({ id: "tm_new_late2_user_01", email: "late@tm.test" });
    await rejects(run("acceptInvitation", { token: late }, session("tm_new_late2_user_01")), "TEAM_INVITATION_EXPIRED");
  });

  test("accepting checks the seats again", async () => {
    const token = await pendingInvitation("existing@tm.test");
    collaboratorLimit = 1;
    await rejects(run("acceptInvitation", { token }, session(EXISTING)), "TEAM_LIMIT_REACHED");
    assert.ok(!(await memberIds()).includes(EXISTING));
    assert.equal((await invitations())[0]?.status, "pending");
  });

  test("Codex's scenario: a cancellation committed while an acceptance waits wins", async () => {
    const token = await pendingInvitation("existing@tm.test");
    const [invitation] = await invitations();
    let acceptance: Promise<unknown> | null = null;
    // The cancellation holds the store's lock, as every team write takes it
    // first; the acceptance starts meanwhile and must wait for it.
    await louezDb.db.transaction(async (tx) => {
      await louezDb.lockStoreRow(tx, STORE);
      await tx
        .update(louezDb.storeInvitations)
        .set({ status: "cancelled" })
        .where(orm.eq(louezDb.storeInvitations.id, invitation?.id ?? ""));
      acceptance = run("acceptInvitation", { token }, session(EXISTING)).then(
        () => null,
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const error = (await acceptance) as { data?: { code?: string } } | null;
    assert.equal(error?.data?.code, "TEAM_INVITATION_INVALID");
    assert.equal((await invitations())[0]?.status, "cancelled", "never turned into accepted");
    assert.ok(!(await memberIds()).includes(EXISTING));
  });

  test("an owner invitation accepted marks the store's billing snapshot; a member's does not", async () => {
    await louezDb.db.delete(louezDb.billingSyncQueue);
    const member = await pendingInvitation("existing@tm.test");
    await run("acceptInvitation", { token: member }, session(EXISTING));
    const marks = () =>
      louezDb.db
        .select({ id: louezDb.billingSyncQueue.aggregateId })
        .from(louezDb.billingSyncQueue)
        .where(orm.eq(louezDb.billingSyncQueue.aggregateType, "store"));
    assert.deepEqual(await marks(), []);

    await louezDb.db.insert(louezDb.users).values({ id: "tm_new_owner_user_01", email: "tm_new_owner@tm.test" });
    const owner = await pendingInvitation("tm_new_owner@tm.test", "owner");
    await run("acceptInvitation", { token: owner }, session("tm_new_owner_user_01"));
    assert.deepEqual(await marks(), [{ id: STORE }]);
  });

  // --- The inbox ----------------------------------------------------------------

  test("an invitation e-mail that never went out is an inbox item for who reads the team, without its link", async () => {
    const token = await pendingInvitation("lost@tm.test");
    const [invitation] = await invitations();
    await louezDb.db.insert(louezDb.apiEffects).values({
      id: "tm_eff_abandoned_001",
      storeId: STORE,
      type: "team.invitationEmail",
      payload: {
        invitationId: invitation?.id ?? "",
        store: { name: "Brest Surf", logoUrl: null, country: null },
        inviterName: "Olivia Owner",
      },
      status: "abandoned",
      attempts: 8,
      nextAttemptAt: new Date(Date.now() - 3_600_000),
    });
    const inbox = async (context: BaseContext) =>
      (
        (await orpc.call(inboxRouter.list, {}, {
          context,
          path: ["dashboard", "inbox", "list"],
        })) as { items: Array<{ type: string; summary: string; links: { dashboard: string } }> }
      ).items.filter((item) => item.type === "invitation_not_sent");

    const [item] = await inbox((await apiKey())());
    assert.ok(item, "shown with team read");
    assert.match(item.summary, /lost@tm\.test/);
    assert.equal(item.links.dashboard, `${TEST_APP_URL}/dashboard/team?store=${STORE}`);
    assert.doesNotMatch(JSON.stringify(item), new RegExp(token));

    const noTeam = await apiKey({ permissions: { ...teamWrite, team: "none" } });
    assert.deepEqual(await inbox(noTeam()), [], "hidden without team read");

    // Once the invitation is no longer pending, there is nothing left to do.
    await louezDb.db
      .update(louezDb.storeInvitations)
      .set({ status: "cancelled" })
      .where(orm.eq(louezDb.storeInvitations.token, token));
    assert.deepEqual(await inbox((await apiKey())()), []);
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

  test("an existing member, a pending invitation and full seats are refused before any approval", async () => {
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

    assert.equal((await handoffs()).length, 0, "no approval was ever asked");
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
