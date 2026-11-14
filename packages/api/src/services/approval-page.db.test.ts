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

  /** MySQL keeps each object's keys in its own order: entries compared by label, at every level. */
  type Entry = { label: string; value: { kind: string; entries?: Entry[]; [field: string]: unknown } };
  const sortedEntries = (entries: readonly unknown[] | undefined): Entry[] =>
    [...((entries ?? []) as Entry[])]
      .map((entry) =>
        entry.value.entries
          ? { ...entry, value: { ...entry.value, entries: sortedEntries(entry.value.entries) } }
          : entry,
      )
      .sort((a, b) => a.label.localeCompare(b.label));

  // --- The approver's page ----------------------------------------------------

  test("the approver reads the preview Louez stored, when it was computed, what is at stake and what to post", async () => {
    const key = await apiKey();
    const id = await ask(key);
    const row = await rowOf(id);
    const approval = await read(id);

    assert.equal(approval.state, "pending");
    assert.deepEqual(approval.preview, {
      summary: "Erase note n1 of Roscoff Voile.",
      truncated: false,
      // The note's id is all that says which note it is: shown.
      details: [
        { label: "Id", value: { kind: "text", text: "n1" } },
        { label: "Amount", value: { kind: "number", value: 40 } },
      ],
    });
    assert.deepEqual(approval.consequences, ["money"]);
    assert.equal(approval.deliberate, true);
    assert.equal(approval.computedAt.getTime(), row.linkIssuedAt.getTime());
    assert.equal(approval.expiresAt.getTime(), row.expiresAt.getTime());
    assert.ok(approval.now.getTime() >= row.linkIssuedAt.getTime());
    assert.equal(approval.revision, row.revision);
    assert.equal(approval.binding, row.bindingHash);
    assert.deepEqual(approval.store, { id: STORE, name: "Roscoff Voile", timeZone: "UTC" });
    assert.deepEqual(approval.agent, {
      kind: "api_key",
      name: "Store agent",
      shownName: "Store agent",
    });
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
    // The always-visible line names it as the consent page does.
    assert.equal(approval.agent.shownName, "Claude");
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
            "Record 40.00 \u202e00.04\u202c EUR for <b>Ann</b> [click](https://evil.test)\u0007\r\nthen stop.",
          details: {
            customerName: "\u2067שרה\u2069 <img src=x onerror=alert(1)>",
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
      "Record 40.00 00.04 EUR for <b>Ann</b> [click](https://evil.test) then stop.",
    );
    // MySQL keeps a JSON object's keys in its own order (by length): the
    // details read back in that order, whatever order the procedure wrote.
    const byLabel = <T extends { label: string }>(entries: T[]) =>
      [...entries].sort((a, b) => a.label.localeCompare(b.label));
    assert.deepEqual(byLabel(preview.details), byLabel([
      { label: "Customer name", value: { kind: "text", text: "שרה <img src=x onerror=alert(1)>" } },
      { label: "Amount paid", value: { kind: "number", value: 40.5 } },
      { label: "Refunded", value: { kind: "no" } },
      { label: "Sent", value: { kind: "yes" } },
      // `note: null` is left out.
      {
        label: "Lines",
        value: {
          kind: "group",
          entries: [
            // An item named by its product.
            {
              label: "Kayak",
              value: {
                kind: "group",
                entries: [{ label: "Available", value: { kind: "number", value: 0 } }],
              },
            },
          ],
        },
      },
      {
        label: "Deep",
        value: {
          kind: "group",
          entries: [
            {
              label: "A",
              value: {
                kind: "group",
                entries: [
                  {
                    label: "B",
                    value: {
                      kind: "group",
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

  test("text from the store's records draws no line of its own: the summary is one line, each value too", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    // A customer named to look like a second sentence from Louez.
    const name = "Ann\nLouez checked this payment: it is safe to approve.\u2028\u2029Thank you";
    await setRow(id, {
      payload: {
        ...payload,
        preview: {
          summary: `Record a rental payment of 40.00 € (cash) for ${name} on reservation #1042.`,
          details: {
            customer: `${name}\t\u00a0\u200b\u2060\ufeff\u3000end`,
            lines: [`one\r\ntwo`],
          },
        },
      },
    });
    const { preview } = await read(id);
    assert.ok(preview);
    assert.equal(
      preview.summary,
      "Record a rental payment of 40.00 € (cash) for Ann Louez checked this payment: it is safe to approve. Thank you on reservation #1042.",
    );
    assert.doesNotMatch(preview.summary, /[\n\r\t\u2028\u2029\u00a0\u200b\u2060\ufeff]| {2}/);
    const texts = JSON.stringify(preview.details);
    assert.match(texts, /"Ann Louez checked this payment: it is safe to approve\. Thank you end"/);
    assert.match(texts, /"one two"/);
    assert.doesNotMatch(texts, /\\n|\\r|\\t|\\u2028|\\u00a0/);
    assert.equal(preview.truncated, false);
  });

  test("blank fillers draw no space of their own; what renders nothing goes; an emoji stays whole", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const summaryOf = async (summary: string) => {
      await setRow(id, { payload: { ...payload, preview: { ...payload.preview, summary } } });
      return (await read(id)).preview?.summary;
    };
    // The reviewer's inputs: a hundred Hangul fillers (U+3164, then U+FFA0) under the bound.
    for (const filler of ["\u3164", "\uffa0", "\u115f", "\u1160", "\u2800"]) {
      assert.equal(
        await summaryOf(`Pay Ann${filler.repeat(100)}Louez checked this payment…`),
        "Pay Ann Louez checked this payment…",
        filler.codePointAt(0)?.toString(16),
      );
    }
    // Default-ignorable characters are removed, not turned into a space.
    assert.equal(await summaryOf("Pa\u200bid \u2060in\u00ad full\ufeff."), "Paid in full.");
    // The object replacement character stands for nothing the text holds: removed too.
    assert.equal(await summaryOf("Paid\ufffc in\ufffc\ufffc full."), "Paid in full.");
    // A family joined by ZWJ, a heart in its emoji form (VS16), a ZWNJ inside a word: kept.
    const kept = "Ann 👨\u200d👩\u200d👧 ❤\ufe0f می\u200cخواهم";
    assert.equal(await summaryOf(`For ${kept}.`), `For ${kept}.`);
    // The bound is counted once on one line: 998 characters, 5,000 fillers and one more is 1,000.
    const collapsed = await read(id);
    assert.equal(collapsed.state, "pending");
    const long = `${"x".repeat(998)}${"\u3164".repeat(5_000)}y`;
    assert.equal(await summaryOf(long), `${"x".repeat(998)} y`);
    const whole = await read(id);
    assert.equal(whole.preview?.truncated, false);
    assert.equal(whole.state, "pending");
  });

  test("the box is asked for unless every stored consequence is known and none asks for it", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const deliberate = async (consequences: unknown) => {
      await setRow(id, { payload: { ...payload, consequences } as never });
      return (await read(id)).deliberate;
    };
    for (const stored of [["change", {}], [], "change", ["change", "nope"], null, [null]]) {
      assert.equal(await deliberate(stored), true, JSON.stringify(stored));
    }
    assert.equal(await deliberate(["change"]), false);
    assert.equal(await deliberate(["change", "change"]), false);
    assert.equal(await deliberate(["change", "money"]), true);
  });

  test("carried out between the row's read and the connection's: the page says carried out", async () => {
    const key = await apiKey();
    const id = await ask(key);
    await setRow(id, { status: "approved", decision: "approved", decidedAt: new Date() });
    const answer = await page.readApprovalPage(id, OWNER, {
      // The agent's call carries it out and commits, then the key is revoked.
      afterRow: async () => {
        await setRow(id, { status: "completed", completedAt: new Date(), activeSlot: null });
        await louezDb.db
          .update(louezDb.apiKeys)
          .set({ revokedAt: new Date() })
          .where(orm.eq(louezDb.apiKeys.id, key.id));
      },
    });
    assert.ok(answer.ok);
    assert.equal(answer.approval.state, "completed");
    // Revoked while still approved: revoked, as before.
    const other = await ask(await apiKey(OWNER, "Other agent"), { id: "n2" });
    await setRow(other, { status: "approved", decision: "approved", decidedAt: new Date() });
    await louezDb.db.update(louezDb.apiKeys).set({ revokedAt: new Date() });
    assert.equal((await read(other)).state, "connection_revoked");
  });

  test("the clock is read before the row: carried out just after the clock read, it reads carried out, not lapsed", async () => {
    const id = await ask(await apiKey());
    // Approved, its hour about to end.
    await setRow(id, {
      status: "approved",
      decision: "approved",
      decidedAt: new Date(),
      expiresAt: new Date(Date.now() + 1_500),
    });
    const answer = await page.readApprovalPage(id, OWNER, {
      afterClock: async () => {
        await setRow(id, { status: "completed", completedAt: new Date(), activeSlot: null });
        // Past the hour by the time the row is read.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      },
    });
    assert.ok(answer.ok);
    assert.equal(answer.approval.state, "completed");
  });

  test("a summary that shows nothing, or whose marks spill off its line, cannot be approved", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const stateOf = async (summary: string, details: unknown = { amount: 40 }) => {
      await setRow(id, { payload: { ...payload, preview: { summary, details } } as never });
      return (await read(id)).state;
    };
    // The reviewer's three inputs: joiners, variation selectors, object replacement characters.
    for (const blank of ["\u200d", "\ufe0f", "\ufffc"]) {
      assert.equal(await stateOf(blank.repeat(100)), "unreadable", blank.codePointAt(0)?.toString(16));
    }
    // Fewer than three letters or digits says nothing; three do.
    assert.equal(await stateOf("ab"), "unreadable");
    assert.equal(await stateOf("Pay"), "pending");
    // A ZWJ inside real text is kept, and the text stays readable.
    assert.equal(await stateOf("Pay Ann 👨\u200d👩\u200d👧 40 EUR"), "pending");
    // The reviewer's stack of combining marks, in the summary or in a value.
    const stack = `Pay A${"\u0316".repeat(100)} 40 EUR`;
    assert.equal(await stateOf(stack), "unreadable");
    assert.equal(await stateOf("Record a payment.", { customer: stack }), "unreadable");
    assert.equal(await stateOf("Record a payment.", { [`Na${"\u0301".repeat(5)}me`]: "Ann" }), "unreadable");
    // Four marks on one character stay readable; five do not.
    assert.equal(await stateOf(`Pay A${"\u0316".repeat(4)} 40 EUR`), "pending");
    assert.equal(await stateOf(`Pay A${"\u0316".repeat(5)} 40 EUR`), "unreadable");
    // Scripts with their normal marks stay readable: Vietnamese, Arabic with harakat, pointed Hebrew, Thai.
    for (const text of [
      "Thanh toán 120.000 ₫ cho Nguyễn Văn Đức, đặt chỗ số 1042.",
      "دَفْعُ مِئَةٍ وَعِشْرِينَ يُورُو لِلْحَجْزِ ١٠٤٢",
      "תַּשְׁלוּם שֶׁל מֵאָה וְעֶשְׂרִים אֵירוֹ",
      "ชำระเงิน ๑๒๐ ยูโร สำหรับการจองที่ ๑๐๔๒",
    ]) {
      assert.equal(await stateOf(text, { customer: text }), "pending", text);
    }
  });

  test("the details read as a person writes them: no identifier, nothing empty, dates, amounts and named items told apart", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    await setRow(id, {
      payload: {
        ...payload,
        preview: {
          summary: "Confirm reservation #1042.",
          details: {
            reservationId: "res_abc",
            recipientsHash: "f".repeat(64),
            reservation: {
              id: "res_abc",
              number: "1042",
              startDate: "2026-11-21T09:00:00.000Z",
              endDate: "2026-11-23",
              totalAmount: "180.00",
              currency: "eur",
              customer_id: "cus_1",
            },
            note: null,
            empty: "",
            nothing: [],
            alsoNothing: { id: "x" },
            productSKU: "KAY-2",
            vatID: "FR123",
            shortfalls: [
              { product: "Kayak biplace", requested: 2, available: 1 },
              { requested: 1, available: 0 },
            ],
            email: "ann@example.com",
          },
        },
      },
    });
    const { preview } = await read(id);
    assert.ok(preview);
    // MySQL keeps each object's keys in its own order: every group compared by label.
    type Entry = { label: string; value: { kind: string; entries?: Entry[]; [field: string]: unknown } };
    const sorted = (entries: readonly Entry[]): Entry[] =>
      [...entries]
        .map((entry) =>
          entry.value.entries
            ? { ...entry, value: { ...entry.value, entries: sorted(entry.value.entries) } }
            : entry,
        )
        .sort((a, b) => a.label.localeCompare(b.label));
    assert.deepEqual(sorted(preview.details as Entry[]), sorted([
      {
        label: "Reservation",
        value: {
          kind: "group",
          entries: [
            { label: "Number", value: { kind: "text", text: "1042" } },
            { label: "Start date", value: { kind: "date", iso: "2026-11-21T09:00:00.000Z", dateOnly: false } },
            { label: "End date", value: { kind: "date", iso: "2026-11-23", dateOnly: true } },
            { label: "Total amount", value: { kind: "money", amount: 180, currency: "EUR" } },
          ],
        },
      },
      { label: "Product SKU", value: { kind: "text", text: "KAY-2" } },
      { label: "Vat ID", value: { kind: "text", text: "FR123" } },
      {
        label: "Shortfalls",
        value: {
          kind: "group",
          entries: [
            {
              label: "Kayak biplace",
              value: {
                kind: "group",
                entries: [
                  { label: "Requested", value: { kind: "number", value: 2 } },
                  { label: "Available", value: { kind: "number", value: 1 } },
                ],
              },
            },
            {
              label: "2",
              value: {
                kind: "group",
                entries: [
                  { label: "Requested", value: { kind: "number", value: 1 } },
                  { label: "Available", value: { kind: "number", value: 0 } },
                ],
              },
            },
          ],
        },
      },
      { label: "Email", value: { kind: "text", text: "ann@example.com" } },
      // An empty list is a fact; an identifier alone in its group is all that names it.
      { label: "Nothing", value: { kind: "group", entries: [] } },
      {
        label: "Also nothing",
        value: { kind: "group", entries: [{ label: "Id", value: { kind: "text", text: "x" } }] },
      },
    ] as Entry[]));
  });

  test("marks are counted per character as a person sees it, whatever sits between them", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const stateOf = async (summary: string, details: unknown = { amount: 40 }) => {
      await setRow(id, { payload: { ...payload, preview: { summary, details } } as never });
      return (await read(id)).state;
    };
    // The reviewer's input: a hundred marks on one character, each run broken by a kept joiner.
    const stack = `Pay A${"\u0316\u200d".repeat(100)} 40 EUR`;
    assert.equal(await stateOf(stack), "unreadable");
    assert.equal(await stateOf("Record a payment.", { customer: stack }), "unreadable");
    assert.equal(await stateOf("Record a payment.", { [stack]: "Ann" }), "unreadable");
    // An item's heading (its own name) is checked as every label is.
    assert.equal(
      await stateOf("Record a payment.", { lines: [{ product: stack, requested: 2 }] }),
      "unreadable",
    );
    // Variation selectors choose a form and stack nothing: an emoji keeps its own.
    assert.equal(await stateOf(`Pay ❤${"\ufe0f".repeat(6)} 40 EUR`), "pending");
  });

  test("a value is formatted only when its own key says what it is", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const detailsOf = async (details: unknown) => {
      await setRow(id, { payload: { ...payload, preview: { summary: "Confirm it.", details } } as never });
      return (await read(id)).preview?.details;
    };
    // The reviewer's inputs: a quantity next to a currency, a product named like a date.
    assert.deepEqual(
      sortedEntries(await detailsOf({ currency: "EUR", quantity: 2 })),
      sortedEntries([
        { label: "Currency", value: { kind: "text", text: "EUR" } },
        { label: "Quantity", value: { kind: "number", value: 2 } },
      ]),
    );
    assert.deepEqual(await detailsOf({ product: "2026-11-21" }), [
      { label: "Product", value: { kind: "text", text: "2026-11-21" } },
    ]);
    // Keys that say what they are: amounts in their currency, dates as dates.
    assert.deepEqual(
      sortedEntries(
        await detailsOf({
          currency: "EUR",
          totalAmount: "180.00",
          rental_paid: 40,
          fee: 2,
          startsAt: "2026-11-21T09:00:00.000Z",
          endDate: "2026-11-23",
          note: "2026-11-24",
        }),
      ),
      sortedEntries([
        { label: "Total amount", value: { kind: "money", amount: 180, currency: "EUR" } },
        { label: "Rental paid", value: { kind: "money", amount: 40, currency: "EUR" } },
        { label: "Fee", value: { kind: "money", amount: 2, currency: "EUR" } },
        { label: "Starts at", value: { kind: "date", iso: "2026-11-21T09:00:00.000Z", dateOnly: false } },
        { label: "End date", value: { kind: "date", iso: "2026-11-23", dateOnly: true } },
        { label: "Note", value: { kind: "text", text: "2026-11-24" } },
      ]),
    );
    // A date key holding something else stays as stored.
    assert.deepEqual(await detailsOf({ startDate: "soon" }), [
      { label: "Start date", value: { kind: "text", text: "soon" } },
    ]);
  });

  test("an identifier alone says which record it is, and an empty list says there is none", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const detailsOf = async (details: unknown) => {
      await setRow(id, { payload: { ...payload, preview: { summary: "Confirm it.", details } } as never });
      return (await read(id)).preview?.details;
    };
    // The reviewer's input: both entries are shown.
    assert.deepEqual(
      sortedEntries(await detailsOf({ customerId: "customer_42", messages: [] })),
      sortedEntries([
        { label: "Customer id", value: { kind: "text", text: "customer_42" } },
        { label: "Messages", value: { kind: "group", entries: [] } },
      ]),
    );
    // Named another way in its group, the identifier goes; a digest always does.
    assert.deepEqual(
      sortedEntries(
        await detailsOf({ customerId: "customer_42", customerName: "Ann", recipientsHash: "f".repeat(64) }),
      ),
      [{ label: "Customer name", value: { kind: "text", text: "Ann" } }],
    );
    // An item named by its heading needs no identifier either.
    assert.deepEqual(await detailsOf({ lines: [{ product: "Kayak", productId: "p_1" }] }), [
      {
        label: "Lines",
        value: { kind: "group", entries: [{ label: "Kayak", value: { kind: "group", entries: [] } }] },
      },
    ]);
    // null and empty texts stay left out.
    assert.deepEqual(await detailsOf({ note: null, comment: " ", messages: [] }), [
      { label: "Messages", value: { kind: "group", entries: [] } },
    ]);
  });

  test("the store's name must say which store it is; who asks with a name that shows nothing is named by its kind", async () => {
    const id = await ask(await apiKey());
    const rename = (name: string) =>
      louezDb.db.update(louezDb.stores).set({ name }).where(orm.eq(louezDb.stores.id, STORE));
    // The reviewer's store name: a zero-width space and a Hangul filler.
    await rename("\u200b\u3164");
    assert.equal((await read(id)).state, "unreadable");
    // A letter under a stack of marks shows no name either.
    await rename(`A${"\u0316".repeat(10)}`);
    assert.equal((await read(id)).state, "unreadable");
    // A short name is a name.
    await rename("UP");
    assert.equal((await read(id)).state, "pending");
    await rename("Vélo Liberté");
    assert.equal((await read(id)).state, "pending");
    // A key named with nothing visible: the line names it "an API key".
    await setRow(id, { clientName: "\u200b\u3164" });
    const approval = await read(id);
    assert.equal(approval.agent.shownName, null);
    assert.equal(approval.state, "pending");
    // A name that is not empty but shows no readable letter: named by its kind too.
    await setRow(id, { clientName: `A${"\u0316".repeat(10)}` });
    assert.equal((await read(id)).agent.shownName, null);
    await setRow(id, { clientName: "Sample assistant" });
    assert.equal((await read(id)).agent.shownName, "Sample assistant");
  });

  test("the store's time zone writes its dates; an unknown one is UTC", async () => {
    const id = await ask(await apiKey());
    const zone = async (timezone: string | undefined) => {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { currency: "EUR", country: "FR", ...(timezone ? { timezone } : {}) } as never })
        .where(orm.eq(louezDb.stores.id, STORE));
      return (await read(id)).store.timeZone;
    };
    assert.equal(await zone("Europe/Paris"), "Europe/Paris");
    assert.equal(await zone("Not/AZone"), "UTC");
    assert.equal(await zone(undefined), "UTC");
  });

  test("a summary too long to show whole is cut, says so, and cannot be approved", async () => {
    const id = await ask(await apiKey());
    const row = await rowOf(id);
    const payload = row.payload as import("@louez/db").ApiApprovalPayload;
    const long = `Record a payment. ${"a".repeat(10_000)} The end the person must read.`;
    await setRow(id, { payload: { ...payload, preview: { ...payload.preview, summary: long } } });
    const approval = await read(id);
    assert.equal(approval.state, "unreadable");
    assert.equal(approval.binding, null);
    assert.ok(approval.preview);
    assert.equal(approval.preview.truncated, true);
    assert.equal([...approval.preview.summary].length, page.SUMMARY_MAX);
    assert.ok(approval.preview.summary.endsWith("…"));
    assert.doesNotMatch(approval.preview.summary, /The end the person must read/);

    // Exactly the bound is shown whole, and stays decidable.
    const exact = "b".repeat(page.SUMMARY_MAX);
    await setRow(id, { payload: { ...payload, preview: { ...payload.preview, summary: exact } } });
    const whole = await read(id);
    assert.equal(whole.state, "pending");
    assert.equal(whole.preview?.summary, exact);
    assert.equal(whole.preview?.truncated, false);
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
          kind: "group",
          entries: [
            { label: "1", value: { kind: "text", text: "a" } },
            { label: "2", value: { kind: "number", value: 2 } },
          ],
        },
      },
    ]);
    await withPreview({ summary: "Erase it." });
    assert.deepEqual((await read(id)).preview, {
      summary: "Erase it.",
      truncated: false,
      details: [],
    });

    for (const unreadable of [null, "Erase it.", { details: {} }, { summary: 4 }, { summary: " \u202e " }]) {
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
          acknowledged: true,
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
      {
        id,
        decision: "approve",
        revision: now.revision,
        shown: now.binding ?? "",
        acknowledged: true,
        userId: OWNER,
      },
      ports,
    );
    assert.equal((await read(id)).state, "approved");
  });
});
