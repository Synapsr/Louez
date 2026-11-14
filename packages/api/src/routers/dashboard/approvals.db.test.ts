import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { BaseContext } from "../../context";
import type { Consequence } from "../../platform/approval-rule";

import { sha256 } from "../../platform/hash";
import { createMemoryStorage } from "../../platform/memory-storage";
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
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
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
// made live for it alone: requested in the write's transaction, read,
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

describe("a person's approval (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let handoffs: typeof import("../../services/handoffs");
  let approvals: typeof import("../../services/approvals");
  let confirmation: typeof import("../../platform/confirmation");
  let routers: {
    handoffs: typeof import("./handoffs").dashboardHandoffsRouter;
    inbox: typeof import("./inbox").dashboardInboxRouter;
  };
  type Fixture = ReturnType<typeof import("../../platform/testing").createFixtureRouter>;
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
    database = await createTestDatabase("api_approvals");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    handoffs = await import("../../services/handoffs");
    approvals = await import("../../services/approvals");
    confirmation = await import("../../platform/confirmation");
    routers = {
      handoffs: (await import("./handoffs")).dashboardHandoffsRouter,
      inbox: (await import("./inbox")).dashboardInboxRouter,
    };
    const { createFixtureRouter } = await import("../../platform/testing");
    live = createFixtureRouter({ liveConsequences: ["money"] }).fixture.notes;
    notLive = createFixtureRouter().fixture.notes;
    LIFETIME = handoffs.HANDOFF_LIFETIMES.operation_approval;
    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ap.test", name: "Olga Owner" },
      { id: CO_OWNER, email: "coowner@ap.test", name: "Corentin Coowner" },
      { id: MEMBER, email: "member@ap.test", name: "Malo Member" },
      { id: STRANGER, email: "stranger@ap.test", name: "Sven Stranger" },
    ]);
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

  test("an approved approval asked again keeps its binding and decision; presented, it runs nothing yet", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key, { "idempotency-key": "k-approved" });
    await decide(asked.approval.id, "approve", { reason: "Go ahead" });
    const approved = await rowOf(asked.approval.id);
    assert.equal(approved.status, "approved");

    // The store moves, and the agent asks again without the id: unchanged.
    await renameStore("Roscoff Glisse");
    const again = await ask({ id: "n1", note: "reworded" }, key);
    assert.equal(again.approval.id, asked.approval.id);
    assert.equal(again.approval.status, "approved");
    assert.equal(again.approval.decision?.outcome, "approved");
    assert.equal(again.approval.decision?.reason, "Go ahead");
    assert.deepEqual(await rowOf(asked.approval.id), approved, "binding and decision intact");

    // Presented with the call: it cannot be carried out yet, and nothing runs.
    const presented = await failure(
      erase(
        { id: "n1" },
        key.context({ "louez-confirmation": asked.approval.id, "idempotency-key": "k-approved" }),
      ),
    );
    // An unexpected error, never a refusal nor an answer: every transport answers 500.
    assert.equal(presented.code, undefined, "no answer a caller could take for its write's");
    assert.match(presented.message, /cannot be carried out yet; nothing was done/);
    assert.equal(await storeDescription(), null, "the write did not run");
    assert.deepEqual(await rowOf(asked.approval.id), approved, "the approval did not change");
    const [operation] = await operations();
    assert.notEqual(operation?.status, "succeeded");
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
    const otherProcedure = await louezDb.db.transaction((tx) =>
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
    assert.ok(otherProcedure);
    same(
      {
        code: (otherProcedure as { data?: { code?: string } }).data?.code,
        status: undefined,
        message: otherProcedure.message,
        details:
          (otherProcedure as { data?: { details?: Record<string, unknown> } }).data?.details ?? {},
        retryable: undefined,
      },
      "another procedure",
    );
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

  /**
   * Waits until `statements` statements matching `pattern` wait in the
   * processlist: what is running there while a test holds a lock can only be
   * waiting for it.
   */
  async function lockWait(pattern: string, statements = 1) {
    for (let tries = 0; tries < 500; tries += 1) {
      const [found] = (await louezDb.db.execute(
        orm.sql`SELECT COUNT(*) AS n FROM information_schema.processlist
          WHERE db = DATABASE() AND command = 'Query' AND info LIKE ${pattern}`,
      )) as unknown as [Array<{ n: number | string }>];
      if (Number(found[0]?.n) >= statements) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no statement waited for a lock: ${pattern}`);
  }

  test("the agent asks again while the person's click waits for the store's lock: the click decides nothing", async () => {
    const key = await apiKey();
    const asked = await ask({ id: "n1" }, key);
    const page = await rowOf(asked.approval.id);

    // The repeated request, through the code that requests, holds the store's
    // lock until the click's statement waits for it.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let repeated: (() => void) | null = null;
    const repeatedNow = new Promise<void>((resolve) => {
      repeated = resolve;
    });
    const repeat = louezDb.db.transaction(async (tx) => {
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
      const refusal = await approvals.requestApproval({
        tx,
        actor,
        procedure: PROCEDURE,
        input: { id: "n1", consequences: ["money"], amount: 40 },
        preview: { summary: "Erase note n1 of Roscoff Voile." },
        consequences: ["money"],
        facts: { id: "n1", amount: 40, recipient: null },
        scope: { domain: "categories", level: "write", role: "delete" },
        // The same request exactly: only its revision moves.
        bindingHash: page.bindingHash ?? "",
        urls: ports.urls,
        presented: null,
      });
      assert.equal(refusal.data?.code, "APPROVAL_REQUIRED");
      repeated?.();
      await held;
    });
    await repeatedNow;
    const click = failure(decide(asked.approval.id, "approve", { revision: page.revision }));
    await lockWait("%`stores`%for update%");
    release();
    await repeat;
    const refusal = await click;
    assert.equal(refusal.details.reason, "changed");
    const row = await rowOf(asked.approval.id);
    assert.equal(row.status, "pending");
    assert.equal(row.revision, page.revision + 1);
    assert.equal(row.bindingHash, page.bindingHash);
    assert.equal(row.decision, null);
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

  test("a revoked connection ends its approvals, pending and approved; a decision racing it leaves it ended", async () => {
    const key = await apiKey();
    const pending = await ask({ id: "n1" }, key);
    const approved = await ask({ id: "n2" }, key);
    await decide(approved.approval.id, "approve");
    const racing = await ask({ id: "n3" }, key);
    const other = await apiKey();
    const untouched = await ask({ id: "n1" }, other);

    await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
    const [decision] = await Promise.allSettled([
      decide(racing.approval.id, "approve"),
      handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }),
    ]);
    for (const id of [pending.approval.id, approved.approval.id, racing.approval.id]) {
      const row = await rowOf(id);
      assert.equal(row.status, "failed", id);
      assert.equal(row.failureCode, "connection_revoked", id);
      assert.equal(row.activeSlot, null, id);
    }
    assert.equal((await rowOf(approved.approval.id)).decision, "approved", "its decision stays");
    if (decision?.status === "fulfilled") {
      assert.equal((await rowOf(racing.approval.id)).decision, "approved");
    }
    assert.equal((await rowOf(untouched.approval.id)).status, "pending", "another key's stays");
    // The revoked key no longer authenticates: its approval cannot be presented.
    const revoked = await failure(
      erase({ id: "n2" }, key.context({ "louez-confirmation": approved.approval.id })),
    );
    assert.equal(revoked.code, "UNAUTHENTICATED");
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
});
