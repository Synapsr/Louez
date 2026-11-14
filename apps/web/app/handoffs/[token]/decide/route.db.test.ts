import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { NextRequest } from "next/server";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  BROWSER_POST,
  SESSION_HEADER,
  stubHandoffRoutes,
} from "@/lib/handoffs/test-handoff-routes";

// A person's answer posted from a step's page, through the route's own code
// (`POST /handoffs/<id>/decide`) on a migrated database: the same-origin
// check, the fields the page posts, and `handoffs.decide` called as the
// signed-in user. Every answer is posted with the headers a browser sends
// from a hand-off page (`BROWSER_POST`: `Origin: null`, as the pages send no
// referrer). The session is read from a test header (Better Auth stays out)
// and the app's ports are the API's test ports.

stubHandoffRoutes({
  planFeatures: async () => ({ apiAccess: true }),
  runReservationEffects: async () => {},
  insurance: { createContract: async () => null, cancelContract: async () => {} },
  newStores: createTestNewStores(),
  dispatchEffects: () => {},
  storage: createMemoryStorage(),
  urls: createTestUrls(),
  afterCommit: () => {},
  team: { collaboratorLimit: async () => 10, emailConfigured: () => true },
});

const APP = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_URL = APP;
process.env.AUTH_SECRET ??= "handoff-decide-test-secret";

const OWNER = "hd_owner_user_000001";
const STRANGER = "hd_stranger_user_001";
const STORE = "hd_store_a_000000001";
const KEY = "hd_api_key_000000001";

