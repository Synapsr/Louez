import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { WRITE_SAMPLES_FLAG } from "./approvals-guard";

// The "needs a look" sample script on a migrated database: run as its command
// runs it, it leaves one item of each money kind and a message not sent in
// the store's inbox, and prints the page's URL; it refuses anyone but an owner.
// No worker ever takes its rows to a provider: the outbox's retry, the cron's
// pass over refunds and credit notes, the refund's sender and a reconciliation.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  mock.module(name, { namedExports: require(name) });
}

// The refund module imports "server-only"; its credit-note issuer never runs here.
type NextResolve = (specifier: string, context: object) => { url: string };
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(specifier: string, context: object, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});
mock.module("@/lib/invoicing/refund-credit-note", {
  namedExports: {
    issueRefundCreditNote: async () => {
      throw new Error("a sample credit note reached the issuer");
    },
  },
});

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OWNER = "nl_owner_user_000001";
const MEMBER = "nl_member_user_00001";
const STORE = "nl_store_a_000000001";

describe("the needs-a-look sample script (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let inbox: typeof import("@louez/api/services/inbox");
  let testUrls: typeof import("@louez/api/platform/test-urls");

  before(async () => {
    database = await createTestDatabase("seed_needs_a_look");
    louezDb = await import("@louez/db");
    inbox = await import("@louez/api/services/inbox");
    testUrls = await import("@louez/api/platform/test-urls");
    const { db } = louezDb;
    await db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@samples.test" },
      { id: MEMBER, email: "member@samples.test" },
    ]);
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Roscoff Voile",
      slug: "nl-roscoff",
      settings: { currency: "EUR", timezone: "Europe/Paris" } as never,
    });
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  function run(args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed/needs-a-look.ts", WRITE_SAMPLES_FLAG, ...args],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: database.url,
          SKIP_ENV_VALIDATION: "true",
          NODE_ENV: "development",
          NEXT_PUBLIC_APP_URL: "https://app.samples.test",
        },
      },
    );
  }

  async function inboxTypes() {
    const [store] = await louezDb.db.select().from(louezDb.stores);
    assert.ok(store);
    // Past the inbox's 30 seconds of hold-back, as the page reads it then.
    const now = new Date(Date.now() + 60_000);
    const { items } = await inbox.listInbox(
      {
        store,
        urls: testUrls.createTestUrls(),
        hostedBy: null,
        reads: { reservations: true, payments: true, customers: true },
        operationsOf: null,
      },
      {},
      { now },
    );
    return items;
  }

  test("a member who is not an owner is refused, and nothing is written", async () => {
    const result = run(["--email=member@samples.test", "--store=nl-roscoff"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an owner/);
    assert.deepEqual(await inboxTypes(), []);
  });

  test("the owner gets each money kind and a message not sent, and the page's URL", async () => {
    const result = run(["--email=owner@samples.test", "--store=nl-roscoff"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /https:\/\/app\.samples\.test\/dashboard\/inbox/);
    const items = await inboxTypes();
    assert.deepEqual(items.map((item) => item.type).sort(), [
      "credit_note_not_issued",
      "message_not_sent",
      "refund_unconfirmed",
      "refund_undone",
    ]);
    const undone = items.find((item) => item.type === "refund_undone");
    assert.match(String(undone?.details.creditNoteNumber), /^AV-SAMPLE-/);
    assert.equal(
      items.find((item) => item.type === "credit_note_not_issued")?.details.currency,
      "EUR",
    );
  });
  test("no worker takes a sample row to a provider, nor runs it again", async () => {
    const effects = await import("@louez/api/platform/effects");
    const refunds = await import("@/lib/reservations/stripe-refund");
    const calls: string[] = [];
    // Any provider call or any sender run is recorded, whatever its name.
    const recorder = <T extends object>(what: string) =>
      new Proxy({} as T, {
        get: (_target, name) => async () => {
          calls.push(`${what}.${String(name)}`);
          throw new Error(`${what}.${String(name)} was called`);
        },
      });
    const deps = {
      database: louezDb.db,
      stripe:
        recorder<import("@/lib/reservations/stripe-refund-stripe").StripeRefundPort>("stripe"),
      dispatchEffects: () => {},
    };
    const [operation] = await louezDb.db.select().from(louezDb.paymentRefundOperations);
    assert.ok(operation, "the sample refund operation");

    // The cron's pass: no new outbox row for the refund, no credit note armed again.
    assert.deepEqual(await refunds.requeueStaleRefundOperations(louezDb.db), []);
    assert.deepEqual(await effects.rearmAbandonedEffects(), []);
    // Two days on, past the day an abandoned debt waits: still never armed again.
    await louezDb.db
      .update(louezDb.apiEffects)
      .set({ nextAttemptAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(louezDb.apiEffects.type, "payment.refundCreditNote"));
    assert.deepEqual(await effects.rearmAbandonedEffects(), []);
    // The outbox's retry: none of the sample rows is due.
    await effects.retryDueEffects(recorder("sender"));
    // The refund's sender, and a reconciliation on read: busy, nobody called.
    await assert.rejects(
      refunds.sendRefundOperation(deps, operation.id, {
        assertClaim: async () => {},
        throwIfAborted: () => {},
      }),
      /being sent by another sender/,
    );
    await refunds.reconcileRefundOperation(deps, operation.id, 2_000);
    assert.deepEqual(calls, []);

    // Still in the inbox, as written.
    assert.equal((await inboxTypes()).length, 4);
  });
});
