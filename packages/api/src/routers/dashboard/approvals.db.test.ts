import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { BaseContext } from "../../context";
import type { Consequence } from "../../platform/approval-rule";

import { sha256 } from "../../platform/hash";
import { createMemoryStorage } from "../../platform/memory-storage";
import { lockWaitsOn } from "../../platform/test-lock-waits";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "approvals-test-secret";
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

const SESSION_HEADER = "x-test-session-user";
const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ap.test` } } : null;
        },
      },
    },
  },
});

// A person's approval of an agent's operation, end to end on the database,
// through the transport tests' fixture (`fixture.notes.erase`) with `money`
// made live for it alone: requested once the write's transaction is over, read,
// decided on its page, refused, expired and revoked; its identity, its caps
// and its cool-down; who reads it and who decides it; the inbox. Nothing is
// carried out yet: an approved approval presented with a call runs nothing.
// Every duration is read from the rule's own constants, and time passes by
// moving a row's dates back (the rules read the database's clock).

const OWNER = "ap_owner_user_000001";
const CO_OWNER = "ap_coowner_user_0001";
const MEMBER = "ap_member_user_00001";
const STRANGER = "ap_stranger_user_001";
const STORE = "ap_store_a_000000001";
const OTHER_STORE = "ap_store_b_000000001";
const PROCEDURE = "fixture.notes.erase";
const CLIENT = "https://claude.ap.test/oauth/client.json";

describe("a person's approval (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let handoffs: typeof import("../../services/handoffs");
  let approvals: typeof import("../../services/approvals");
  let confirmation: typeof import("../../platform/confirmation");
  let grants: typeof import("../../services/agent-grants");
  let routers: {
    handoffs: typeof import("./handoffs").dashboardHandoffsRouter;
    inbox: typeof import("./inbox").dashboardInboxRouter;
  };
  type Fixture = ReturnType<typeof import("../../platform/testing").createFixtureRouter>;
  let fixtureRouter: typeof import("../../platform/testing").createFixtureRouter;
  let live: Fixture["fixture"]["notes"];
  let notLive: Fixture["fixture"]["notes"];
  let LIFETIME: { actMs: number; executeMs?: number };

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    hostedBy: (): "lumycloud" | null => null,
    team: { collaboratorLimit: async () => 10, emailConfigured: () => true },
  };

  before(async () => {
    tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
    database = await createTestDatabase("api_approvals");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    handoffs = await import("../../services/handoffs");
    approvals = await import("../../services/approvals");
    confirmation = await import("../../platform/confirmation");
    grants = await import("../../services/agent-grants");
    routers = {
      handoffs: (await import("./handoffs")).dashboardHandoffsRouter,
      inbox: (await import("./inbox")).dashboardInboxRouter,
    };
    fixtureRouter = (await import("../../platform/testing")).createFixtureRouter;
    live = fixtureRouter({ liveConsequences: ["money"] }).fixture.notes;
    notLive = fixtureRouter().fixture.notes;
    LIFETIME = handoffs.HANDOFF_LIFETIMES.operation_approval;
    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ap.test", name: "Olga Owner" },
      { id: CO_OWNER, email: "coowner@ap.test", name: "Corentin Coowner" },
      { id: MEMBER, email: "member@ap.test", name: "Malo Member" },
      { id: STRANGER, email: "stranger@ap.test", name: "Sven Stranger" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: "Claude",
      uri: "https://claude.ap.test",
      clientDiscoveryId: "cimd",
      redirectUris: JSON.stringify(["https://client.ap.test/callback"]),
    });
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
      louezDb.apiAgentGrants,
      louezDb.apiRateLimits,
      louezDb.categories,
      louezDb.inboxAcknowledgements,
      louezDb.storeMembers,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Roscoff Voile",
        slug: "ap-roscoff",
        settings: { currency: "EUR", country: "FR" },
        onboardingCompleted: true,
      },
      {
        id: OTHER_STORE,
        userId: OWNER,
        name: "Carantec Voile",
        slug: "ap-carantec",
        settings: { currency: "EUR", country: "FR" },
        onboardingCompleted: true,
      },
    ]);
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: CO_OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const rights: Permissions = {
    reservations: "read",
    products: "none",
    customers: "none",
    categories: "write",
    payments: "none",
    analytics: "none",
    settings: "none",
    team: "none",
  };

  interface Key {
    id: string;
    context: (headers?: Record<string, string>) => BaseContext;
  }

  /** An API key on a store; `confirm: false` turns its confirmations off. */
  async function apiKey(
    options: {
      userId?: string;
      storeId?: string;
      confirm?: boolean;
      permissions?: Permissions;
    } = {},
  ): Promise<Key> {
    const storeId = options.storeId ?? STORE;
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId,
      userId: options.userId ?? OWNER,
      name: "Store agent",
      permissions: options.permissions ?? rights,
    });
    if (options.confirm === false) {
      await apiKeys.setApiKeyConfirmation({
        db: louezDb.db,
        storeId,
        keyId: created.id,
        confirmSensitive: false,
      });
    }
    return {
      id: created.id,
      context: (headers = {}) => ({
        headers: new Headers({ authorization: `Bearer ${created.key}`, ...headers }),
        transport: "mcp",
        ports,
        receipt: {},
      }),
    };
  }

  /** What the owner consents to for the agent: categories written, in this store. */
  const grantTerms = {
    stores: { all: false as const, ids: [STORE] },
    preset: "write" as const,
    confirmSensitive: true,
    bundles: ["catalog" as const],
  };

  /** The owner's grant to the agent, saved as the consent page saves it. */
  async function saveAgentGrant() {
    const saved = await grants.saveGrant({ userId: OWNER, clientId: CLIENT, terms: grantTerms });
    return saved.id;
  }

  /** An agent over OAuth, with the owner's grant, acting on STORE. */
  async function oauthAgent() {
    const grant = await grants.loadActiveGrant({ userId: OWNER, clientId: CLIENT });
    const token = await tokens.sign({
      userId: OWNER,
      clientId: CLIENT,
      grantId: grant?.id ?? null,
    });
    return (headers: Record<string, string> = {}): BaseContext => ({
      headers: new Headers({ authorization: `Bearer ${token}`, "louez-store": STORE, ...headers }),
      transport: "mcp",
      ports,
      receipt: {},
    });
  }

  const session = (user = OWNER, store = STORE): BaseContext => ({
    headers: new Headers({ [SESSION_HEADER]: user, cookie: `louez_active_store=${store}` }),
    transport: "rpc",
    ports,
    receipt: {},
  });

  interface EraseInput {
    id: string;
    consequences?: [Consequence, ...Consequence[]];
    amount?: number;
    recipient?: string;
    note?: string;
  }

  const erase = (
    input: EraseInput,
    context: BaseContext,
    notes: Fixture["fixture"]["notes"] = live,
  ) =>
    orpc.call(
      notes.erase,
      { consequences: ["money"], amount: 40, ...input },
      { context, path: ["fixture", "notes", "erase"] },
    ) as Promise<{ id: string; erased: boolean; runs: number }>;

  interface Refusal {
    code: string | undefined;
    status: number | undefined;
    message: string;
    details: Record<string, unknown>;
    retryable: boolean | undefined;
  }

  /** The error a call fails with. */
  async function failure(promise: Promise<unknown>): Promise<Refusal> {
    try {
      await promise;
    } catch (error) {
      const caught = error as {
        status?: number;
        message?: string;
        data?: { code?: string; details?: Record<string, unknown>; retryable?: boolean };
      };
      return {
        code: caught.data?.code,
        status: caught.status,
        message: caught.message ?? "",
        details: caught.data?.details ?? {},
        retryable: caught.data?.retryable,
      };
    }
    assert.fail("the call succeeded");
  }

  interface ApprovalDetails {
    id: string;
    url: string;
    status: string;
    expiresAt: string;
    pollAfterSeconds: number;
    decision: { outcome: string; at: string; reason: string | null } | null;
    stillAsApproved?: boolean;
  }

  /** Asks for an approval: the call must answer APPROVAL_REQUIRED. */
  async function ask(input: EraseInput, key: Key, headers: Record<string, string> = {}) {
    const refused = await failure(erase(input, key.context(headers)));
    assert.equal(refused.code, "APPROVAL_REQUIRED", refused.message);
    return { ...refused, approval: refused.details.approval as ApprovalDetails };
  }

  const rows = () => louezDb.db.select().from(louezDb.apiHandoffs);
  const rowOf = async (id: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, id));
    assert.ok(row, `approval ${id}`);
    return row;
  };
  const storeDescription = async () => {
    const [row] = await louezDb.db
      .select({ description: louezDb.stores.description })
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, STORE));
    return row?.description ?? null;
  };
  const renameStore = (name: string) =>
    louezDb.db.update(louezDb.stores).set({ name }).where(orm.eq(louezDb.stores.id, STORE));

  /**
   * Time passes for an approval: every date of its row moves back by `ms`,
   * as the rules read the database's clock against them.
   */
  const age = (id: string, ms: number) => {
    const back = (column: unknown) => orm.sql`TIMESTAMPADD(MICROSECOND, ${-ms * 1000}, ${column})`;
    const t = louezDb.apiHandoffs;
    return louezDb.db
      .update(t)
      .set({
        createdAt: back(t.createdAt),
        linkIssuedAt: back(t.linkIssuedAt),
        expiresAt: back(t.expiresAt),
        decidedAt: back(t.decidedAt),
        failedAt: back(t.failedAt),
        updatedAt: back(t.updatedAt),
      } as never)
      .where(orm.eq(t.id, id));
  };

  /** A person's answer on the approval's page, as its route posts it. */
  async function decide(
    id: string,
    decision: "approve" | "refuse",
    options: { user?: string; revision?: number; shown?: string; reason?: string } = {},
  ) {
    const row = await rowOf(id);
    return orpc.call(
      routers.handoffs.decide,
      {
        id,
        decision,
        revision: options.revision ?? row.revision,
        shown: options.shown ?? row.bindingHash ?? "0".repeat(64),
        ...(options.reason ? { reason: options.reason } : {}),
      },
      { context: session(options.user ?? OWNER), path: ["dashboard", "handoffs", "decide"] },
    ) as Promise<{ handoffId: string; decision: string; outcome: string | null }>;
  }

  const get = (id: string, context: BaseContext) =>
    orpc.call(
      routers.handoffs.get,
      { id },
      {
        context,
        path: ["dashboard", "handoffs", "get"],
      },
    ) as Promise<{
      id: string;
      kind: string;
      status: string;
      url: string;
      expiresAt: Date;
      decision: { outcome: string; reason: string | null } | null;
      failure: { code: string } | null;
      invitation: unknown;
      summary: string;
    }>;

  const operations = () =>
    louezDb.db
      .select()
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.procedure, PROCEDURE));

  // --- Requesting -----------------------------------------------------------

  test("a call a person must approve writes the approval and does nothing else; its key runs again", async () => {
    const key = await apiKey();
    const before = await storeDescription();
    const asked = await ask({ id: "n1" }, key, { "idempotency-key": "erase-n1" });

    assert.equal(asked.status, 412);
    assert.equal(asked.retryable, false);
    const { approval } = asked;
    assert.match(approval.id, /^[A-Za-z0-9_-]{21}$/);
    assert.equal(approval.url, `${TEST_APP_URL}/handoffs/${approval.id}`);
    assert.equal(approval.status, "pending");
    assert.equal(approval.pollAfterSeconds, 30);
    assert.equal(approval.decision, null);
    assert.equal(asked.details.confirmationToken, approval.id);
    assert.deepEqual(asked.details.preview, {
      summary: "Erase note n1 of Roscoff Voile.",
      details: { id: "n1", amount: 40 },
    });

    // The approval survives the refusal, written as the request was.
    const row = await rowOf(approval.id);
    assert.equal(row.kind, "operation_approval");
    assert.equal(row.status, "pending");
    assert.equal(row.procedure, PROCEDURE);
    assert.equal(row.storeId, STORE);
    assert.equal(row.userId, OWNER);
    assert.equal(row.credentialKind, "api_key");
    assert.equal(row.credentialId, key.id);
    assert.equal(row.tokenHash, null, "its link is its id");
    assert.match(row.subject, /^[0-9a-f]{64}$/);
    assert.match(row.bindingHash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(row.revision, 1);
    assert.equal(row.activeSlot, 1);
    assert.equal(row.decision, null);
    assert.deepEqual(row.payload, {
      input: { id: "n1", consequences: ["money"], amount: 40 },
      preview: { summary: "Erase note n1 of Roscoff Voile.", details: { id: "n1", amount: 40 } },
      scope: { domain: "categories", level: "write", role: "delete" },
      consequences: ["money"],
    });
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), LIFETIME.actMs);
    assert.equal(approval.expiresAt, row.expiresAt.toISOString());

    // Nothing else of the write remains: its own write, its token, its record.
    assert.equal(await storeDescription(), before);
    assert.deepEqual(await louezDb.db.select().from(louezDb.apiConfirmations), []);
    const [operation] = await operations();
    assert.equal(operation?.status, "failed");
    assert.equal(operation?.error?.code, "APPROVAL_REQUIRED");
    assert.equal(operation?.setupStoreId, null);

    // A refusal: the same key runs again, and finds the same approval.
    const again = await ask({ id: "n1" }, key, { "idempotency-key": "erase-n1" });
    assert.equal(again.approval.id, approval.id);
    assert.equal((await operations()).length, 1, "one record for the key");
    assert.equal((await rows()).length, 1);
  });

  test("who is asked: a session never; a key with its option off still, for money; not live, the token as before", async () => {
    await erase({ id: "n1" }, session());
    assert.equal(await storeDescription(), "erased n1", "a session runs directly");
    assert.deepEqual(await rows(), []);

    const off = await apiKey({ confirm: false });
    await ask({ id: "n2" }, off);

    const key = await apiKey();
    const token = await failure(erase({ id: "n3" }, key.context(), notLive));
    assert.equal(token.code, "CONFIRMATION_REQUIRED");
    assert.match(String(token.details.confirmationToken), /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await rows()).length, 1, "a token writes no approval");
    const done = await erase(
      { id: "n3" },
      key.context({ "louez-confirmation": String(token.details.confirmationToken) }),
      notLive,
    );
    assert.equal(done.erased, true);

    // A live consequence below a person's level asks for the token.
    const change = await failure(erase({ id: "n4", consequences: ["change"] }, key.context()));
    assert.equal(change.code, "CONFIRMATION_REQUIRED");
  });

  test("asked again while pending: the same approval, its preview and binding refreshed, its revision raised, its day counted again", async () => {
    const key = await apiKey();
    const first = await ask({ id: "n1", note: "first words" }, key);
    const before = await rowOf(first.approval.id);
    await age(first.approval.id, 60_000);
    await renameStore("Roscoff Voile & Kayak");

    const second = await ask({ id: "n1", note: "other words" }, key);
    assert.equal(second.approval.id, first.approval.id, "same id, same link");
    assert.equal(second.approval.url, first.approval.url);
    const after = await rowOf(first.approval.id);
    assert.equal(after.revision, before.revision + 1);
    assert.notEqual(
      after.bindingHash,
      before.bindingHash,
      "the binding is the new input and state",
    );
    assert.equal(after.subject, before.subject, "a reworded request is the same request");
    assert.equal(
      (after.payload as { preview: { summary: string } }).preview.summary,
      "Erase note n1 of Roscoff Voile & Kayak.",
    );
    assert.equal(after.expiresAt.getTime() - after.linkIssuedAt.getTime(), LIFETIME.actMs);
    assert.ok(after.expiresAt > before.expiresAt, "a day again from this request");
    assert.equal(after.createdAt.getTime(), before.createdAt.getTime() - 60_000);
    assert.equal((await rows()).length, 1);
  });

  test("the identity: free text is one request; another amount, record or recipient is another", async () => {
    const key = await apiKey();
    const base = await ask({ id: "n1", recipient: "a@ap.test", note: "x" }, key);
    const reworded = await ask({ id: "n1", recipient: "a@ap.test", note: "y" }, key);
    const amount = await ask({ id: "n1", recipient: "a@ap.test", amount: 41 }, key);
    const record = await ask({ id: "n2", recipient: "a@ap.test" }, key);
    const recipient = await ask({ id: "n1", recipient: "b@ap.test" }, key);
    assert.equal(reworded.approval.id, base.approval.id);
    const ids = [base, amount, record, recipient].map((asked) => asked.approval.id);
    assert.equal(new Set(ids).size, 4);
    assert.equal((await rows()).length, 4);

    // The same request from another connection of the same user is its own.
    const other = await apiKey();
    const theirs = await ask({ id: "n1", recipient: "a@ap.test" }, other);
    assert.notEqual(theirs.approval.id, base.approval.id);
    // The identity names the recipient by its hash, never as written.
    const facts = { id: "n1", amount: 40, recipient: sha256("a@ap.test") };
    assert.equal(
      (await rowOf(base.approval.id)).subject,
      approvals.approvalIdentity({
        credential: { kind: "api_key", id: key.id },
        storeId: STORE,
        procedure: PROCEDURE,
        facts,
      }),
    );
  });

  test("two identical requests at once: one approval, never two rows", async () => {
    const key = await apiKey();
    const answers = await Promise.all([
      failure(erase({ id: "n1" }, key.context())),
      failure(erase({ id: "n1", note: "same request, other words" }, key.context())),
    ]);
    for (const answer of answers) assert.equal(answer.code, "APPROVAL_REQUIRED");
    const ids = answers.map((answer) => (answer.details.approval as ApprovalDetails).id);
    assert.equal(ids[0], ids[1]);
    const written = await rows();
    assert.equal(written.length, 1);
    assert.equal(written[0]?.revision, 2, "the second request refreshed the first");
  });

  test("the database holds one open approval per identity, whatever the code", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const row = await rowOf(asked.approval.id);
    const { id: _id, ...copy } = row;
    await assert.rejects(
      louezDb.db.insert(louezDb.apiHandoffs).values({ ...copy, createdAt: new Date() }),
      (error: Error) => /Duplicate entry/.test(String(error.cause)),
    );
  });

  // --- Presenting an approval's id ------------------------------------------

  test("a call that carries a pending approval's id is told it waits, and changes nothing", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const before = await rowOf(asked.approval.id);
    const pending = await failure(
      erase({ id: "n1" }, key.context({ "louez-confirmation": asked.approval.id })),
    );
    assert.equal(pending.code, "APPROVAL_PENDING");
    assert.equal(pending.status, 412);
    assert.equal(pending.retryable, true);
    assert.equal((pending.details.approval as ApprovalDetails).id, asked.approval.id);
    assert.deepEqual(await rowOf(asked.approval.id), before, "nothing changed");
    assert.equal(await storeDescription(), null);
  });

  test("an approved approval asked again keeps its binding and decision, and answers with the preview the person approved", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const approvedPreview = asked.details.preview;
    await decide(asked.approval.id, "approve", { reason: "Go ahead" });
    const approved = await rowOf(asked.approval.id);
    assert.equal(approved.status, "approved");

    // Asked again as it was: the approved preview, and still as approved.
    const same = await ask({ id: "n1" }, key);
    assert.equal(same.approval.id, asked.approval.id);
    assert.equal(same.approval.status, "approved");
    assert.equal(same.approval.decision?.outcome, "approved");
    assert.equal(same.approval.decision?.reason, "Go ahead");
    assert.equal(same.approval.stillAsApproved, true);
    assert.deepEqual(same.details.preview, approvedPreview);
    assert.deepEqual(await rowOf(asked.approval.id), approved, "binding and decision intact");

    // The store moves: the answer still shows what the person approved, and says it no longer holds.
    await renameStore("Roscoff Glisse");
    const changed = await ask({ id: "n1" }, key);
    assert.equal(changed.approval.id, asked.approval.id);
    assert.equal(changed.approval.stillAsApproved, false);
    assert.deepEqual(changed.details.preview, approvedPreview, "never this call's preview");
    assert.match(changed.message, /^The user approved: Erase note n1 of Roscoff Voile\./);
    assert.match(changed.message, /no longer as the preview the user approved showed/);
    assert.deepEqual(await rowOf(asked.approval.id), approved, "binding and decision intact");
  });

  test("an approved approval presented before it can be carried out is a refusal: nothing runs, and the key runs again", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await decide(asked.approval.id, "approve");
    const approved = await rowOf(asked.approval.id);

    const presented = await failure(
      erase(
        { id: "n1" },
        key.context({ "louez-confirmation": asked.approval.id, "idempotency-key": "k-approved" }),
      ),
    );
    assert.equal(presented.code, "APPROVAL_INVALID");
    assert.equal(presented.status, 412);
    assert.deepEqual(presented.details, { reason: "execution_unavailable" });
    assert.equal(await storeDescription(), null, "the write did not run");
    assert.deepEqual(await rowOf(asked.approval.id), approved, "the approval did not change");
    const keyed = async () =>
      (await operations()).filter((operation) => operation.idempotencyKey === "k-approved");
    const [operation] = await keyed();
    assert.equal(operation?.status, "failed", "a refusal: its key may run again");
    assert.equal(operation?.error?.code, "APPROVAL_INVALID");

    // The same key runs again, and is answered, not told its outcome is unknown.
    const again = await ask({ id: "n1" }, key, { "idempotency-key": "k-approved" });
    assert.equal(again.approval.id, asked.approval.id);
    assert.equal((await keyed()).length, 1, "one record for the key");
  });

  test("a leaked id: another credential, store, procedure or request learns nothing and changes nothing", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const before = await rowOf(asked.approval.id);
    const unknownId = "x".repeat(21);
    const unknown = await failure(
      erase({ id: "n1" }, key.context({ "louez-confirmation": unknownId })),
    );
    assert.equal(unknown.code, "APPROVAL_INVALID");
    assert.deepEqual(unknown.details, { reason: "other_request" });
    const same = (refusal: Refusal, label: string) =>
      assert.deepEqual(
        { code: refusal.code, details: refusal.details, message: refusal.message },
        { code: unknown.code, details: unknown.details, message: unknown.message },
        label,
      );
    const presenting = { "louez-confirmation": asked.approval.id };

    // Another key of the same user, on the same store.
    const sibling = await apiKey();
    same(await failure(erase({ id: "n1" }, sibling.context(presenting))), "another key");
    // The same user's key on another store.
    const elsewhere = await apiKey({ storeId: OTHER_STORE });
    same(await failure(erase({ id: "n1" }, elsewhere.context(presenting))), "another store");
    // The same key, another request (another record).
    same(await failure(erase({ id: "n2" }, key.context(presenting))), "another request");
    // The same key and request, named as another procedure.
    const actor = {
      transport: "mcp" as const,
      isPlatformAdmin: false,
      storeId: STORE,
      credential: {
        kind: "api_key" as const,
        id: key.id,
        clientName: "Store agent",
        userId: OWNER,
        email: null,
        storeId: STORE,
        stores: null,
        scopes: null,
        confirmSensitive: true,
        bundles: null,
      },
    };
    const otherRefusal = await louezDb.db.transaction((tx) =>
      confirmation.checkConfirmation({
        consequences: ["money"],
        executor: tx,
        actor,
        headers: new Headers(presenting),
        procedure: "fixture.notes.other",
        input: { id: "n1", consequences: ["money"], amount: 40 },
        state: { name: "Roscoff Voile" },
        preview: { summary: "Other." },
        approval: {
          facts: { id: "n1", amount: 40, recipient: null },
          scope: { domain: "categories", level: "write", role: "delete" },
          urls: ports.urls,
        },
        liveConsequences: ["money"],
      }),
    );
    assert.ok(otherRefusal);
    same(await failure(confirmation.raiseConfirmation(otherRefusal)), "another procedure");
    // A procedure that asks for the token reads it as an unknown token.
    const token = await failure(erase({ id: "n1" }, key.context(presenting), notLive));
    assert.equal(token.code, "CONFIRMATION_INVALID");

    assert.deepEqual(await rowOf(asked.approval.id), before, "nothing changed");
    assert.equal((await rows()).length, 1, "no approval was written for them");
  });

  test("handoffs_get gives an approval to the connection that asked, and to nobody else", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const view = await get(asked.approval.id, key.context());
    assert.equal(view.kind, "operation_approval");
    assert.equal(view.status, "pending");
    assert.equal(view.url, asked.approval.url);
    assert.equal(view.decision, null);
    assert.equal(view.invitation, null);

    const unknown = await failure(get("x".repeat(21), key.context()));
    assert.equal(unknown.code, "HANDOFF_NOT_FOUND");
    const masked = (refusal: Refusal, id: string) => ({
      code: refusal.code,
      message: refusal.message.replaceAll(id, "<id>"),
    });
    const expected = masked(unknown, "x".repeat(21));
    const others: Array<[string, BaseContext]> = [
      ["another key of the same user, reading the domain", (await apiKey()).context()],
      ["the owner's session", session(OWNER)],
      ["a co-owner's session", session(CO_OWNER)],
    ];
    for (const [label, context] of others) {
      assert.deepEqual(
        masked(await failure(get(asked.approval.id, context)), asked.approval.id),
        expected,
        label,
      );
    }
    const elsewhere = await apiKey({ storeId: OTHER_STORE });
    assert.equal(
      (await failure(get(asked.approval.id, elsewhere.context()))).code,
      "HANDOFF_NOT_FOUND",
    );
  });

  // --- Deciding ---------------------------------------------------------------

  test("approved on its page: the decision written with it, executable for an hour; the agent reads it", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const decided = await decide(asked.approval.id, "approve", { reason: "  Yes,\r\nplease  " });
    assert.deepEqual(decided, {
      handoffId: asked.approval.id,
      decision: "approved",
      outcome: null,
    });
    const row = await rowOf(asked.approval.id);
    assert.equal(row.status, "approved");
    assert.equal(row.decision, "approved");
    assert.equal(row.decidedByUserId, OWNER);
    assert.equal(row.decisionReason, "Yes,\nplease");
    assert.ok(row.decidedAt);
    assert.equal(row.expiresAt.getTime() - row.decidedAt.getTime(), LIFETIME.executeMs);
    assert.equal(row.updatedAt.getTime(), row.decidedAt.getTime(), "in the same statement");
    assert.equal(row.activeSlot, 1, "an approved approval stays open");
    const view = await get(asked.approval.id, key.context());
    assert.equal(view.status, "approved");
    assert.equal(view.decision?.outcome, "approved");
    assert.equal(view.decision?.reason, "Yes,\nplease");
  });

  test("refused on its page: failed, declined; presented, the call is told so", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await decide(asked.approval.id, "refuse", { reason: "Not this one" });
    const row = await rowOf(asked.approval.id);
    assert.equal(row.status, "failed");
    assert.equal(row.failureCode, "declined");
    assert.equal(row.decision, "refused");
    assert.equal(row.activeSlot, null);
    assert.equal(row.failedAt?.getTime(), row.decidedAt?.getTime());
    const view = await get(asked.approval.id, key.context());
    assert.equal(view.status, "failed");
    assert.equal(view.decision?.outcome, "refused");

    const declined = await failure(
      erase({ id: "n1" }, key.context({ "louez-confirmation": asked.approval.id })),
    );
    assert.equal(declined.code, "APPROVAL_DECLINED");
    assert.equal(declined.status, 409);
    assert.equal(declined.retryable, false);
    assert.deepEqual(declined.details, { approvalId: asked.approval.id, reason: "Not this one" });
  });

  test("whose step first, then may they approve: another user, a lost right, a forged revision or binding decide nothing", async () => {
    const key = await apiKey({ userId: CO_OWNER });
    const asked = await ask({ id: "n1" }, key);
    const before = await rowOf(asked.approval.id);
    const refusedFor = async (options: Parameters<typeof decide>[2]) =>
      (await failure(decide(asked.approval.id, "approve", options))).details.reason;

    for (const user of [OWNER, MEMBER, STRANGER]) {
      assert.equal(await refusedFor({ user }), "other_user", user);
    }
    assert.equal(await refusedFor({ user: CO_OWNER, revision: before.revision + 1 }), "changed");
    assert.equal(await refusedFor({ user: CO_OWNER, shown: "f".repeat(64) }), "changed");
    // The co-owner becomes a member, who may not delete: no longer theirs to approve.
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "member" })
      .where(orm.eq(louezDb.storeMembers.userId, CO_OWNER));
    assert.equal(await refusedFor({ user: CO_OWNER }), "not_allowed");
    assert.deepEqual(await rowOf(asked.approval.id), before, "nothing was decided");

    // The page: only its approver reads it, and it continues to no provider.
    assert.equal((await handoffs.readHandoffLink(asked.approval.id, OWNER)).reason, "other_user");
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "owner" })
      .where(orm.eq(louezDb.storeMembers.userId, CO_OWNER));
    assert.equal((await handoffs.readHandoffLink(asked.approval.id, CO_OWNER)).ok, true);
    const continued = await handoffs.continueHandoff(asked.approval.id, CO_OWNER, before.revision);
    assert.equal(continued.ok, false);
    assert.equal(
      (await rowOf(asked.approval.id)).status,
      "pending",
      "an approval never takes opened",
    );
  });

  test("a decision after the end decides nothing: approved, refused or expired", async () => {
    const key = await apiKey();
    const approved = await ask({ id: "n1" }, key);
    await decide(approved.approval.id, "approve");
    for (const decision of ["approve", "refuse"] as const) {
      const refusal = await failure(decide(approved.approval.id, decision));
      assert.equal(refusal.code, "HANDOFF_DECISION_INVALID");
      assert.equal(refusal.details.reason, "finished", decision);
    }
    const expired = await ask({ id: "n2" }, key);
    await age(expired.approval.id, LIFETIME.actMs);
    assert.equal((await failure(decide(expired.approval.id, "approve"))).details.reason, "expired");
    assert.equal((await rowOf(expired.approval.id)).status, "pending", "expiry is never written");
  });

  test("approve and refuse posted at once: one decides, and the row holds it", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const results = await Promise.allSettled([
      decide(asked.approval.id, "approve"),
      decide(asked.approval.id, "refuse"),
    ]);
    const decided = results.filter((result) => result.status === "fulfilled");
    assert.equal(decided.length, 1);
    const row = await rowOf(asked.approval.id);
    const won = (decided[0] as PromiseFulfilledResult<{ decision: string }>).value.decision;
    assert.equal(row.decision, won);
    assert.equal(row.status, won === "approved" ? "approved" : "failed");
  });

  /** Resolves once `waiting` transactions wait for a lock on a row of `table`: a real lock wait. */
  const lockWait = (table: string, waiting = 1) =>
    lockWaitsOn(louezDb.db, table, { count: waiting });

  type Tx = Parameters<Parameters<typeof louezDb.db.transaction>[0]>[0];

  /**
   * Holds what `lock` locks, in a transaction of the test's, until `release`
   * is called; every test releases it in `finally`, then awaits `done`.
   */
  function holdLock(lock: (tx: Tx) => Promise<unknown>) {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = louezDb.db.transaction(async (tx) => {
      await lock(tx);
      ready();
      await released;
    });
    return { held, release, done };
  }

  const holdApprovalRow = (id: string) =>
    holdLock((tx) =>
      tx
        .select({ id: louezDb.apiHandoffs.id })
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id))
        .for("update"),
    );

  test("the agent asks again while the person's click waits for the store's lock: the refresh commits first, and the click decides nothing", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const page = await rowOf(asked.approval.id);
    // The approval's row held: the repeated request takes the store's lock,
    // then waits for the row to refresh it; the click waits for the store's lock.
    const row = holdApprovalRow(asked.approval.id);
    await row.held;
    let repeat: Promise<Refusal> | null = null;
    let click: Promise<Refusal> | null = null;
    try {
      repeat = failure(erase({ id: "n1" }, key.context()));
      await lockWait("api_handoffs");
      click = failure(decide(asked.approval.id, "approve", { revision: page.revision }));
      await lockWait("stores");
    } finally {
      row.release();
      await row.done;
    }
    assert.equal((await repeat).code, "APPROVAL_REQUIRED");
    const refusal = await click;
    assert.equal(refusal.details.reason, "changed");
    const after = await rowOf(asked.approval.id);
    assert.equal(after.status, "pending");
    assert.equal(after.revision, page.revision + 1);
    assert.equal(after.bindingHash, page.bindingHash, "the same request exactly");
    assert.equal(after.decision, null);
  });

  test("a click that waited for the approval's row past its expiry is refused as expired, and decides nothing", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    // A second left to decide, on the database's clock.
    await louezDb.db.execute(
      orm.sql`UPDATE api_handoffs SET expires_at = NOW(3) + INTERVAL 1 SECOND WHERE id = ${asked.approval.id}`,
    );
    const row = holdApprovalRow(asked.approval.id);
    await row.held;
    let click: Promise<Refusal> | null = null;
    try {
      click = failure(decide(asked.approval.id, "approve"));
      await lockWait("api_handoffs");
      // The database's clock passes the expiry while the click waits.
      for (;;) {
        const [passed] = (await louezDb.db.execute(
          orm.sql`SELECT expires_at <= NOW(3) AS passed FROM api_handoffs WHERE id = ${asked.approval.id}`,
        )) as unknown as [Array<{ passed: number }>];
        if (Number(passed[0]?.passed) === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      row.release();
      await row.done;
    }
    const refusal = await click;
    assert.equal(refusal.code, "HANDOFF_DECISION_INVALID");
    assert.equal(refusal.details.reason, "expired");
    const after = await rowOf(asked.approval.id);
    assert.equal(after.status, "pending");
    assert.equal(after.decision, null);
  });

  test("a request's write ends before its approval waits for the store's row: a writer holding that row, then the write's domain lock, does not deadlock", async () => {
    await louezDb.db
      .insert(louezDb.categories)
      .values({ id: "ap_category_00000001", storeId: STORE, name: "Dériveurs" });
    // The request's write pauses once it has asked, its domain lock held.
    let resume: () => void = () => {};
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let asked: () => void = () => {};
    const hasAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const notes = fixtureRouter({
      liveConsequences: ["money"],
      whileAsked: async () => {
        asked();
        await resumed;
      },
    }).fixture.notes;
    const key = await apiKey();
    // A writer in the order products and settings take: the store's row, then its domain.
    const gate = () => {
      let open: () => void = () => {};
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { open, opened };
    };
    const holdsStore = gate();
    const goForDomain = gate();
    const gotDomain = gate();
    const writerDone = gate();
    const writer = louezDb.db.transaction(async (tx) => {
      await tx
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, STORE))
        .for("update");
      holdsStore.open();
      await goForDomain.opened;
      await tx
        .select({ id: louezDb.categories.id })
        .from(louezDb.categories)
        .where(orm.eq(louezDb.categories.storeId, STORE))
        .for("update");
      gotDomain.open();
      await writerDone.opened;
    });
    await holdsStore.opened;
    let request: Promise<Refusal> | null = null;
    try {
      request = failure(erase({ id: "n1" }, key.context(), notes));
      await hasAsked;
      // The writer, holding the store's row, waits for the domain lock the write holds.
      goForDomain.open();
      await lockWait("categories");
      // The write goes on: it ends without waiting for the store's row.
      resume();
      await gotDomain.opened;
      // Then the request waits for the store's row, its write's locks all released.
      await lockWait("stores");
    } finally {
      resume();
      goForDomain.open();
      writerDone.open();
      await writer; // no deadlock was raised
    }
    assert.equal((await request).code, "APPROVAL_REQUIRED");
    assert.equal((await rows()).length, 1);
  });

  test("an agent's request racing its grant's update and a new consent: no deadlock", async () => {
    const grantId = await saveAgentGrant();
    const context = await oauthAgent();
    const store = holdLock((tx) =>
      tx
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, STORE))
        .for("update"),
    );
    await store.held;
    let request: Promise<Refusal> | null = null;
    let update: Promise<unknown> | null = null;
    let consent: Promise<unknown> | null = null;
    try {
      // The request's write is over: its own transaction waits for the store's row.
      request = failure(erase({ id: "n1" }, context()));
      await lockWait("stores");
      // The grant's writers hold the grant's row, then check the store's row
      // as a foreign key of the grant's stores.
      update = grants.updateGrant({
        userId: OWNER,
        id: grantId,
        patch: { stores: { all: false, ids: [STORE] } },
      });
      await lockWait("stores", 2);
      consent = grants.saveGrant({ userId: OWNER, clientId: CLIENT, terms: grantTerms });
    } finally {
      store.release();
      await store.done;
    }
    assert.equal((await request).code, "APPROVAL_REQUIRED");
    await update;
    await consent;
    const [row] = await rows();
    assert.equal(row?.credentialKind, "oauth");
    assert.equal(row?.credentialId, grantId);
  });

  test("a write retried on a deadlock requests its approval once, after the transaction that refused it", async () => {
    const notes = fixtureRouter({ liveConsequences: ["money"], deadlocksBeforeCommit: 1 }).fixture
      .notes;
    const key = await apiKey();
    const asked = await failure(
      erase({ id: "n1" }, key.context({ "idempotency-key": "retried" }), notes),
    );
    assert.equal(asked.code, "APPROVAL_REQUIRED");
    const [row] = await rows();
    assert.equal(row?.revision, 1, "requested once, not once per attempt");
    assert.equal((await rows()).length, 1);
    assert.equal(await storeDescription(), null);
  });

  test("a request that fails after the write's transaction leaves nothing: the call fails, and a new call requests it", async () => {
    const key = await apiKey();
    // The approvals' table gone for a moment: the request fails once the write is over.
    await louezDb.db.execute(orm.sql`RENAME TABLE api_handoffs TO api_handoffs_away`);
    let failed: Refusal | null = null;
    try {
      failed = await failure(erase({ id: "n1" }, key.context({ "idempotency-key": "lost" })));
    } finally {
      await louezDb.db.execute(orm.sql`RENAME TABLE api_handoffs_away TO api_handoffs`);
    }
    assert.ok(failed);
    assert.notEqual(failed.code, "APPROVAL_REQUIRED");
    assert.deepEqual(await rows(), [], "nothing written");
    assert.equal(await storeDescription(), null, "nothing of the write either");
    const [operation] = await operations();
    assert.notEqual(operation?.status, "succeeded");
    // Another call requests it.
    const again = await ask({ id: "n1" }, key);
    assert.equal((await rowOf(again.approval.id)).status, "pending");
  });

  // --- Refusals, cool-down, expiry ----------------------------------------------

  test("refused: the same request within the hour is refused at once, reworded too; another request is not; after the hour it may ask", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1", note: "please" }, key);
    await decide(asked.approval.id, "refuse");
    const refusedAt = (await rowOf(asked.approval.id)).decidedAt;
    assert.ok(refusedAt);

    for (const note of ["please", "pretty please"]) {
      const cooling = await failure(erase({ id: "n1", note }, key.context()));
      assert.equal(cooling.code, "APPROVAL_RECENTLY_DECLINED", note);
      assert.equal(cooling.status, 409);
      assert.equal(
        cooling.details.retryAt,
        new Date(refusedAt.getTime() + approvals.APPROVAL_COOL_DOWN_MS).toISOString(),
      );
      assert.ok(Number(cooling.details.retryAfterSeconds) > 0);
    }
    // Another request, and the same request from another connection, are not blocked.
    await ask({ id: "n2" }, key);
    await ask({ id: "n1" }, await apiKey());
    assert.equal((await rows()).length, 3);

    // An hour later, the same request asks again: a new approval.
    await age(asked.approval.id, approvals.APPROVAL_COOL_DOWN_MS);
    const later = await ask({ id: "n1" }, key);
    assert.notEqual(later.approval.id, asked.approval.id);
  });

  test("undecided for a day: expired, as computed; presented, it says so; asked again, a new approval, the old row as it was", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await age(asked.approval.id, LIFETIME.actMs);
    const old = await rowOf(asked.approval.id);
    assert.equal(old.status, "pending", "expiry is computed, never written");
    assert.equal((await get(asked.approval.id, key.context())).status, "expired");

    const presented = await failure(
      erase({ id: "n1" }, key.context({ "louez-confirmation": asked.approval.id })),
    );
    assert.equal(presented.code, "APPROVAL_INVALID");
    assert.deepEqual(presented.details, { reason: "expired" });

    const again = await ask({ id: "n1" }, key);
    assert.notEqual(again.approval.id, asked.approval.id);
    const released = await rowOf(asked.approval.id);
    assert.equal(released.activeSlot, null, "it gave its slot to the new request");
    assert.equal(released.status, "pending");
    assert.equal(released.revision, old.revision);
    assert.equal((await get(asked.approval.id, key.context())).status, "expired");
  });

  test("approved and not carried out within the hour: expired, and the same request may ask again", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await decide(asked.approval.id, "approve");
    await age(asked.approval.id, LIFETIME.executeMs ?? 0);
    assert.equal((await get(asked.approval.id, key.context())).status, "expired");
    const presented = await failure(
      erase({ id: "n1" }, key.context({ "louez-confirmation": asked.approval.id })),
    );
    assert.deepEqual(presented.details, { reason: "expired" });
    const again = await ask({ id: "n1" }, key);
    assert.notEqual(again.approval.id, asked.approval.id);
    const old = await rowOf(asked.approval.id);
    assert.equal(old.status, "approved", "its decision stays as it was");
    assert.equal(old.decision, "approved");
  });

  // --- Revocation -------------------------------------------------------------

  test("a revoked connection ends its approvals, pending and approved; another key's stay", async () => {
    const key = await apiKey();
    const pending = await ask({ id: "n1" }, key);
    const approved = await ask({ id: "n2" }, key);
    await decide(approved.approval.id, "approve");
    const other = await apiKey();
    const untouched = await ask({ id: "n1" }, other);

    await revoke(key);
    for (const id of [pending.approval.id, approved.approval.id]) {
      const row = await rowOf(id);
      assert.equal(row.status, "failed", id);
      assert.equal(row.failureCode, "connection_revoked", id);
      assert.equal(row.activeSlot, null, id);
    }
    assert.equal((await rowOf(approved.approval.id)).decision, "approved", "its decision stays");
    assert.equal((await rowOf(untouched.approval.id)).status, "pending", "another key's stays");
    // The revoked key no longer authenticates: its approval cannot be presented.
    const revoked = await failure(
      erase({ id: "n2" }, key.context({ "louez-confirmation": approved.approval.id })),
    );
    assert.equal(revoked.code, "UNAUTHENTICATED");
  });

  /** A key's revocation, as the dashboard's procedure runs it: the key, then its hand-offs. */
  const revoke = async (key: Key) => {
    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
    await handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
  };

  /**
   * Holds the store row's lock until `release` is called: a decision past its
   * first checks waits there, before its checks under the lock.
   */
  const holdStoreRow = () =>
    holdLock((tx) =>
      tx
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, STORE))
        .for("update"),
    );

  test("revoked while the click waits for the store's lock, past its first checks: nothing is approved, and it ends revoked", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const lock = holdStoreRow();
    await lock.held;
    // The click passes its first checks (the key still exists), then waits for the store's lock.
    const click = failure(decide(asked.approval.id, "approve"));
    try {
      await lockWait("stores");
      // The revocation's first statement commits meanwhile; its hand-offs' comes after the click.
      await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
    } finally {
      lock.release();
      await lock.done;
    }
    const refusal = await click;
    assert.equal(refusal.code, "HANDOFF_DECISION_INVALID");
    assert.equal(refusal.details.reason, "not_allowed");
    assert.equal((await rowOf(asked.approval.id)).decision, null, "nothing approved");
    await handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
    const row = await rowOf(asked.approval.id);
    assert.equal(row.status, "failed");
    assert.equal(row.failureCode, "connection_revoked");
    assert.equal(row.decision, null);
  });

  test("revoked whole while the click waits: the click finds it ended", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const lock = holdStoreRow();
    await lock.held;
    const click = failure(decide(asked.approval.id, "approve"));
    // The revocation's cleanup waits for the store's row too, behind the click.
    let revoked: Promise<void> = Promise.resolve();
    try {
      await lockWait("stores");
      await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
      revoked = handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
      await lockWait("stores", 2);
    } finally {
      lock.release();
      await lock.done;
    }
    await revoked;
    const refusal = await click;
    assert.ok(["not_allowed", "finished"].includes(String(refusal.details.reason)));
    const row = await rowOf(asked.approval.id);
    assert.equal(row.failureCode, "connection_revoked");
    assert.equal(row.decision, null);
  });

  test("approved first, then revoked: the approved approval ends revoked, its decision kept", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await decide(asked.approval.id, "approve");
    await revoke(key);
    const row = await rowOf(asked.approval.id);
    assert.equal(row.status, "failed");
    assert.equal(row.failureCode, "connection_revoked");
    assert.equal(row.activeSlot, null);
    assert.equal(row.decision, "approved");
  });

  test("a connection revoked while its request waits for the store's lock opens nothing", async () => {
    const key = await apiKey();
    const lock = holdStoreRow();
    await lock.held;
    // The call is authenticated and its write's transaction over: the request waits for the store.
    const asking = failure(erase({ id: "n1" }, key.context()));
    try {
      await lockWait("stores");
      await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
    } finally {
      lock.release();
      await lock.done;
    }
    assert.equal((await asking).code, "UNAUTHENTICATED");
    assert.equal((await rows()).length, 0, "no approval for a revoked connection");
  });

  test("a member removed while their request waits for the store's lock opens nothing", async () => {
    const key = await apiKey();
    const lock = holdStoreRow();
    await lock.held;
    const asking = failure(erase({ id: "n1" }, key.context()));
    try {
      await lockWait("stores");
      // The requester leaves the store; nobody could decide what they ask.
      await louezDb.db
        .delete(louezDb.storeMembers)
        .where(
          orm.and(
            orm.eq(louezDb.storeMembers.storeId, STORE),
            orm.eq(louezDb.storeMembers.userId, OWNER),
          ),
        );
    } finally {
      lock.release();
      await lock.done;
    }
    assert.equal((await asking).code, "NO_STORE_ACCESS");
    assert.equal((await rows()).length, 0, "no approval nobody could decide");
  });

  test("a revocation's cleanup takes one store at a time: a store's steps are ended while another store's row is held", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
    const lock = holdLock((tx) =>
      tx
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, OTHER_STORE))
        .for("update"),
    );
    await lock.held;
    let cleaned: Promise<void> = Promise.resolve();
    try {
      cleaned = handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [
        STORE,
        OTHER_STORE,
      ]);
      // It waits for the other store's row, the first store's steps already ended.
      await lockWait("stores");
      assert.equal((await rowOf(asked.approval.id)).failureCode, "connection_revoked");
    } finally {
      lock.release();
      await lock.done;
    }
    await cleaned;
  });

  test("a revocation's cleanup waits for the store's row: a step being opened is committed before it, and ended by it", async () => {
    const key = await apiKey();
    const lock = holdStoreRow();
    await lock.held;
    let cleaned: Promise<void> = Promise.resolve();
    try {
      // A request holds the store's row while it opens its approval: here the holder stands for it.
      cleaned = handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
      await lockWait("stores");
    } finally {
      lock.release();
      await lock.done;
    }
    await cleaned;

    // And with a step opened first: the cleanup, run from the store alone, ends it.
    const other = await apiKey();
    const asked = await ask({ id: "n2" }, other);
    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: other.id });
    await handoffs.failCredentialHandoffs({ kind: "api_key", id: other.id }, []);
    assert.equal((await rowOf(asked.approval.id)).failureCode, "connection_revoked");
  });

  // --- Caps -------------------------------------------------------------------

  test("ten open approvals per connection and store: the eleventh waits; asking again for an open one counts nothing", async () => {
    const key = await apiKey();
    for (let index = 0; index < approvals.MAX_PENDING_APPROVALS; index += 1) {
      await ask({ id: `n${index}` }, key);
    }
    const full = await failure(erase({ id: "n-last" }, key.context()));
    assert.equal(full.code, "APPROVALS_FULL");
    assert.equal(full.status, 429);
    assert.equal(full.retryable, true);
    assert.equal(full.details.limit, "connection_open");
    const first = (await rows()).map((row) => row.expiresAt.getTime()).sort()[0] ?? 0;
    const seconds = Number(full.details.retryAfterSeconds);
    assert.ok(seconds > 0 && seconds <= Math.ceil(LIFETIME.actMs / 1000));
    assert.ok(Date.now() + seconds * 1000 >= first - 1000, "until the first expires");

    // The same request again finds its own: no cap.
    await ask({ id: "n0", note: "again" }, key);
    // Another connection has its own ten.
    await ask({ id: "n-last" }, await apiKey());
    // One of its own ends: room for one.
    const one = (await rows()).find((row) => row.credentialId === key.id);
    assert.ok(one);
    await decide(one.id, "refuse");
    await ask({ id: "n-last" }, key);
  });

  test("eleven requests at once: ten approvals, one refused as full", async () => {
    const key = await apiKey();
    const answers = await Promise.all(
      Array.from({ length: approvals.MAX_PENDING_APPROVALS + 1 }, (_, index) =>
        failure(erase({ id: `n${index}` }, key.context())),
      ),
    );
    const codes = answers.map((answer) => answer.code).sort();
    assert.deepEqual(codes, [
      "APPROVALS_FULL",
      ...Array<string>(approvals.MAX_PENDING_APPROVALS).fill("APPROVAL_REQUIRED"),
    ]);
    assert.equal((await rows()).length, approvals.MAX_PENDING_APPROVALS);
  });

  test("thirty new requests an hour per connection and store, whatever ended since", async () => {
    const key = await apiKey();
    for (let index = 0; index < approvals.APPROVAL_REQUESTS_PER_HOUR; index += 1) {
      const asked = await ask({ id: `n${index}` }, key);
      // Ended at once, so that the open cap never stands in the way.
      await louezDb.db
        .update(louezDb.apiHandoffs)
        .set({ status: "failed", failureCode: "connection_revoked", activeSlot: null })
        .where(orm.eq(louezDb.apiHandoffs.id, asked.approval.id));
    }
    const full = await failure(erase({ id: "n-last" }, key.context()));
    assert.equal(full.code, "APPROVALS_FULL");
    assert.equal(full.details.limit, "connection_per_hour");
    // The first request leaves the hour: room again.
    const [first] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .orderBy(louezDb.apiHandoffs.createdAt)
      .limit(1);
    assert.ok(first);
    await age(first.id, approvals.APPROVAL_LIMITS.hourMs);
    await ask({ id: "n-last" }, key);
  });

  test("fifty open approvals per store, whatever the connection", async () => {
    const keys: Key[] = [];
    for (let index = 0; index < 6; index += 1) keys.push(await apiKey());
    let asked = 0;
    for (const key of keys.slice(0, 5)) {
      for (let index = 0; index < approvals.MAX_PENDING_APPROVALS; index += 1) {
        await ask({ id: `n${index}` }, key);
        asked += 1;
      }
    }
    assert.equal(asked, approvals.MAX_STORE_PENDING_APPROVALS);
    const full = await failure(erase({ id: "n0" }, keys[5]?.context() ?? session()));
    assert.equal(full.code, "APPROVALS_FULL");
    assert.equal(full.details.limit, "store_open");
    // Another store is not full.
    await ask({ id: "n0" }, await apiKey({ storeId: OTHER_STORE }));
  });

  test("the store's cap is exact under requests of several connections at once: from 49 open, exactly 50", async () => {
    const keys: Key[] = [];
    for (let index = 0; index < 9; index += 1) keys.push(await apiKey());
    for (const [position, key] of keys.slice(0, 5).entries()) {
      const count =
        position === 4 ? approvals.MAX_PENDING_APPROVALS - 1 : approvals.MAX_PENDING_APPROVALS;
      for (let index = 0; index < count; index += 1) await ask({ id: `n${index}` }, key);
    }
    assert.equal((await rows()).length, approvals.MAX_STORE_PENDING_APPROVALS - 1);
    const answers = await Promise.all(
      keys.slice(5).map((key) => failure(erase({ id: "n-race" }, key.context()))),
    );
    const codes = answers.map((answer) => answer.code).sort();
    assert.deepEqual(codes, [
      "APPROVALS_FULL",
      "APPROVALS_FULL",
      "APPROVALS_FULL",
      "APPROVAL_REQUIRED",
    ]);
    assert.equal((await rows()).length, approvals.MAX_STORE_PENDING_APPROVALS);
    for (const answer of answers.filter((answer) => answer.code === "APPROVALS_FULL")) {
      assert.equal(answer.details.limit, "store_open");
    }
  });

  test("requests of three connections at once, each its first: three approvals, no deadlock", async () => {
    const keys = [await apiKey(), await apiKey(), await apiKey()];
    const answers = await Promise.all(
      keys.map((key) => failure(erase({ id: "n1" }, key.context()))),
    );
    assert.deepEqual(
      answers.map((answer) => answer.code),
      ["APPROVAL_REQUIRED", "APPROVAL_REQUIRED", "APPROVAL_REQUIRED"],
    );
    assert.equal((await rows()).length, 3);
  });

  // --- The request path's own guards ------------------------------------------------

  test("a branch a person approves asks in its transaction, with what the approval is about; the fixture's live list never in production", async () => {
    const key = await apiKey();
    const context = key.context();
    const actor = {
      transport: "mcp" as const,
      isPlatformAdmin: false,
      storeId: STORE,
      credential: {
        kind: "api_key" as const,
        id: key.id,
        clientName: null,
        userId: OWNER,
        email: null,
        storeId: STORE,
        stores: null,
        scopes: null,
        confirmSensitive: true,
        bundles: null,
      },
    };
    const check = {
      consequences: ["money"] as ["money"],
      actor,
      headers: context.headers,
      procedure: PROCEDURE,
      input: {},
      state: {},
      preview: { summary: "x" },
      liveConsequences: ["money"] as const,
    };
    await assert.rejects(confirmation.checkConfirmation(check), /executor/);
    await assert.rejects(
      louezDb.db.transaction((tx) => confirmation.checkConfirmation({ ...check, executor: tx })),
      /approval/,
    );
    const environment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await assert.rejects(confirmation.checkConfirmation(check), /fixture/);
    } finally {
      process.env.NODE_ENV = environment;
    }
    assert.deepEqual(await rows(), []);
  });

  // --- The inbox -------------------------------------------------------------

  const inbox = async (context: BaseContext) => {
    const page = (await orpc.call(
      routers.inbox.list,
      {},
      {
        context,
        path: ["dashboard", "inbox", "list"],
      },
    )) as {
      unavailable?: unknown;
      items: Array<{
        id: string;
        occurredAt: Date;
        type: string;
        severity: string;
        summary: string;
        details: Record<string, unknown>;
        links: Record<string, string>;
        tools: string[];
      }>;
    };
    assert.deepEqual(page.unavailable ?? [], [], "every source answered");
    return page.items.filter((item) => item.type === "approval_waiting");
  };
  /** Past the inbox's hold-back, as if the request had been made a minute ago. */
  const shown = async (id: string) => age(id, 60_000);

  test("approval_waiting: to the connection that asked and to a session reading its domain; refused for a week unless asked again", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await shown(asked.approval.id);

    const [item] = await inbox(key.context());
    assert.ok(item, "the connection that asked sees it");
    assert.equal(item.id, `approval_waiting:${asked.approval.id}`);
    assert.equal(item.severity, "warning", "money");
    assert.match(
      item.summary,
      /^Erase note n1 of Roscoff Voile\. It waits for Olga Owner to approve it/,
    );
    assert.equal(item.links.dashboard, asked.approval.url);
    assert.deepEqual(item.tools, ["handoffs_get"]);
    assert.equal(item.details.status, "pending");
    assert.equal(item.details.domain, "categories");

    assert.equal((await inbox(session(CO_OWNER))).length, 1, "a session that reads categories");
    assert.deepEqual(await inbox((await apiKey()).context()), [], "another connection sees none");
    const noCategories = await apiKey({ permissions: { ...rights, categories: "none" } });
    assert.deepEqual(await inbox(noCategories.context()), []);

    // Refused: still shown, for the week.
    await decide(asked.approval.id, "refuse");
    await age(asked.approval.id, 60_000);
    const [refused] = await inbox(key.context());
    assert.equal(refused?.details.status, "failed");
    assert.equal(refused?.details.failureCode, "declined");

    // A week later, gone.
    await age(asked.approval.id, 7 * 86_400_000);
    assert.deepEqual(await inbox(key.context()), []);
  });

  test("a connection gone without its cleanup: what it asked is not decided, not counted, not listed as waiting", async () => {
    // Ten open approvals of a key, then the key revoked and nothing cleaned.
    const gone = await apiKey();
    const asked: string[] = [];
    for (let index = 0; index < approvals.MAX_PENDING_APPROVALS; index += 1) {
      asked.push((await ask({ id: `g${index}` }, gone)).approval.id);
    }
    for (const id of asked) await shown(id);
    assert.equal((await inbox(session())).length, asked.length, "listed while the key lives");
    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: gone.id });
    for (const id of asked) assert.equal((await rowOf(id)).status, "pending", "left as it was");

    // Not decided.
    const refusal = await failure(decide(asked[0] ?? "", "approve"));
    assert.equal(refusal.code, "HANDOFF_DECISION_INVALID");
    assert.equal((await rowOf(asked[0] ?? "")).decision, null);

    // Not listed as waiting to a session that reads the domain; and a newer
    // approval of a live connection is not pushed out of a short page by them.
    assert.deepEqual(await inbox(session()), []);
    const live = await ask({ id: "live" }, await apiKey());
    await shown(live.approval.id);
    const page = (await orpc.call(
      routers.inbox.list,
      { limit: 1 },
      { context: session(), path: ["dashboard", "inbox", "list"] },
    )) as { items: Array<{ id: string }> };
    assert.deepEqual(
      page.items.map((item) => item.id),
      [`approval_waiting:${live.approval.id}`],
    );

    // Not counted against the store: live connections open the store's fifty
    // (the one above is the first).
    let opened = 1;
    while (opened < approvals.MAX_STORE_PENDING_APPROVALS) {
      const key = await apiKey();
      for (
        let index = 0;
        index < approvals.MAX_PENDING_APPROVALS &&
        opened < approvals.MAX_STORE_PENDING_APPROVALS;
        index += 1
      ) {
        await ask({ id: `s${opened}` }, key);
        opened += 1;
      }
    }
    const full = await failure(erase({ id: "one-more" }, (await apiKey()).context()));
    assert.equal(full.code, "APPROVALS_FULL");
    assert.equal(full.details.limit, "store_open");
  });

  test("approval_waiting: an approval asked again replaces the one that expired", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    // Expired a minute ago: past the inbox's hold-back.
    await age(asked.approval.id, LIFETIME.actMs + 60_000);
    const [expired] = await inbox(key.context());
    assert.equal(expired?.details.status, "expired");
    const again = await ask({ id: "n1" }, key);
    await shown(again.approval.id);
    const items = await inbox(key.context());
    assert.deepEqual(
      items.map((item) => item.id),
      [`approval_waiting:${again.approval.id}`],
    );
  });

  test("approval_waiting: a connection that no longer reads the approval's domain no longer sees it, nor reads it", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await shown(asked.approval.id);
    assert.equal((await inbox(key.context())).length, 1);
    // The key's rights narrowed: categories no longer read.
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ permissions: { ...rights, categories: "none" } })
      .where(orm.eq(louezDb.apiKeys.id, key.id));
    assert.deepEqual(await inbox(key.context()), []);
    assert.equal((await failure(get(asked.approval.id, key.context()))).code, "HANDOFF_NOT_FOUND");
  });

  /** A key with one domain only, at `level`. */
  const onlyDomain = (domain: keyof Permissions, level: "read" | "write"): Permissions => ({
    reservations: "none",
    products: "none",
    customers: "none",
    categories: "none",
    payments: "none",
    analytics: "none",
    settings: "none",
    team: "none",
    [domain]: level,
  });

  test("approval_waiting: a key with only the approval's domain lists and acknowledges it; a key without that domain does neither", async () => {
    const key = await apiKey({ permissions: onlyDomain("categories", "write") });
    const asked = await ask({ id: "n1" }, key);
    await shown(asked.approval.id);
    const [item] = await inbox(key.context());
    assert.ok(item, "listed with categories alone");
    assert.equal(item.id, `approval_waiting:${asked.approval.id}`);

    // A key of another domain alone opens the inbox, and finds nothing of it.
    const other = await apiKey({ permissions: onlyDomain("products", "write") });
    assert.deepEqual(await inbox(other.context()), []);
    const page = (await orpc.call(
      routers.inbox.list,
      {},
      {
        context: other.context(),
        path: ["dashboard", "inbox", "list"],
      },
    )) as { items: unknown[] };
    assert.deepEqual(page.items, [], "no other item reaches it");
    const theirs = (await orpc.call(
      routers.inbox.acknowledge,
      { items: [{ id: item.id, occurredAt: item.occurredAt }] },
      { context: other.context(), path: ["dashboard", "inbox", "acknowledge"] },
    )) as { acknowledged: number; rejected: unknown[] };
    assert.equal(theirs.acknowledged, 0, "nor acknowledged by it: it does not hold it");
    assert.equal(theirs.rejected.length, 1);

    const mine = (await orpc.call(
      routers.inbox.acknowledge,
      { items: [{ id: item.id, occurredAt: item.occurredAt }] },
      { context: key.context(), path: ["dashboard", "inbox", "acknowledge"] },
    )) as { acknowledged: number };
    assert.equal(mine.acknowledged, 1);
    assert.deepEqual(await inbox(key.context()), [], "acknowledged, it leaves the inbox");
  });

  // --- The clocks ----------------------------------------------------------------

  /**
   * Runs `check` with the application's clock moved by `offsetMs` from the
   * database's: an approval's times are read on the database's clock alone.
   */
  async function withApplicationClock(offsetMs: number, check: () => Promise<void>) {
    mock.timers.enable({ apis: ["Date"], now: Date.now() + offsetMs });
    try {
      await check();
    } finally {
      mock.timers.reset();
    }
  }

  test("the application's clock ahead of the database's: an approval still in time reads pending and is decided", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await shown(asked.approval.id);
    await withApplicationClock(LIFETIME.actMs + 3_600_000, async () => {
      assert.equal((await get(asked.approval.id, key.context())).status, "pending");
      const page = await handoffs.readHandoffLink(asked.approval.id, OWNER);
      assert.equal(page.ok, true, "the page");
      const [item] = await inbox(key.context());
      assert.equal(item?.details.status, "pending", "the inbox");
      assert.equal((await decide(asked.approval.id, "approve")).decision, "approved");
      // Approved: its hour is read on the database's clock too.
      assert.equal((await get(asked.approval.id, key.context())).status, "approved");
      const answer = await ask({ id: "n1" }, key);
      assert.equal(answer.approval.status, "approved", "a request");
    });
  });

  test("the application's clock behind the database's: an approval past its day reads expired and is decided by nobody", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    await age(asked.approval.id, LIFETIME.actMs + 60_000);
    await withApplicationClock(-(LIFETIME.actMs + 3_600_000), async () => {
      assert.equal((await get(asked.approval.id, key.context())).status, "expired");
      const page = await handoffs.readHandoffLink(asked.approval.id, OWNER);
      assert.equal(page.ok === false && page.reason, "expired", "the page");
      const [item] = await inbox(key.context());
      assert.equal(item?.details.status, "expired", "the inbox");
      const refusal = await failure(decide(asked.approval.id, "approve"));
      assert.equal(refusal.details.reason, "expired", "the decision's first checks");
      const presented = await failure(
        erase({ id: "n1" }, key.context({ "louez-confirmation": asked.approval.id })),
      );
      assert.deepEqual(presented.details, { reason: "expired" }, "a presented id");
    });
    assert.equal((await rowOf(asked.approval.id)).decision, null);
  });
});
