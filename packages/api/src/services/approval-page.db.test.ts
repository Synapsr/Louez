import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { BaseContext } from "../context";

import { createMemoryStorage } from "../platform/memory-storage";
import { createTestNewStores } from "../platform/test-new-stores";
import { createTestUrls } from "../platform/test-urls";

process.env.AUTH_SECRET ??= "approval-page-test-secret";
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
    verifyMcpAccessToken: async () => null,
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@page.test` } } : null;
        },
      },
    },
  },
});

// What the page of an operation's approval shows its approver, and to whom:
// `readApprovalPage` on a migrated database. Requests go through the
// transport tests' fixture (`fixture.notes.erase`, `money` live for it
// alone), so the preview read is the one Louez stored; the states a request
// reaches later are written on its row as the code that ends it writes them.
// Reading changes nothing, and runs no procedure.

const OWNER = "pg_owner_user_000001";
const CO_OWNER = "pg_coowner_user_0001";
const STRANGER = "pg_stranger_user_001";
const STORE = "pg_store_a_000000001";
const CLIENT = "https://claude.pg.test/oauth/client.json";
const PROCEDURE = ["fixture", "notes", "erase"];

describe("an approval's page, as its reader shows it (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("./api-keys");
  let grants: typeof import("./agent-grants");
  let page: typeof import("./approval-page");
  let decideHandoff: typeof import("./handoff-decisions").decideHandoff;
  let live: ReturnType<typeof import("../platform/testing").createFixtureRouter>["fixture"]["notes"];

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
    database = await createTestDatabase("api_approval_page");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("./api-keys");
    grants = await import("./agent-grants");
    page = await import("./approval-page");
    decideHandoff = (await import("./handoff-decisions")).decideHandoff;
    live = (await import("../platform/testing")).createFixtureRouter({ liveConsequences: ["money"] })
      .fixture.notes;
    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@page.test", name: "Olga Owner" },
      { id: CO_OWNER, email: "coowner@page.test", name: "Corentin Coowner" },
      { id: STRANGER, email: "stranger@page.test", name: "Sven Stranger" },
    ]);
    await louezDb.db.insert(louezDb.oauthClients).values({
      clientId: CLIENT,
      name: "Claude",
      uri: "https://claude.pg.test",
      clientDiscoveryId: "cimd",
      redirectUris: JSON.stringify(["https://client.pg.test/callback"]),
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
      louezDb.apiKeys,
      louezDb.apiAgentGrants,
      louezDb.apiRateLimits,
      louezDb.categories,
      louezDb.storeMembers,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Roscoff Voile",
      slug: "pg-roscoff",
      onboardingCompleted: true,
    });
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: CO_OWNER, role: "owner" },
      { storeId: STORE, userId: STRANGER, role: "owner" },
    ]);
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const rights: Permissions = {
    reservations: "none",
    products: "none",
    customers: "none",
    categories: "write",
    payments: "none",
    analytics: "none",
    settings: "none",
    team: "none",
  };

  /** An API key of `userId` on the store, and the context its calls carry. */
  async function apiKey(userId = OWNER, name = "Store agent") {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId,
      name,
      permissions: rights,
    });
    return {
      id: created.id,
      context: (): BaseContext => ({
        headers: new Headers({ authorization: `Bearer ${created.key}` }),
        transport: "mcp",
        ports,
        receipt: {},
      }),
    };
  }

  /** The agent asks to erase a note: the call must answer APPROVAL_REQUIRED; the approval's id. */
  async function ask(
    key: Awaited<ReturnType<typeof apiKey>>,
    input: { id?: string; amount?: number; note?: string } = {},
  ): Promise<string> {
    const id = input.id ?? "n1";
    await louezDb.db
      .insert(louezDb.categories)
      .values({ id, storeId: STORE, name: `Note ${id}` })
      .onDuplicateKeyUpdate({ set: { name: `Note ${id}` } });
    try {
      await orpc.call(
        live.erase,
        { id, consequences: ["money"], amount: input.amount ?? 40, note: input.note },
        { context: key.context(), path: PROCEDURE },
      );
    } catch (error) {
      const data = (error as { data?: { code?: string; details?: { approval?: { id: string } } } })
        .data;
      assert.equal(data?.code, "APPROVAL_REQUIRED");
      assert.ok(data?.details?.approval);
      return data.details.approval.id;
    }
    assert.fail("the call was not refused");
  }

  const rowOf = async (id: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, id));
    assert.ok(row, `approval ${id}`);
    return row;
  };

  const setRow = (id: string, values: Partial<typeof louezDb.apiHandoffs.$inferInsert>) =>
    louezDb.db.update(louezDb.apiHandoffs).set(values).where(orm.eq(louezDb.apiHandoffs.id, id));

  /** The approver's page; it must be readable. */
  async function read(id: string, userId = OWNER) {
    const answer = await page.readApprovalPage(id, userId);
    assert.ok(answer.ok, `readable, got ${JSON.stringify(answer)}`);
    return answer.approval;
  }

  const hourAgo = () => new Date(Date.now() - 3_600_000);

  // --- The approver's page ----------------------------------------------------

  test("the approver reads the preview Louez stored, when it was computed, what is at stake and what to post", async () => {
    const key = await apiKey();
    const id = await ask(key);
    const row = await rowOf(id);
    const approval = await read(id);

    assert.equal(approval.state, "pending");
    assert.deepEqual(approval.preview, {
      summary: "Erase note n1 of Roscoff Voile.",
      details: [
        { label: "Id", value: { kind: "text", text: "n1" } },
        { label: "Amount", value: { kind: "text", text: "40" } },
      ],
    });
    assert.deepEqual(approval.consequences, ["money"]);
    assert.equal(approval.deliberate, true);
    assert.equal(approval.computedAt.getTime(), row.linkIssuedAt.getTime());
    assert.equal(approval.expiresAt.getTime(), row.expiresAt.getTime());
    assert.ok(approval.now.getTime() >= row.linkIssuedAt.getTime());
    assert.equal(approval.revision, row.revision);
    assert.equal(approval.binding, row.bindingHash);
    assert.deepEqual(approval.store, { id: STORE, name: "Roscoff Voile" });
    assert.deepEqual(approval.agent, { kind: "api_key", name: "Store agent" });
    assert.equal(approval.decision, null);
  });

  test("reading writes nothing: no operation, the row as it was", async () => {
    const id = await ask(await apiKey());
    const before = await rowOf(id);
    const operations = await louezDb.db.select().from(louezDb.apiOperations);
    await read(id);
    await page.readApprovalPage(id, STRANGER);
    assert.deepEqual(await rowOf(id), before);
    assert.deepEqual(await louezDb.db.select().from(louezDb.apiOperations), operations);
  });

  test("an assistant connected over OAuth is named as the consent page names its client", async () => {
    const id = await ask(await apiKey());
    const grant = await grants.saveGrant({
      userId: OWNER,
      clientId: CLIENT,
      terms: {
        stores: { all: false, ids: [STORE] },
        preset: "write",
        confirmSensitive: true,
        bundles: ["catalog"],
      },
    });
    await setRow(id, { credentialKind: "oauth", credentialId: grant.id, clientName: "Claude" });
    const approval = await read(id);
    assert.equal(approval.agent.kind, "oauth");
    assert.equal(approval.agent.name, "Claude");
    assert.equal(approval.agent.kind === "oauth" ? approval.agent.client?.name : null, "Claude");
    assert.equal(
      approval.agent.kind === "oauth" ? approval.agent.client?.declaredBy : null,
      "claude.pg.test",
    );
  });

  // --- Who reads it -----------------------------------------------------------

  test("another user, an unknown id and another kind's id learn nothing", async () => {
    const id = await ask(await apiKey());
    assert.deepEqual(await page.readApprovalPage(id, STRANGER), { ok: false, reason: "other_user" });
    // Ended or not, another user is told the same.
    await setRow(id, { status: "failed", failureCode: "declined", activeSlot: null });
    assert.deepEqual(await page.readApprovalPage(id, STRANGER), { ok: false, reason: "other_user" });
    assert.deepEqual(await page.readApprovalPage("x".repeat(21), OWNER), {
      ok: false,
      reason: "invalid",
    });
    assert.deepEqual(await page.readApprovalPage(`${id}${"y".repeat(43)}`, OWNER), {
      ok: false,
      reason: "invalid",
    });
    await setRow(id, { kind: "team_invitation" });
    assert.deepEqual(await page.readApprovalPage(id, OWNER), { ok: false, reason: "invalid" });
  });

  test("a requester who lost the right, or left the store, reads nothing of the request", async () => {
    const id = await ask(await apiKey(CO_OWNER));
    assert.equal((await read(id, CO_OWNER)).state, "pending");
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "member" })
      .where(orm.eq(louezDb.storeMembers.userId, CO_OWNER));
    assert.deepEqual(await page.readApprovalPage(id, CO_OWNER), {
      ok: false,
      reason: "not_allowed",
    });
    await louezDb.db.delete(louezDb.storeMembers).where(orm.eq(louezDb.storeMembers.userId, CO_OWNER));
    assert.deepEqual(await page.readApprovalPage(id, CO_OWNER), {
      ok: false,
      reason: "not_allowed",
    });
  });

  test("a request whose connection is gone is inert, as its row says or not", async () => {
    const key = await apiKey();
    const id = await ask(key);
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ revokedAt: new Date() })
      .where(orm.eq(louezDb.apiKeys.id, key.id));
    // The cleanup has not run: the row still says pending.
    const pending = await read(id);
    assert.equal(pending.state, "connection_revoked");
    assert.equal(pending.binding, null);
    // Approved, then the key revoked: never carried out.
    await setRow(id, { status: "approved", decision: "approved", decidedAt: new Date() });
    assert.equal((await read(id)).state, "connection_revoked");
    // Once ended, its end is what it shows, the connection gone or not.
    await setRow(id, { status: "completed", completedAt: new Date(), activeSlot: null });
    assert.equal((await read(id)).state, "completed");
  });

  // --- Each state, as its row says --------------------------------------------

  test("every state a request reaches reads as its row says, with the decision as written", async () => {
    const key = await apiKey();
    const id = await ask(key);
    const decidedAt = new Date(Date.now() - 60_000);
    const ends: Array<[Partial<typeof louezDb.apiHandoffs.$inferInsert>, string]> = [
      [
        {
          status: "approved",
          decision: "approved",
          decidedAt,
          decidedByUserId: OWNER,
          expiresAt: new Date(Date.now() + 3_000_000),
        },
        "approved",
      ],
      [{ status: "approved", decision: "approved", decidedAt, expiresAt: hourAgo() }, "approved_expired"],
      [
        { status: "completed", completedAt: new Date(), activeSlot: null, decision: "approved" },
        "completed",
      ],
      [
        {
          status: "failed",
          failureCode: "declined",
          decision: "refused",
          decisionReason: "Pas ce client",
          activeSlot: null,
        },
        "refused",
      ],
      [{ status: "failed", failureCode: "state_changed", decision: "approved" }, "state_changed"],
      [
        { status: "failed", failureCode: "approver_not_allowed", decision: "approved" },
        "approver_not_allowed",
      ],
      [{ status: "failed", failureCode: "connection_revoked", decision: null }, "connection_revoked"],
      [{ status: "failed", failureCode: "something_else", decision: null }, "ended"],
      [{ status: "pending", decision: null, expiresAt: hourAgo() }, "expired"],
    ];
    for (const [values, state] of ends) {
      await setRow(id, { failureCode: null, decisionReason: null, ...values });
      const approval = await read(id);
      assert.equal(approval.state, state, JSON.stringify(values));
      // Nothing to post once it is no longer decidable.
      assert.equal(approval.binding, null, state);
      assert.equal(approval.preview?.summary, "Erase note n1 of Roscoff Voile.", state);
    }
    await setRow(id, {
      status: "failed",
      failureCode: "declined",
      decision: "refused",
      decidedAt,
      decisionReason: "Pas ce client",
    });
    const refused = await read(id);
    assert.deepEqual(refused.decision, { outcome: "refused", at: refused.decision?.at, reason: "Pas ce client" });
    assert.equal(refused.decision?.at.getTime(), (await rowOf(id)).decidedAt?.getTime());
  });

  // --- What the preview may hold ---------------------------------------------

  test("the preview is text whatever it holds: markup stays characters, controls and reordering marks go", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    await setRow(id, {
      payload: {
        ...payload,
        preview: {
          summary:
            "Record 40.00 ‮00.04‬ EUR for <b>Ann</b> [click](https://evil.test)\u0007\r\nthen stop.",
          details: {
            customerName: "⁧שרה⁩ <img src=x onerror=alert(1)>",
            amount_paid: 40.5,
            refunded: false,
            sent: true,
            note: null,
            lines: [{ productName: "Kayak", available: 0 }],
            deep: { a: { b: { c: { d: "deepest" } } } },
          },
        },
      },
    });
    const { preview } = await read(id);
    assert.ok(preview);
    assert.equal(
      preview.summary,
      "Record 40.00 00.04 EUR for <b>Ann</b> [click](https://evil.test)\nthen stop.",
    );
    // MySQL keeps a JSON object's keys in its own order (by length): the
    // details read back in that order, whatever order the procedure wrote.
    const byLabel = <T extends { label: string }>(entries: T[]) =>
      [...entries].sort((a, b) => a.label.localeCompare(b.label));
    assert.deepEqual(byLabel(preview.details), byLabel([
      { label: "Customer name", value: { kind: "text", text: "שרה <img src=x onerror=alert(1)>" } },
      { label: "Amount paid", value: { kind: "text", text: "40.5" } },
      { label: "Refunded", value: { kind: "no" } },
      { label: "Sent", value: { kind: "yes" } },
      { label: "Note", value: { kind: "none" } },
      {
        label: "Lines",
        value: {
          kind: "list",
          entries: [
            {
              label: "1",
              value: {
                kind: "list",
                entries: [
                  { label: "Available", value: { kind: "text", text: "0" } },
                  { label: "Product name", value: { kind: "text", text: "Kayak" } },
                ],
              },
            },
          ],
        },
      },
      {
        label: "Deep",
        value: {
          kind: "list",
          entries: [
            {
              label: "A",
              value: {
                kind: "list",
                entries: [
                  {
                    label: "B",
                    value: {
                      kind: "list",
                      entries: [{ label: "C", value: { kind: "text", text: '{"d":"deepest"}' } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ]));
  });

  test("a preview of an unexpected or older shape: shown as far as it reads, never approvable without its sentence", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const withPreview = (preview: unknown, consequences: unknown = payload.consequences) =>
      setRow(id, { payload: { ...payload, preview, consequences } as never });

    await withPreview({ summary: "Erase it.", details: ["a", 2] });
    assert.deepEqual((await read(id)).preview?.details, [
      {
        label: "",
        value: {
          kind: "list",
          entries: [
            { label: "1", value: { kind: "text", text: "a" } },
            { label: "2", value: { kind: "text", text: "2" } },
          ],
        },
      },
    ]);
    await withPreview({ summary: "Erase it." });
    assert.deepEqual((await read(id)).preview, { summary: "Erase it.", details: [] });

    for (const unreadable of [null, "Erase it.", { details: {} }, { summary: 4 }, { summary: " ‮ " }]) {
      await withPreview(unreadable);
      const approval = await read(id);
      assert.equal(approval.state, "unreadable", JSON.stringify(unreadable));
      assert.equal(approval.preview, null);
      assert.equal(approval.binding, null);
    }

    // Consequences: those Louez does not know are left out; with none known, approving is deliberate.
    await withPreview({ summary: "Erase it." }, ["money", "teleport", "money"]);
    assert.deepEqual((await read(id)).consequences, ["money"]);
    await withPreview({ summary: "Erase it." }, ["teleport"]);
    assert.deepEqual((await read(id)).consequences, []);
    assert.equal((await read(id)).deliberate, true);
    await withPreview({ summary: "Erase it." }, undefined);
    assert.equal((await read(id)).deliberate, true);
    await withPreview({ summary: "Rename it." }, ["change"]);
    assert.equal((await read(id)).deliberate, false);
  });

  // --- The page after the agent asked again ----------------------------------

  test("asked again while the page was open: the click decides nothing, and the page shows the request as it is now", async () => {
    const key = await apiKey();
    const id = await ask(key, { note: "first" });
    // Asked ten minutes ago.
    const tenMinutesAgo = new Date(Date.now() - 600_000);
    await setRow(id, { createdAt: tenMinutesAgo, linkIssuedAt: tenMinutesAgo });
    const shown = await read(id);
    assert.equal(shown.computedAt.getTime(), tenMinutesAgo.getTime());
    // The store moved, and the agent asks again: the same request, a new preview.
    await louezDb.db
      .update(louezDb.stores)
      .set({ name: "Roscoff Voile et Kayak" })
      .where(orm.eq(louezDb.stores.id, STORE));
    assert.equal(await ask(key, { note: "second" }), id);

    await assert.rejects(
      decideHandoff(
        {
          id,
          decision: "approve",
          revision: shown.revision,
          shown: shown.binding ?? "",
          userId: OWNER,
        },
        ports,
      ),
      (error: { data?: { code?: string; details?: { reason?: string } } }) =>
        error.data?.code === "HANDOFF_DECISION_INVALID" && error.data.details?.reason === "changed",
    );
    assert.equal((await rowOf(id)).status, "pending");

    const now = await read(id);
    assert.equal(now.state, "pending");
    assert.equal(now.revision, shown.revision + 1);
    assert.notEqual(now.binding, shown.binding);
    assert.equal(now.preview?.summary, "Erase note n1 of Roscoff Voile et Kayak.");
    // Computed when the agent asked again, not when it first asked.
    const asked = await rowOf(id);
    assert.equal(now.computedAt.getTime(), asked.linkIssuedAt.getTime());
    assert.ok(now.computedAt.getTime() > asked.createdAt.getTime());

    // The page's new revision and binding decide it.
    await decideHandoff(
      { id, decision: "approve", revision: now.revision, shown: now.binding ?? "", userId: OWNER },
      ports,
    );
    assert.equal((await read(id)).state, "approved");
  });
});
