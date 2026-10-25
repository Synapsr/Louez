import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Accepting an invitation on a migrated database. The store's billing snapshot
// lists its owners (louez-billing docs/api, StoreSnapshotV1.ownerUserIds), so only
// an owner invitation marks the store; a member changes nothing there.

const STORE = "store_inv_marks";
const INVITER = "user_inv_inviter";
let currentUserId = "";

// The session and the active-store cookie are stubbed; the database is real.
const stubs = {
  "@/lib/auth": { auth: async () => ({ user: { id: currentUserId } }) },
  "@/lib/store-context": { setActiveStoreId: async () => ({ success: true }) },
};
Reflect.set(globalThis, "__louezInvitationActionStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-invitation-actions-"));
after(() => rmSync(directory, { recursive: true }));
const fixtures = new Map(
  Object.keys(stubs).map((specifier, index) => {
    const path = join(directory, `stub-${index}.cjs`);
    writeFileSync(
      path,
      `module.exports = globalThis.__louezInvitationActionStubs[${JSON.stringify(specifier)}];`,
    );
    return [specifier, pathToFileURL(path).href];
  }),
);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const url = fixtures.get(specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

describe("invitation billing marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("invitation_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    await louezDb.db.insert(louezDb.users).values({ id: INVITER, email: "owner@example.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: INVITER,
      name: "Invitation marks",
      slug: "invitation-marks",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.billingSyncQueue);
  });

  /** A signed-in user with a pending invitation; returns its token. */
  async function invite(role: "owner" | "member"): Promise<string> {
    const n = ++counter;
    currentUserId = `user_invited_${n}`;
    const email = `invited-${n}@example.test`;
    await louezDb.db.insert(louezDb.users).values({ id: currentUserId, email });
    const token = `token_invitation_marks_${n}`;
    await louezDb.db.insert(louezDb.storeInvitations).values({
      storeId: STORE,
      email,
      role,
      token,
      invitedBy: INVITER,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return token;
  }

  async function storeMarks() {
    const { billingSyncQueue: queueTable } = louezDb;
    return louezDb.db
      .select({ id: queueTable.aggregateId, version: queueTable.version })
      .from(queueTable)
      .where(eq(queueTable.aggregateType, "store"));
  }

  async function memberRole(userId: string) {
    const member = await louezDb.db.query.storeMembers.findFirst({
      where: (table) => and(eq(table.storeId, STORE), eq(table.userId, userId)),
      columns: { role: true },
    });
    return member?.role;
  }

  test("a member joins without a mark: the owner list is unchanged", async () => {
    const token = await invite("member");

    assert.deepEqual(await actions.acceptInvitation(token), { success: true });

    assert.equal(await memberRole(currentUserId), "member");
    assert.deepEqual(await storeMarks(), []);
  });

  test("an owner joins and the store is marked in the same transaction", async () => {
    const token = await invite("owner");

    assert.deepEqual(await actions.acceptInvitation(token), { success: true });

    assert.equal(await memberRole(currentUserId), "owner");
    assert.deepEqual(await storeMarks(), [{ id: STORE, version: 1 }]);
  });
});
