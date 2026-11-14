import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { StripeConnectClient } from "../../adapters/stripe-connect";
import type { BaseContext } from "../../context";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "approval-unchanged-test-secret";
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
          return id ? { user: { id, email: `${id}@au.test` } } : null;
        },
      },
    },
  },
});

// What a person's approval must leave as it is, through the procedures and
// on the database: the confirmation token, at the caller's level and at a
// person's level whose consequence is not live, through the transport
// tests' fixture and real procedures; and the hand-offs that exist, an
// invitation's approval and a Stripe step, read, decided and revoked.

const OWNER = "au_owner_user_000001";
const STORE = "au_store_a_000000001";
const CATEGORY = "au_category_00000001";

/** A Stripe client whose onboarding link always opens. */
const stripe: StripeConnectClient = {
  accounts: {
    create: async () => ({ id: "acct_au_1" }),
    retrieve: async () => ({
      type: "standard",
      country: "FR",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: [], eventually_due: [], past_due: [] },
    }),
    createLoginLink: async () => ({ url: "https://connect.stripe.test/express/login" }),
  },
  accountLinks: {
    create: async (params) => ({ url: `https://connect.stripe.test/setup/${params.account}` }),
  },
};

describe(
  "what a person's approval leaves unchanged (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orpc: typeof import("@orpc/server");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("../../services/api-keys");
    let handoffs: typeof import("../../services/handoffs");
    let routers: {
      settings: typeof import("./settings").dashboardSettingsRouter;
      categories: typeof import("./categories").dashboardCategoriesRouter;
      team: typeof import("./team").dashboardTeamRouter;
      payments: typeof import("./payments").dashboardPaymentsRouter;
      handoffs: typeof import("./handoffs").dashboardHandoffsRouter;
      fixture: ReturnType<typeof import("../../platform/testing").createFixtureRouter>["fixture"];
    };

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
      stripeConnect: () => stripe,
      team: { collaboratorLimit: async () => 10, emailConfigured: () => true },
    };

    before(async () => {
      database = await createTestDatabase("api_approval_unchanged");
      louezDb = await import("@louez/db");
      orpc = await import("@orpc/server");
      orm = await import("drizzle-orm");
      apiKeys = await import("../../services/api-keys");
      handoffs = await import("../../services/handoffs");
      routers = {
        settings: (await import("./settings")).dashboardSettingsRouter,
        categories: (await import("./categories")).dashboardCategoriesRouter,
        team: (await import("./team")).dashboardTeamRouter,
        payments: (await import("./payments")).dashboardPaymentsRouter,
        handoffs: (await import("./handoffs")).dashboardHandoffsRouter,
        fixture: (await import("../../platform/testing")).createFixtureRouter().fixture,
      };
      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@au.test" });
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
        louezDb.apiEffects,
        louezDb.apiRateLimits,
        louezDb.storeInvitations,
        louezDb.categories,
        louezDb.storeMembers,
        louezDb.stores,
      ]) {
        await db.delete(table);
      }
      await db.insert(louezDb.stores).values({
        id: STORE,
        userId: OWNER,
        name: "Morlaix Kayak",
        slug: "au-morlaix",
        email: "store@au.test",
        settings: { reservationMode: "payment", currency: "EUR", country: "FR" },
        onboardingCompleted: true,
      });
      await db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: OWNER, role: "owner" });
      await db.insert(louezDb.categories).values({ id: CATEGORY, storeId: STORE, name: "Kayaks" });
    });

    type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
    const rights: Permissions = {
      reservations: "read",
      products: "read",
      customers: "read",
      categories: "write",
      payments: "read",
      analytics: "read",
      settings: "write",
      team: "write",
    };

    /** An API key of the owner on the store; `confirm: false` turns its confirmations off. */
    async function apiKey(confirm = true) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Store agent",
        permissions: rights,
      });
      if (!confirm) {
        await apiKeys.setApiKeyConfirmation({
          db: louezDb.db,
          storeId: STORE,
          keyId: created.id,
          confirmSensitive: false,
        });
      }
      const context = (headers: Record<string, string> = {}): BaseContext => ({
        headers: new Headers({ authorization: `Bearer ${created.key}`, ...headers }),
        transport: "mcp",
        ports,
        receipt: {},
      });
      return { id: created.id, context };
    }

    const session = (): BaseContext => ({
      headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
      transport: "rpc",
      ports,
      receipt: {},
    });

    /** A procedure, called as its transport would, with its full path. */
    function call<T>(procedure: unknown, input: unknown, context: BaseContext, path: string[]) {
      return orpc.call(procedure as Parameters<typeof orpc.call>[0], input, {
        context,
        path,
      }) as Promise<T>;
    }

    /** The error a call fails with: its code and details. */
    async function failure(promise: Promise<unknown>) {
      try {
        await promise;
      } catch (error) {
        const data = (error as { data?: { code?: string; details?: Record<string, unknown> } })
          .data;
        return { code: data?.code, details: data?.details ?? {} };
      }
      assert.fail("the call succeeded");
    }

    const handoffRows = () => louezDb.db.select().from(louezDb.apiHandoffs);
    const operations = (procedure: string) =>
      louezDb.db
        .select()
        .from(louezDb.apiOperations)
        .where(orm.eq(louezDb.apiOperations.procedure, procedure));

    /**
     * The token's flow, as every place that asks runs it: the first call does
     * nothing and answers CONFIRMATION_REQUIRED with a token; the same input
     * with the token goes through once; the token again fails. The refused
     * call is recorded failed, so its key runs again. No hand-off is written.
     * `again` is the call the spent token is tried on (the same by default):
     * one whose write leaves nothing to confirm on the same input tries another.
     */
    async function tokenFlow(input: {
      run: (context: BaseContext) => Promise<unknown>;
      again?: (context: BaseContext) => Promise<unknown>;
      context: (headers?: Record<string, string>) => BaseContext;
      procedure: string;
    }) {
      const asked = await failure(input.run(input.context({ "idempotency-key": "k-1" })));
      assert.equal(asked.code, "CONFIRMATION_REQUIRED");
      const token = String(asked.details.confirmationToken);
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(asked.details.preview);
      const [refused] = await operations(input.procedure);
      assert.equal(refused?.status, "failed");
      assert.equal(refused?.error?.code, "CONFIRMATION_REQUIRED");

      const done = await input.run(
        input.context({ "idempotency-key": "k-1", "louez-confirmation": token }),
      );
      assert.ok(done);
      const [succeeded] = await operations(input.procedure);
      assert.equal(succeeded?.status, "succeeded", "the refused key ran again");

      const again = await failure(
        (input.again ?? input.run)(
          input.context({ "idempotency-key": "k-2", "louez-confirmation": token }),
        ),
      );
      assert.equal(again.code, "CONFIRMATION_INVALID", "a token works once");
      assert.deepEqual(await handoffRows(), [], "a confirmation writes no hand-off");
    }

    // --- The confirmation token -------------------------------------------------

    test("the caller's level (a change): a real procedure asks for the token, which works once", async () => {
      const key = await apiKey();
      await tokenFlow({
        context: key.context,
        procedure: "dashboard.settings.updateTaxes",
        run: (context) =>
          call(routers.settings.updateTaxes, { enabled: true, defaultRate: 5.5 }, context, [
            "dashboard",
            "settings",
            "updateTaxes",
          ]),
        // Once saved, the same input changes nothing, so it asks nothing.
        again: (context) =>
          call(routers.settings.updateTaxes, { defaultRate: 10 }, context, [
            "dashboard",
            "settings",
            "updateTaxes",
          ]),
      });
    });

    test("a person's level not live (a deletion): a real procedure asks for the token; option off, it runs directly", async () => {
      const key = await apiKey();
      await tokenFlow({
        context: key.context,
        procedure: "dashboard.categories.delete",
        run: (context) =>
          call(routers.categories.delete, { id: CATEGORY }, context, [
            "dashboard",
            "categories",
            "delete",
          ]),
        // The same category again, so the spent token is what refuses.
        again: async (context) => {
          await louezDb.db
            .insert(louezDb.categories)
            .values({ id: CATEGORY, storeId: STORE, name: "Kayaks" });
          return call(routers.categories.delete, { id: CATEGORY }, context, [
            "dashboard",
            "categories",
            "delete",
          ]);
        },
      });
      await louezDb.db.delete(louezDb.categories);

      await louezDb.db
        .insert(louezDb.categories)
        .values({ id: CATEGORY, storeId: STORE, name: "K" });
      const direct = await apiKey(false);
      await call(routers.categories.delete, { id: CATEGORY }, direct.context(), [
        "dashboard",
        "categories",
        "delete",
      ]);
      assert.deepEqual(await louezDb.db.select().from(louezDb.categories), []);
    });

    test("a person's level not live, through the fixture: the token, as before", async () => {
      const key = await apiKey();
      await tokenFlow({
        context: key.context,
        procedure: "fixture.notes.remove",
        run: (context) =>
          call(routers.fixture.notes.remove, { id: "n1" }, context, ["fixture", "notes", "remove"]),
      });
      const direct = await apiKey(false);
      const removed = await call<{ removed: boolean }>(
        routers.fixture.notes.remove,
        { id: "n2" },
        direct.context(),
        ["fixture", "notes", "remove"],
      );
      assert.equal(removed.removed, true, "option off, a deletion runs directly");
    });

    test("a person's level not live, through the fixture's erase: the token, as before", async () => {
      // A note that is there, for an erase that writes once it may.
      await louezDb.db
        .insert(louezDb.categories)
        .values({ id: "au_note_000000000001", storeId: STORE, name: "Note" });
      const key = await apiKey();
      const run = (context: BaseContext) =>
        call<{ erased: boolean }>(
          routers.fixture.notes.erase,
          { id: "au_note_000000000001", consequences: ["money"], amount: 40 },
          context,
          ["fixture", "notes", "erase"],
        );
      await tokenFlow({ context: key.context, procedure: "fixture.notes.erase", run });
    });

    test("a token-confirmed write replayed by its key answers what it stored and runs nothing again", async () => {
      // Through the fixture, which counts its runs.
      const key = await apiKey();
      const remove = (context: BaseContext) =>
        call<{ id: string; removed: boolean; runs: number }>(
          routers.fixture.notes.remove,
          { id: "n9" },
          context,
          ["fixture", "notes", "remove"],
        );
      const asked = await failure(remove(key.context({ "idempotency-key": "k-replay" })));
      const token = String(asked.details.confirmationToken);
      const confirmed = { "idempotency-key": "k-replay", "louez-confirmation": token };
      const first = await remove(key.context(confirmed));
      const replayContext = key.context(confirmed);
      const replayed = await remove(replayContext);
      assert.deepEqual(replayed, first, "the stored answer");
      assert.equal(replayContext.receipt?.replayed, true);
      // Without the token too: a replay reads no confirmation.
      assert.deepEqual(await remove(key.context({ "idempotency-key": "k-replay" })), first);
      const [operation] = await operations("fixture.notes.remove");
      assert.equal(operation?.status, "succeeded");
      assert.equal((await operations("fixture.notes.remove")).length, 1);

      // Through a real procedure: the category is gone, its answer is replayed.
      const path = ["dashboard", "categories", "delete"];
      const deleteCategory = (context: BaseContext) =>
        call<unknown>(routers.categories.delete, { id: CATEGORY }, context, path);
      const deleteAsked = await failure(deleteCategory(key.context({ "idempotency-key": "k-del" })));
      const deleteToken = String(deleteAsked.details.confirmationToken);
      const deleted = await deleteCategory(
        key.context({ "idempotency-key": "k-del", "louez-confirmation": deleteToken }),
      );
      assert.deepEqual(await louezDb.db.select().from(louezDb.categories), []);
      const again = key.context({ "idempotency-key": "k-del", "louez-confirmation": deleteToken });
      assert.deepEqual(await deleteCategory(again), deleted);
      assert.equal(again.receipt?.replayed, true);
      const [deleteOperation] = await operations("dashboard.categories.delete");
      assert.equal(deleteOperation?.status, "succeeded");
    });

    test("a session is never asked", async () => {
      await call(routers.categories.delete, { id: CATEGORY }, session(), [
        "dashboard",
        "categories",
        "delete",
      ]);
      assert.deepEqual(await louezDb.db.select().from(louezDb.apiConfirmations), []);
    });

    // --- The hand-offs that exist -------------------------------------------------

    const tokenOf = (url: string) => url.slice(`${TEST_APP_URL}/handoffs/`.length);
    const get = (id: string, context: BaseContext) =>
      call<{
        status: string;
        kind: string;
        decision: { outcome: string } | null;
        failure: { code: string } | null;
      }>(routers.handoffs.get, { id }, context, ["dashboard", "handoffs", "get"]);
    const invite = (email: string, context: BaseContext) =>
      call<{ approval: { url: string; handoff: { id: string } } | null }>(
        routers.team.invite,
        { email },
        context,
        ["dashboard", "team", "invite"],
      );
    const decide = async (id: string, decision: "approve" | "refuse") => {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id));
      assert.ok(row?.payload);
      return call<{ decision: string }>(
        routers.handoffs.decide,
        {
          id,
          decision,
          revision: row.revision,
          shown: handoffs.invitationShown(row.payload),
        },
        session(),
        ["dashboard", "handoffs", "decide"],
      );
    };

    test("an invitation's approval: read by the agent, refused by the owner, and revoked with its key", async () => {
      const key = await apiKey();
      const refused = await invite("refused@au.test", key.context());
      const waiting = await invite("waiting@au.test", key.context());
      const refusedId = tokenOf(refused.approval?.url ?? "");
      const waitingId = tokenOf(waiting.approval?.url ?? "");
      assert.equal(refused.approval?.handoff.id, refusedId);

      const read = await get(waitingId, key.context());
      assert.equal(read.kind, "team_invitation");
      assert.equal(read.status, "pending");
      assert.equal(read.decision, null);

      assert.equal((await decide(refusedId, "refuse")).decision, "refused");
      const decided = await get(refusedId, key.context());
      assert.equal(decided.status, "failed");
      assert.equal(decided.failure?.code, "declined");
      assert.equal(decided.decision?.outcome, "refused");

      await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
      await handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
      const rows = new Map((await handoffRows()).map((row) => [row.id, row]));
      assert.equal(rows.get(waitingId)?.status, "failed");
      assert.equal(rows.get(waitingId)?.failureCode, "connection_revoked");
      assert.equal(rows.get(waitingId)?.activeSlot, null);
      assert.equal(rows.get(refusedId)?.failureCode, "declined", "a decided step keeps its end");
      assert.equal(rows.get(refusedId)?.decision, "refused");
    });

    test("an invitation's approval approved by the owner sends the invitation", async () => {
      const key = await apiKey();
      const asked = await invite("approved@au.test", key.context());
      const id = tokenOf(asked.approval?.url ?? "");
      assert.equal((await decide(id, "approve")).decision, "approved");
      const read = await get(id, key.context());
      assert.equal(read.status, "completed");
      assert.equal(read.decision?.outcome, "approved");
      const invitations = await louezDb.db.select().from(louezDb.storeInvitations);
      assert.equal(invitations.length, 1);
    });

    test("a Stripe step: read by the agent, continued by the owner, and revoked with its key", async () => {
      const key = await apiKey();
      const started = await call<{ url: string; handoff: { id: string } }>(
        routers.payments.startStripeOnboarding,
        {},
        key.context(),
        ["dashboard", "payments", "startStripeOnboarding"],
      );
      const id = started.handoff.id;
      assert.equal((await get(id, key.context())).status, "pending");
      const [row] = await handoffRows();
      assert.ok(row);
      const continued = await handoffs.continueHandoff(id, OWNER, row.revision);
      assert.ok(continued.ok && continued.state, "the owner continues to Stripe");
      assert.equal((await get(id, key.context())).status, "opened");

      await apiKeys.revokeApiKey({ db: louezDb.db, storeId: STORE, keyId: key.id });
      await handoffs.failCredentialHandoffs({ kind: "api_key", id: key.id }, [STORE]);
      const [revoked] = await handoffRows();
      assert.equal(revoked?.status, "failed");
      assert.equal(revoked?.failureCode, "connection_revoked");
      const page = await handoffs.readHandoffLink(id, OWNER);
      assert.equal(page.ok, false);
      assert.equal(page.ok === false && page.reason, "finished");
    });
  },
);