describe("a step's answer posted to its route (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let handoffs: typeof import("@louez/api/services/handoffs");
  let route: typeof import("./route");

  before(async () => {
    database = await createTestDatabase("handoff_decide_route");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    // packages/api is ES modules: it needs the CommonJS packages' names by
    // hand, before any of its modules loads.
    await import("@louez/mcp/testing/cjs-named-exports");
    handoffs = await import("@louez/api/services/handoffs");
    route = await import("./route");
    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@decide.test", name: "Olga Owner" },
      { id: STRANGER, email: "stranger@decide.test", name: "Sven Stranger" },
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
      louezDb.apiKeys,
      louezDb.storeInvitations,
      louezDb.storeMembers,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Roscoff Voile",
      slug: "hd-roscoff",
      onboardingCompleted: true,
    });
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: STRANGER, role: "owner" },
    ]);
    // The connection that asked: an API key of the owner, not revoked.
    await db.insert(louezDb.apiKeys).values({
      id: KEY,
      storeId: STORE,
      userId: OWNER,
      name: "Store agent",
      keyPrefix: "lz_hd_000001",
      keyHash: "a".repeat(64),
      permissions: {
        reservations: "none",
        products: "none",
        customers: "none",
        categories: "none",
        payments: "none",
        analytics: "none",
        settings: "none",
        team: "write",
      },
    });
  });

  const rowOf = async (id: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, id));
    assert.ok(row, `step ${id}`);
    return row;
  };

  /** An agent's invitation of `email`, waiting for the owner, as its request leaves it. */
  async function invitation(email = "new.person@decide.test") {
    const now = new Date();
    const [created] = await louezDb.db
      .insert(louezDb.apiHandoffs)
      .values({
        storeId: STORE,
        kind: "team_invitation",
        subject: email,
        payload: { email, role: "member", joinsAtOnce: false },
        status: "pending",
        activeSlot: 1,
        userId: OWNER,
        credentialKind: "api_key",
        credentialId: KEY,
        clientName: "Store agent",
        tokenHash: "b".repeat(64),
        linkIssuedAt: now,
        expiresAt: handoffs.linkExpiry("team_invitation", now),
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    return rowOf(created.id);
  }

  /** What is set of these entries: a field or a header left out is not sent. */
  const sent = (entries: Record<string, string | undefined>) =>
    Object.fromEntries(
      Object.entries(entries).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );

  /** The page's form, posted by `user` with these fields and headers. */
  function post(
    id: string,
    fields: Record<string, string | undefined>,
    options: { user?: string | null; headers?: Record<string, string | undefined> } = {},
  ) {
    const user = options.user === undefined ? OWNER : options.user;
    return route.POST(
      new NextRequest(new URL(`/handoffs/${id}/decide`, APP), {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...sent(options.headers ?? BROWSER_POST),
          ...(user ? { [SESSION_HEADER]: user } : {}),
        },
        body: new URLSearchParams(sent(fields)),
      }),
      { params: Promise.resolve({ token: id }) },
    );
  }

  const location = (response: Response) => response.headers.get("location") ?? "";

  describe("an invitation's answer, as before", () => {
    const shownOf = (row: Awaited<ReturnType<typeof invitation>>) => {
      const payload = handoffs.invitationPayloadOf(row);
      assert.ok(payload);
      return handoffs.invitationShown(payload);
    };

    test("approving sends the owner to the result, the invitation out", async () => {
      const row = await invitation();
      const response = await post(row.id, {
        decision: "approve",
        revision: String(row.revision),
        shown: shownOf(row),
      });
      assert.equal(response.status, 303);
      assert.equal(location(response), `/handoffs/done/${row.id}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const after = await rowOf(row.id);
      assert.equal(after.status, "completed");
      assert.equal(after.decision, "approved");
      assert.equal(after.decidedByUserId, OWNER);
      const invitations = await louezDb.db.select().from(louezDb.storeInvitations);
      assert.equal(invitations.length, 1);
    });

    test("refusing with words records them, made plain text", async () => {
      const row = await invitation();
      const response = await post(row.id, {
        decision: "refuse",
        reason: "  Not this one\r\n<b>sorry</b>\u202e  ",
        revision: String(row.revision),
        shown: shownOf(row),
      });
      assert.equal(location(response), `/handoffs/done/${row.id}`);
      const after = await rowOf(row.id);
      assert.equal(after.status, "failed");
      assert.equal(after.failureCode, "declined");
      assert.equal(after.decision, "refused");
      assert.equal(after.decisionReason, "Not this one\n<b>sorry</b>");
    });

    test("a page served before refusals were named posts decline, read as a refusal", async () => {
      const row = await invitation();
      await post(row.id, { decision: "decline", revision: String(row.revision), shown: shownOf(row) });
      assert.equal((await rowOf(row.id)).decision, "refused");
    });

    test("another revision, or a digest of something else, decides nothing: the page asks again", async () => {
      const row = await invitation();
      for (const fields of [
        { decision: "approve", revision: String(row.revision + 1), shown: shownOf(row) },
        { decision: "approve", revision: String(row.revision), shown: "c".repeat(64) },
      ]) {
        const response = await post(row.id, fields);
        assert.equal(response.status, 303);
        assert.equal(location(response), `/handoffs/${row.id}?changed=1`);
      }
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("a missing answer goes back to the page; a missing revision or digest asks again", async () => {
      const row = await invitation();
      const revision = String(row.revision);
      const shown = shownOf(row);
      assert.equal(location(await post(row.id, { revision, shown })), `/handoffs/${row.id}`);
      assert.equal(
        location(await post(row.id, { decision: "maybe", revision, shown })),
        `/handoffs/${row.id}`,
      );
      assert.equal(
        location(await post(row.id, { decision: "approve", shown })),
        `/handoffs/${row.id}?changed=1`,
      );
      assert.equal(
        location(await post(row.id, { decision: "approve", revision })),
        `/handoffs/${row.id}?changed=1`,
      );
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("an answer posted twice decides once; the second is shown the page's error", async () => {
      const row = await invitation();
      const fields = { decision: "refuse", revision: String(row.revision), shown: shownOf(row) };
      assert.equal(location(await post(row.id, fields)), `/handoffs/done/${row.id}`);
      assert.equal(location(await post(row.id, fields)), `/handoffs/${row.id}?error=failed`);
      const after = await rowOf(row.id);
      assert.equal(after.decision, "refused");
    });

    test("another signed-in user decides nothing", async () => {
      const row = await invitation();
      const response = await post(
        row.id,
        { decision: "approve", revision: String(row.revision), shown: shownOf(row) },
        { user: STRANGER },
      );
      assert.equal(location(response), `/handoffs/${row.id}?error=failed`);
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("signed out, the owner signs in and comes back to the page", async () => {
      const row = await invitation();
      const response = await post(
        row.id,
        { decision: "approve", revision: String(row.revision), shown: shownOf(row) },
        { user: null },
      );
      assert.equal(response.status, 303);
      assert.match(location(response), /\/login\?/);
      const cookie = decodeURIComponent(response.headers.get("set-cookie") ?? "");
      assert.match(cookie, new RegExp(`louez_handoff_next=/handoffs/${row.id};`));
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("a post that names this app's origin, as a page that sends its referrer would, is accepted", async () => {
      const row = await invitation();
      const fields = { decision: "refuse", revision: String(row.revision), shown: shownOf(row) };
      for (const headers of [{ origin: APP, "sec-fetch-site": "same-origin" }, { origin: APP }]) {
        await louezDb.db
          .update(louezDb.apiHandoffs)
          .set({ status: "pending", activeSlot: 1, decision: null, failureCode: null })
          .where(orm.eq(louezDb.apiHandoffs.id, row.id));
        const response = await post(row.id, fields, { headers });
        assert.equal(location(response), `/handoffs/done/${row.id}`, JSON.stringify(headers));
      }
    });

    test("a post from another site, or without an Origin, is refused before anything is read", async () => {
      const row = await invitation();
      const fields = { decision: "approve", revision: String(row.revision), shown: shownOf(row) };
      const refused: Array<Record<string, string>> = [
        { origin: "https://evil.test" },
        { origin: "https://evil.test", "sec-fetch-site": "same-origin" },
        { origin: APP, "sec-fetch-site": "cross-site" },
        { origin: APP, "sec-fetch-site": "same-site" },
        // A hidden origin counts only with the browser's own same-origin.
        { origin: "null" },
        { origin: "null", "sec-fetch-site": "cross-site" },
        { origin: "null", "sec-fetch-site": "same-site" },
        {},
      ];
      for (const headers of refused) {
        const response = await post(row.id, fields, { headers });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      assert.equal((await rowOf(row.id)).status, "pending");
    });
  });

  describe("an approval's answer", () => {
    const BINDING = "e".repeat(64);

    /** An agent's request a person must approve, as its request leaves it: money, unless said otherwise. */
    async function approval(
      consequences: unknown = ["money"],
      summary = "Record a rental payment of 40.00 € (cash) on reservation #1042.",
    ) {
      const now = new Date();
      const [created] = await louezDb.db
        .insert(louezDb.apiHandoffs)
        .values({
          storeId: STORE,
          kind: "operation_approval",
          subject: "f".repeat(64),
          procedure: "dashboard.payments.record",
          bindingHash: BINDING,
          payload: {
            input: { reservationId: "r1", type: "rental", amount: 40, method: "cash" },
            preview: { summary, details: { number: "1042", amount: 40 } },
            scope: { domain: "payments", level: "write", role: "write" },
            consequences: consequences as string[],
          },
          status: "pending",
          activeSlot: 1,
          userId: OWNER,
          credentialKind: "api_key",
          credentialId: KEY,
          clientName: "Store agent",
          tokenHash: null,
          linkIssuedAt: now,
          expiresAt: handoffs.linkExpiry("operation_approval", now),
          createdAt: now,
          updatedAt: now,
        })
        .$returningId();
      return rowOf(created.id);
    }

    test("approving records the decision on the binding shown, and sends the person to the result", async () => {
      const row = await approval();
      const response = await post(row.id, {
        decision: "approve",
        acknowledged: "yes",
        revision: String(row.revision),
        shown: BINDING,
      });
      assert.equal(response.status, 303);
      assert.equal(location(response), `/handoffs/done/${row.id}`);
      const after = await rowOf(row.id);
      assert.equal(after.status, "approved");
      assert.equal(after.decision, "approved");
      assert.equal(after.decidedByUserId, OWNER);
      assert.equal(after.bindingHash, BINDING);
    });

    test("refusing with words ends it, the words made plain text", async () => {
      const row = await approval();
      const response = await post(row.id, {
        decision: "refuse",
        reason: "Pas en espèces\r\nmerci\u202e",
        revision: String(row.revision),
        shown: BINDING,
      });
      assert.equal(location(response), `/handoffs/done/${row.id}`);
      const after = await rowOf(row.id);
      assert.equal(after.status, "failed");
      assert.equal(after.failureCode, "declined");
      assert.equal(after.decision, "refused");
      assert.equal(after.decisionReason, "Pas en espèces\nmerci");
    });

    test("words over 500 characters decide nothing", async () => {
      const row = await approval();
      const response = await post(row.id, {
        decision: "refuse",
        reason: "x".repeat(501),
        revision: String(row.revision),
        shown: BINDING,
      });
      assert.equal(location(response), `/handoffs/${row.id}?error=failed`);
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("money approved without the box ticked decides nothing: back to the page, which asks for it", async () => {
      const row = await approval();
      const fields = { decision: "approve", revision: String(row.revision), shown: BINDING };
      for (const box of [{}, { acknowledged: "" }, { acknowledged: "on" }, { acknowledged: "no" }]) {
        const response = await post(row.id, { ...fields, ...box });
        assert.equal(location(response), `/handoffs/${row.id}?acknowledge=1`, JSON.stringify(box));
      }
      const after = await rowOf(row.id);
      assert.equal(after.status, "pending");
      assert.equal(after.decision, null);
      // Ticked, the same answer decides it.
      const ticked = await post(row.id, { ...fields, acknowledged: "yes" });
      assert.equal(location(ticked), `/handoffs/done/${row.id}`);
      assert.equal((await rowOf(row.id)).status, "approved");
    });

    test("a refusal never needs the box, and a plain change asks for none", async () => {
      const refused = await approval();
      await post(refused.id, { decision: "refuse", revision: String(refused.revision), shown: BINDING });
      assert.equal((await rowOf(refused.id)).decision, "refused");

      await louezDb.db.delete(louezDb.apiHandoffs);
      const change = await approval(["change"]);
      const response = await post(change.id, {
        decision: "approve",
        revision: String(change.revision),
        shown: BINDING,
      });
      assert.equal(location(response), `/handoffs/done/${change.id}`);
      assert.equal((await rowOf(change.id)).status, "approved");

      // Nothing Louez knows of what it does: the box, as for money.
      await louezDb.db.delete(louezDb.apiHandoffs);
      const unknown = await approval(["teleport"]);
      const blind = await post(unknown.id, {
        decision: "approve",
        revision: String(unknown.revision),
        shown: BINDING,
      });
      assert.equal(location(blind), `/handoffs/${unknown.id}?acknowledge=1`);
      assert.equal((await rowOf(unknown.id)).status, "pending");
    });

    test("a request its page cannot show whole is not approved by a forged post; refusing it still works", async () => {
      // The reviewer's summary: 1,001 characters, one more than the page shows.
      const row = await approval(["money"], `Record ${"a".repeat(993)}.`);
      assert.equal([...`Record ${"a".repeat(993)}.`].length, 1_001);
      const response = await post(row.id, {
        decision: "approve",
        acknowledged: "yes",
        revision: String(row.revision),
        shown: BINDING,
      });
      assert.equal(location(response), `/handoffs/${row.id}?error=failed`);
      const after = await rowOf(row.id);
      assert.equal(after.status, "pending");
      assert.equal(after.decision, null);
      const refused = await post(row.id, {
        decision: "refuse",
        revision: String(row.revision),
        shown: BINDING,
      });
      assert.equal(location(refused), `/handoffs/done/${row.id}`);
      assert.equal((await rowOf(row.id)).decision, "refused");
    });

    test("a summary that shows nothing, or whose marks spill off its line, is not approved by a forged post", async () => {
      for (const summary of [
        "\u200d".repeat(100),
        "\ufe0f".repeat(100),
        "\ufffc".repeat(100),
        `Pay A${"\u0316".repeat(100)} 40 EUR`,
      ]) {
        await louezDb.db.delete(louezDb.apiHandoffs);
        const row = await approval(["money"], summary);
        const response = await post(row.id, {
          decision: "approve",
          acknowledged: "yes",
          revision: String(row.revision),
          shown: BINDING,
        });
        const code = summary.codePointAt(summary.length > 10 ? 5 : 0)?.toString(16);
        assert.equal(location(response), `/handoffs/${row.id}?error=failed`, code);
        assert.equal((await rowOf(row.id)).status, "pending", code);
      }
    });

    test("a partly malformed list of consequences asks for the box; only a list of known plain changes does not", async () => {
      for (const consequences of [["change", {}], [], "change", ["change", "nope"]]) {
        await louezDb.db.delete(louezDb.apiHandoffs);
        const row = await approval(consequences);
        const response = await post(row.id, {
          decision: "approve",
          revision: String(row.revision),
          shown: BINDING,
        });
        assert.equal(location(response), `/handoffs/${row.id}?acknowledge=1`, JSON.stringify(consequences));
        assert.equal((await rowOf(row.id)).status, "pending");
      }
      await louezDb.db.delete(louezDb.apiHandoffs);
      const plain = await approval(["change"]);
      const response = await post(plain.id, {
        decision: "approve",
        revision: String(plain.revision),
        shown: BINDING,
      });
      assert.equal(location(response), `/handoffs/done/${plain.id}`);
      assert.equal((await rowOf(plain.id)).status, "approved");
    });

    test("a stale revision or a forged binding decides nothing: the page shows the request as it is now", async () => {
      const row = await approval();
      for (const fields of [
        { decision: "approve", acknowledged: "yes", revision: String(row.revision + 1), shown: BINDING },
        { decision: "approve", acknowledged: "yes", revision: String(row.revision), shown: "0".repeat(64) },
        { decision: "refuse", revision: String(row.revision), shown: "0".repeat(64) },
      ]) {
        const response = await post(row.id, fields);
        assert.equal(location(response), `/handoffs/${row.id}?changed=1`);
      }
      const after = await rowOf(row.id);
      assert.equal(after.status, "pending");
      assert.equal(after.decision, null);
    });

    test("a missing answer, revision or binding decides nothing", async () => {
      const row = await approval();
      const revision = String(row.revision);
      assert.equal(location(await post(row.id, { revision, shown: BINDING })), `/handoffs/${row.id}`);
      assert.equal(
        location(await post(row.id, { decision: "approve", shown: BINDING })),
        `/handoffs/${row.id}?changed=1`,
      );
      assert.equal(
        location(await post(row.id, { decision: "approve", revision })),
        `/handoffs/${row.id}?changed=1`,
      );
      assert.equal(
        location(await post(row.id, { decision: "approve", revision, shown: "not-a-binding" })),
        `/handoffs/${row.id}?changed=1`,
      );
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("an answer posted twice decides once: approve then refuse leaves it approved", async () => {
      const row = await approval();
      const fields = { revision: String(row.revision), shown: BINDING };
      assert.equal(
        location(await post(row.id, { ...fields, decision: "approve", acknowledged: "yes" })),
        `/handoffs/done/${row.id}`,
      );
      assert.equal(
        location(await post(row.id, { ...fields, decision: "refuse" })),
        `/handoffs/${row.id}?error=failed`,
      );
      const after = await rowOf(row.id);
      assert.equal(after.status, "approved");
      assert.equal(after.decision, "approved");
    });

    test("another signed-in user, or a request whose connection is gone, decides nothing", async () => {
      const row = await approval();
      const fields = { decision: "approve", revision: String(row.revision), shown: BINDING };
      assert.equal(
        location(await post(row.id, fields, { user: STRANGER })),
        `/handoffs/${row.id}?error=failed`,
      );
      await louezDb.db
        .update(louezDb.apiKeys)
        .set({ revokedAt: new Date() })
        .where(orm.eq(louezDb.apiKeys.id, KEY));
      assert.equal(location(await post(row.id, fields)), `/handoffs/${row.id}?error=failed`);
      assert.equal((await rowOf(row.id)).status, "pending");
    });

    test("a post from another site, or a hidden origin the browser does not vouch for, is refused", async () => {
      const row = await approval();
      for (const headers of [
        { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
        { origin: "null" },
        { origin: "null", "sec-fetch-site": "cross-site" },
      ]) {
        const response = await post(
          row.id,
          { decision: "approve", revision: String(row.revision), shown: BINDING },
          { headers },
        );
        assert.equal(response.status, 403, JSON.stringify(headers));
      }
      assert.equal((await rowOf(row.id)).status, "pending");
    });
  });
});
