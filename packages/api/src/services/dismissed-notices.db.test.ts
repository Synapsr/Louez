import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A notice closed for good is kept on the user's row: closes merge, and two
// closes at once keep both.

const USER = "dn_user_000000000001";

describe("dismissed notices (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let service: typeof import("./dismissed-notices");

  before(async () => {
    database = await createTestDatabase("api_dismissed_notices");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    service = await import("./dismissed-notices");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.users);
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "user@dn.test" });
  });

  async function stored() {
    const [row] = await louezDb.db
      .select({ dismissedNotices: louezDb.users.dismissedNotices })
      .from(louezDb.users)
      .where(orm.eq(louezDb.users.id, USER));
    return row?.dismissedNotices;
  }

  test("a close is added to the ones before, once", async () => {
    await service.dismissNotice({ userId: USER, noticeId: "reeent-cohort-seats" });
    const after = await service.dismissNotice({ userId: USER, noticeId: "agent-assistant" });
    assert.deepEqual(after, ["reeent-cohort-seats", "agent-assistant"]);

    const again = await service.dismissNotice({ userId: USER, noticeId: "agent-assistant" });
    assert.deepEqual(again, ["reeent-cohort-seats", "agent-assistant"]);
    assert.deepEqual(await stored(), ["reeent-cohort-seats", "agent-assistant"]);
  });

  test("an id retired since is dropped on the next close", async () => {
    await louezDb.db
      .update(louezDb.users)
      .set({ dismissedNotices: ["retired-notice"] })
      .where(orm.eq(louezDb.users.id, USER));
    await service.dismissNotice({ userId: USER, noticeId: "agent-assistant" });
    assert.deepEqual(await stored(), ["agent-assistant"]);
  });

  test("two closes at once keep both", async () => {
    await raceOnLockedRow<unknown>(database, { table: "users", id: USER }, [
      () => service.dismissNotice({ userId: USER, noticeId: "agent-assistant" }),
      () => service.dismissNotice({ userId: USER, noticeId: "reeent-cohort-member" }),
    ]);
    assert.deepEqual([...((await stored()) ?? [])].sort(), [
      "agent-assistant",
      "reeent-cohort-member",
    ]);
  });
});
