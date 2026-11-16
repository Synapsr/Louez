import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { WRITE_SAMPLES_FLAG } from "./approvals-guard";

// The "needs a look" sample script on a migrated database: run as its command
// runs it, it leaves one item of each money kind and a message not sent in
// the store's inbox, and prints the page's URL; it refuses anyone but an owner.

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
});
