import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { AIChatContext, createAITools } from "./tools";

// The in-app assistant's payment tools on a migrated database, through the
// clients the chat route builds (lib/ai/assistant-api.ts): money is written
// only once the signed-in person decided it on a request the server
// recorded. The first call records nothing and answers the request for the
// card; the person approves or refuses on its page, as their own session
// (`handoffs.decide`, the page's form post); the same arguments with the
// approval's id carry it out, once. A forged id, another request's, a request
// approved with other figures, a used one, a refusal: nothing is written. The
// mark of the assistant comes from the server alone; the assistant never
// decides; another user never decides; the caps are the user's in the store.

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
const directory = mkdtempSync(join(tmpdir(), "louez-ai-approvals-"));
const authStubPath = join(directory, "auth.mjs");
writeFileSync(
  authStubPath,
  `export const auth = {};
export const mcpOAuth = null;
export const authInstance = {
  api: {
    getSession: async ({ headers }) => {
      const id = headers.get(${JSON.stringify(SESSION_HEADER)});
      return id ? { user: { id, email: id + "@aa.test" } } : null;
    },
  },
};`,
);
after(() => rmSync(directory, { recursive: true }));

// The status-change module the tools import pulls in "server-only".
const FILES_SDK = new URL("../../node_modules/files-sdk/dist/", import.meta.url);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    // The PDFs' images are read through the file storage SDK, which exports ESM
    // only, through an "import" condition the test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { url: new URL(entry, FILES_SDK).href, shortCircuit: true };
    }
    if (specifier === "@louez/auth") {
      return { url: pathToFileURL(authStubPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const OWNER = "aa_owner_user_000001";
const MEMBER = "aa_member_user_00001";
const STRANGER = "aa_stranger_user_001";
const STORE = "aa_store_a_000000001";
const OTHER_STORE = "aa_store_b_000000001";
const CUSTOMER = "aa_customer_00000001";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;

type Tools = ReturnType<typeof createAITools>;
type Result = Record<string, unknown> & { status?: string };

describe(
  "the assistant's payments wait for the person (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let aiTools: typeof import("./tools");
    let assistantApi: typeof import("./assistant-api");
    let appRouter: typeof import("@louez/api/router").appRouter;
    let createRouterClient: typeof import("@orpc/server").createRouterClient;
    let ports: Parameters<typeof assistantApi.createAssistantApi>[0]["ports"];
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("ai_payment_approvals");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      aiTools = await import("./tools");
      const { paymentRecordsPort } = await import("@/lib/api/payment-records-port");
      const { paymentRefundsPort } = await import("@/lib/api/payment-refunds-port");
      // packages/api is ES modules: its router needs the CommonJS packages'
      // names by hand. Loaded last, as the mocks change how later modules load.
      await import("@louez/mcp/testing/cjs-named-exports");
      appRouter = (await import("@louez/api/router")).appRouter;
      createRouterClient = (await import("@orpc/server")).createRouterClient;
      assistantApi = await import("./assistant-api");
      ports = {
        planFeatures: async () => ({ apiAccess: true }),
        runReservationEffects: async () => {},
        insurance: { createContract: async () => null, cancelContract: async () => {} },
        newStores: createTestNewStores(),
        dispatchEffects: () => {},
        storage: createMemoryStorage(),
        urls: createTestUrls(),
        afterCommit: () => {},
        paymentRecords: paymentRecordsPort,
        paymentRefunds: paymentRefundsPort,
      } as typeof ports;

      await louezDb.db.insert(louezDb.users).values([
        { id: OWNER, email: "owner@aa.test" },
        { id: MEMBER, email: "member@aa.test" },
        { id: STRANGER, email: "stranger@aa.test" },
      ]);
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE, userId: OWNER, name: "Assistant store", slug: "aa-store", settings: SETTINGS },
        { id: OTHER_STORE, userId: STRANGER, name: "Other store", slug: "aa-other" },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE, userId: OWNER, role: "owner" },
        { storeId: STORE, userId: MEMBER, role: "member" },
        { storeId: OTHER_STORE, userId: STRANGER, role: "owner" },
      ]);
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@aa.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.apiHandoffs);
      await louezDb.db.delete(louezDb.apiOperations);
      await louezDb.db.delete(louezDb.billingSyncQueue);
    });

    async function reservation(number?: string) {
      counter += 1;
      const id = `aa_res_${String(counter).padStart(14, "0")}`;
      // A fixture, so it may start in any status.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: number ?? `2030-${String(counter).padStart(4, "0")}`,
        status: "confirmed",
        startDate: new Date("2030-06-01T09:00:00Z"),
        endDate: new Date("2030-06-03T09:00:00Z"),
        subtotalAmount: "80.00",
        depositAmount: "50.00",
        totalAmount: "80.00",
        currency: "EUR",
      });
      return id;
    }

    const paymentsOf = (reservationId: string) =>
      louezDb.db
        .select()
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId));

    async function rowOf(id: string) {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(eq(louezDb.apiHandoffs.id, id));
      assert.ok(row, `approval ${id}`);
      return row;
    }

    /** The tools as the chat route builds them, for `user`, from a request with `headers`. */
    function toolsFor(user = OWNER, headers: Record<string, string> = {}): Tools {
      return aiTools.createAITools({
        storeId: STORE,
        userId: user,
        storeName: "Assistant store",
        urls: createTestUrls(),
        api: assistantApi.createAssistantApi({
          headers: new Headers({ [SESSION_HEADER]: user, ...headers }),
          storeId: STORE,
          ports,
        }),
        permissions: {
          reservations: "write",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "write",
          analytics: "read",
          settings: "read",
        },
      } satisfies AIChatContext);
    }

    async function run(
      tools: Tools,
      name: "record_payment" | "delete_payment" | "return_deposit",
      input: Record<string, unknown>,
    ): Promise<Result> {
      const execute = tools[name].execute as
        | ((input: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>)
        | undefined;
      assert.ok(execute, "the tool runs on the server");
      return (await execute(input, { toolCallId: "call", messages: [] })) as Result;
    }

    /** The approval page's decision, as the person's own session posts it. */
    function decide(
      id: string,
      decision: "approve" | "refuse",
      options: { user?: string; assistant?: boolean } = {},
    ) {
      const context = {
        headers: new Headers({ [SESSION_HEADER]: options.user ?? OWNER }),
        transport: "rpc" as const,
        ports,
        ...(options.assistant ? { assistant: true as const } : {}),
      };
      const handoffs = createRouterClient(appRouter.dashboard.handoffs, {
        context,
        path: ["dashboard", "handoffs"],
      });
      return rowOf(id).then((row) =>
        handoffs.decide({
          id,
          decision,
          revision: row.revision,
          shown: row.bindingHash ?? "0".repeat(64),
          acknowledged: true,
        }),
      );
    }

    const codeOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return "resolved";
      } catch (error) {
        return (error as { data?: { code?: string } }).data?.code ?? String(error);
      }
    };

    const recordInput = (reservationId: string, extra: Record<string, unknown> = {}) => ({
      reservationId,
      type: "rental",
      amount: "40.00",
      method: "cash",
      ...extra,
    });

    /** Prepares a payment and has the owner approve it on its page. */
    async function approved(input: Record<string, unknown>, tools = toolsFor()) {
      const asked = await run(tools, "record_payment", input);
      assert.equal(asked.status, "approval_required");
      const id = String(asked.approvalId);
      await decide(id, "approve");
      return id;
    }

    test("the first call records nothing and answers the request the card shows", async () => {
      const reservationId = await reservation();
      const asked = await run(toolsFor(), "record_payment", recordInput(reservationId));

      assert.equal(asked.status, "approval_required");
      assert.match(String(asked.approvalId), /^[A-Za-z0-9_-]{21}$/);
      assert.equal(asked.url, `${TEST_APP_URL}/handoffs/${String(asked.approvalId)}`);
      assert.equal(asked.amount, "40.00");
      assert.match(String(asked.bookingNumber), /^2030-/);
      assert.match(
        String(asked.summary),
        /^Record a rental payment of €40\.00 \(cash\) on reservation #2030-/,
      );
      assert.ok(!Number.isNaN(Date.parse(String(asked.expiresAt))));
      assert.deepEqual(await paymentsOf(reservationId), [], "nothing is written");

      // Recorded as the assistant's request, for the owner: who asked, through what.
      const row = await rowOf(String(asked.approvalId));
      assert.equal(row.kind, "operation_approval");
      assert.equal(row.status, "pending");
      assert.equal(row.userId, OWNER);
      assert.equal(row.credentialKind, "assistant");
      assert.equal(row.credentialId, null);
      assert.equal(row.clientName, "Louez assistant");
    });

    test("before the person decides, the approval's id carries out nothing", async () => {
      const reservationId = await reservation();
      const tools = toolsFor();
      const asked = await run(tools, "record_payment", recordInput(reservationId));
      const pending = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: asked.approvalId }),
      );
      assert.equal(pending.status, "pending");
      assert.match(String(pending.message), /has not decided yet/);
      assert.deepEqual(await paymentsOf(reservationId), []);
    });

    test("approved on its page, the same arguments with its id carry it out, once", async () => {
      const reservationId = await reservation();
      const tools = toolsFor();
      const id = await approved(recordInput(reservationId), tools);

      const done = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: id }),
      );
      assert.equal(done.status, "done");
      assert.equal(done.amount, "40.00");
      const rows = await paymentsOf(reservationId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.amount, "40.00");
      assert.equal((await rowOf(id)).status, "completed");

      const again = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: id }),
      );
      assert.deepEqual([again.status, again.reason], ["invalid", "used"]);
      assert.equal((await paymentsOf(reservationId)).length, 1, "carried out once");
    });

    test("a forged approval id carries out nothing, and never falls back to running", async () => {
      const reservationId = await reservation();
      const tools = toolsFor();
      // An id of the right form that no request of this caller has.
      const forged = randomBytes(16).toString("base64url").slice(0, 21);
      const answer = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: forged }),
      );
      assert.deepEqual([answer.status, answer.reason], ["invalid", "other_request"]);
      // Anything else in its place is no approval: the call asks the person.
      const garbled = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: "approved" }),
      );
      assert.equal(garbled.status, "approval_required");
      assert.deepEqual(await paymentsOf(reservationId), []);
    });

    test("another request's approval carries out nothing", async () => {
      const reservationId = await reservation();
      const elsewhere = await reservation();
      const tools = toolsFor();
      const id = await approved(recordInput(reservationId), tools);

      for (const input of [
        recordInput(reservationId, { amount: "400.00", approvalId: id }),
        recordInput(elsewhere, { approvalId: id }),
        recordInput(reservationId, { type: "damage", approvalId: id }),
      ]) {
        const answer = await run(tools, "record_payment", input);
        assert.deepEqual(
          [answer.status, answer.reason],
          ["invalid", "other_request"],
          JSON.stringify(input),
        );
      }
      // A deletion presented with a recording's approval.
      const [payment] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId,
          type: "rental",
          amount: "5.00",
          method: "cash",
          status: "completed",
        })
        .$returningId();
      const deletion = await run(tools, "delete_payment", {
        paymentId: payment.id,
        approvalId: id,
      });
      assert.deepEqual([deletion.status, deletion.reason], ["invalid", "other_request"]);

      assert.equal((await paymentsOf(reservationId)).length, 1, "only the fixture's payment");
      assert.deepEqual(await paymentsOf(elsewhere), []);
      assert.equal((await rowOf(id)).status, "approved", "the approval is left as it was");
    });

    test("an approval of other arguments for the same request ends, and runs nothing", async () => {
      const reservationId = await reservation();
      const tools = toolsFor();
      const id = await approved(recordInput(reservationId, { notes: "As agreed" }), tools);

      const answer = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { notes: "Something else", approvalId: id }),
      );
      assert.deepEqual([answer.status, answer.reason], ["invalid", "state_changed"]);
      assert.deepEqual(await paymentsOf(reservationId), []);
      const row = await rowOf(id);
      assert.deepEqual([row.status, row.failureCode], ["failed", "state_changed"]);
    });

    test("a refusal is said as one, and runs nothing", async () => {
      const reservationId = await reservation();
      const tools = toolsFor();
      const asked = await run(tools, "record_payment", recordInput(reservationId));
      await decide(String(asked.approvalId), "refuse");
      const answer = await run(
        tools,
        "record_payment",
        recordInput(reservationId, { approvalId: asked.approvalId }),
      );
      assert.equal(answer.status, "declined");
      const again = await run(tools, "record_payment", recordInput(reservationId));
      assert.equal(again.status, "declined", "the same request is not asked again at once");
      assert.deepEqual(await paymentsOf(reservationId), []);
    });

    test("in yen, half a yen is refused in the chat's words with nothing asked; one yen is asked in yen, and its approval names the amount in yen", async () => {
      const reservationId = await reservation();
      const inCurrency = (currency: string) =>
        louezDb.db
          .update(louezDb.reservations)
          .set({ currency })
          .where(eq(louezDb.reservations.id, reservationId));
      await inCurrency("JPY");
      await louezDb.db.insert(louezDb.payments).values({
        reservationId,
        type: "deposit",
        amount: "5.00",
        method: "cash",
        status: "completed",
        currency: "JPY",
      });
      const tools = toolsFor();
      const asked = async () => (await louezDb.db.select().from(louezDb.apiHandoffs)).length;
      const noDecimals = 'A JPY amount has no decimals: send whole units (such as "30")';

      assert.deepEqual(
        await run(tools, "record_payment", recordInput(reservationId, { amount: "0.5" })),
        { error: noDecimals },
      );
      assert.deepEqual(
        await run(tools, "return_deposit", { reservationId, amount: "0.5", method: "cash" }),
        { error: noDecimals },
      );
      assert.equal(await asked(), 0, "nothing is asked");

      const one = recordInput(reservationId, { amount: "1" });
      const first = await run(tools, "record_payment", one);
      assert.equal(first.status, "approval_required");
      assert.match(
        String(first.summary),
        /^Record a rental payment of ¥1 \(cash\) on reservation #/,
      );
      const id = String(first.approvalId);
      await decide(id, "approve");
      const done = await run(tools, "record_payment", { ...one, approvalId: id });
      assert.equal(done.status, "done");
      const [row] = (await paymentsOf(reservationId)).filter(
        (payment) => payment.type === "rental",
      );
      assert.deepEqual([row?.amount, row?.currency, row?.grossMinor], ["1.00", "JPY", 1]);

      // The approval names the amount in its currency, and binds its billing
      // facts (gross in minor units): the same text in euros (100 cents, not
      // 1 yen) is another request, and runs nothing.
      const back = { reservationId, amount: "1", method: "cash" };
      const returning = await run(tools, "return_deposit", back);
      assert.equal(returning.status, "approval_required");
      await decide(String(returning.approvalId), "approve");
      await inCurrency("EUR");
      const moved = await run(tools, "return_deposit", {
        ...back,
        approvalId: returning.approvalId,
      });
      assert.deepEqual([moved.status, moved.reason], ["invalid", "other_request"]);
      assert.equal(
        (await paymentsOf(reservationId)).filter((payment) => payment.type === "deposit_return")
          .length,
        0,
      );
    });

    test("a deposit return and a deletion wait for the person too, then run once", async () => {
      const reservationId = await reservation();
      await louezDb.db.insert(louezDb.payments).values({
        reservationId,
        type: "deposit",
        amount: "50.00",
        method: "cash",
        status: "completed",
      });
      const tools = toolsFor();
      const returnInput = { reservationId, amount: "20.00", method: "cash" };
      const asked = await run(tools, "return_deposit", returnInput);
      assert.equal(asked.status, "approval_required");
      assert.equal((await paymentsOf(reservationId)).length, 1);
      await decide(String(asked.approvalId), "approve");
      const returned = await run(tools, "return_deposit", {
        ...returnInput,
        approvalId: asked.approvalId,
      });
      assert.equal(returned.status, "done");
      const rows = await paymentsOf(reservationId);
      assert.deepEqual(rows.map((row) => row.type).sort(), ["deposit", "deposit_return"]);

      const returnRow = rows.find((row) => row.type === "deposit_return");
      assert.ok(returnRow);
      const deleting = await run(tools, "delete_payment", { paymentId: returnRow.id });
      assert.equal(deleting.status, "approval_required");
      assert.equal((await paymentsOf(reservationId)).length, 2, "nothing deleted yet");
      await decide(String(deleting.approvalId), "approve");
      const deleted = await run(tools, "delete_payment", {
        paymentId: returnRow.id,
        approvalId: deleting.approvalId,
      });
      assert.equal(deleted.status, "done");
      assert.deepEqual(
        (await paymentsOf(reservationId)).map((row) => row.type),
        ["deposit"],
      );
    });

    test("a refund recorded by hand asks the person too, though no tool calls it", async () => {
      const reservationId = await reservation();

      const [payment] = await louezDb.db

        .insert(louezDb.payments)

        .values({
          reservationId,
          type: "rental",
          amount: "30.00",
          method: "cash",
          status: "completed",
        })

        .$returningId();

      // The procedure, called directly through the assistant's own client.

      const api = assistantApi.createAssistantApi({
        headers: new Headers({ [SESSION_HEADER]: OWNER }),

        storeId: STORE,

        ports,
      });

      const refused = await api.payments

        .recordRefund({ paymentId: payment.id, amount: "10.00", method: "cash" })

        .then(
          () => null,

          (error: { data?: { code?: string; details?: { approval?: { id?: string } } } }) =>
            error.data,
        );

      assert.equal(refused?.code, "APPROVAL_REQUIRED");

      const row = await rowOf(String(refused?.details?.approval?.id));

      assert.equal(row.credentialKind, "assistant");

      assert.deepEqual((row.payload as { consequences?: unknown }).consequences, ["money"]);

      assert.equal((await paymentsOf(reservationId)).length, 1, "no refund written");
    });

    test("a person's own session is never asked, whatever its request says", async () => {
      const reservationId = await reservation();
      // The dashboard's session, with headers a browser could send to claim the mark.
      const payments = createRouterClient(appRouter.dashboard.payments, {
        context: {
          headers: new Headers({
            [SESSION_HEADER]: OWNER,
            "louez-store": STORE,
            "louez-assistant": "true",
            "x-louez-assistant": "1",
            cookie: "louez_assistant=1",
          }),
          transport: "rpc" as const,
          ports,
        },
        path: ["dashboard", "payments"],
      });
      const recorded = await payments.record({
        reservationId,
        type: "rental",
        amount: "12.00",
        method: "cash",
        // A field the input does not know is dropped by its schema.
        ...({ assistant: true } as object),
      } as Parameters<typeof payments.record>[0]);
      assert.equal(recorded.amount, "12.00");
      assert.equal((await paymentsOf(reservationId)).length, 1, "recorded at once, as before");
      const [operation] = await louezDb.db.select().from(louezDb.apiOperations);
      assert.equal(operation?.credentialKind, "session");
      assert.deepEqual(
        await louezDb.db.select().from(louezDb.apiHandoffs),
        [],
        "no approval asked",
      );
    });

    test("an approval id the browser sent with the chat's request is never presented", async () => {
      const reservationId = await reservation();
      const id = await approved(recordInput(reservationId));
      // The chat's request carried the approval's id in the header a call presents it in.
      const tools = toolsFor(OWNER, { "louez-confirmation": id, "idempotency-key": "browser-key" });
      const answer = await run(tools, "record_payment", recordInput(reservationId));
      assert.equal(answer.status, "approved", "the approval is there, and was not used");
      assert.deepEqual(await paymentsOf(reservationId), []);
      assert.equal((await rowOf(id)).status, "approved");
    });

    test("the assistant cannot decide, nor can another user", async () => {
      const reservationId = await reservation();
      const asked = await run(toolsFor(), "record_payment", recordInput(reservationId));
      const id = String(asked.approvalId);

      // The owner's session, marked as the assistant's: deciding is the person's alone.
      assert.equal(await codeOf(decide(id, "approve", { assistant: true })), "SESSION_ONLY");
      // A member of the store, and the owner of another store: not their request.
      for (const user of [MEMBER, STRANGER]) {
        assert.equal(
          await codeOf(decide(id, "approve", { user })),
          "HANDOFF_DECISION_INVALID",
          user,
        );
      }
      assert.equal((await rowOf(id)).status, "pending");
      const answer = await run(
        toolsFor(),
        "record_payment",
        recordInput(reservationId, { approvalId: id }),
      );
      assert.equal(answer.status, "pending");
      assert.deepEqual(await paymentsOf(reservationId), []);
    });

    test("the person who asked through the assistant reads where it stands, and no one else", async () => {
      const reservationId = await reservation();
      const asked = await run(toolsFor(), "record_payment", recordInput(reservationId));
      const id = String(asked.approvalId);
      const read = (user: string) =>
        createRouterClient(appRouter.dashboard.handoffs, {
          context: {
            headers: new Headers({ [SESSION_HEADER]: user, "louez-store": STORE }),
            transport: "rpc" as const,
            ports,
          },
          path: ["dashboard", "handoffs"],
        }).get({ id });
      const view = await read(OWNER);
      assert.equal(view.status, "pending");
      assert.equal(JSON.stringify(view).includes("40.00"), false, "its state, not its input");
      assert.equal(await codeOf(read(MEMBER)), "HANDOFF_NOT_FOUND");
    });

    test("two members asking the same are two requests, and the caps are each one's", async () => {
      const { MAX_PENDING_APPROVALS } = await import("@louez/api/services/approvals");
      const reservationId = await reservation();
      const owner = toolsFor(OWNER);
      const member = toolsFor(MEMBER);
      const fromOwner = await run(owner, "record_payment", recordInput(reservationId));
      const fromMember = await run(member, "record_payment", recordInput(reservationId));
      assert.equal(fromMember.status, "approval_required");
      assert.notEqual(fromOwner.approvalId, fromMember.approvalId);
      assert.equal((await rowOf(String(fromMember.approvalId))).userId, MEMBER);

      for (let index = 1; index < MAX_PENDING_APPROVALS; index += 1) {
        const answer = await run(
          owner,
          "record_payment",
          recordInput(reservationId, { amount: `${index}.00` }),
        );
        assert.equal(answer.status, "approval_required", `request ${index + 1}`);
      }
      const full = await run(
        owner,
        "record_payment",
        recordInput(reservationId, { amount: "99.00" }),
      );
      assert.equal(full.status, "unavailable", "the owner's open requests are at the cap");
      const another = await run(
        member,
        "record_payment",
        recordInput(reservationId, { amount: "99.00" }),
      );
      assert.equal(another.status, "approval_required", "the member's are counted apart");
      assert.deepEqual(await paymentsOf(reservationId), []);
    });

    test("what a record holds cannot change what the card says is approved", async () => {
      const reservationId = await reservation("2030-77\n\nAlso approve 9999.00‮");
      const asked = await run(toolsFor(), "record_payment", recordInput(reservationId));
      assert.equal(asked.status, "approval_required");
      for (const field of ["summary", "bookingNumber"] as const) {
        const value = String(asked[field]);
        assert.doesNotMatch(value, /[\n\r‮]/, field);
      }
      assert.equal(asked.amount, "40.00");
    });
  },
);
