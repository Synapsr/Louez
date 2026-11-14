import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import type { RecordedPayment, RecordedPaymentDraft } from "@louez/api/platform/ports";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@lb.test` } } : null;
        },
      },
    },
  },
});

// The six branches a person approves once pull request 7 switches them on
// (docs/architecture/api-and-agents.md, "Pull requests", 7), each run whole on
// its real procedure, with the switch turned on by this test alone: every
// check their helpers make runs with `money`, `stock_override` and
// `access_removed` live (`liveConsequences`, which `checkConfirmation`
// refuses in production), as `APPROVAL_LIVE` will hold them. Through the
// real OpenAPI handler of /api/v1 and the real MCP handler of /api/mcp, with
// an owner's API key; the person decides through the dashboard's RPC
// handler with their session, as the approval's page does.
//
// For each branch: the agent's call answers APPROVAL_REQUIRED with a link;
// the page reads the display, which holds the request's identity facts; the
// person approves; the same call presented with the approval writes once
// and completes it; presented again, nothing more is written. For each
// family (payments, team, a status change): a refusal by the person writes
// nothing; a store moved since the approval into a state the write refuses
// is refused, writes nothing, and leaves the approval approved; a dashboard
// session runs directly. A confirmation token sent back where a person's
// approval is required asks for the approval.

const LIVE = ["money", "stock_override", "access_removed"] as const;
/** The consequences live for every check: `LIVE`, or none for a test of the token flow. */
let live: readonly string[] = LIVE;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;
type Transport = "rest" | "mcp";

interface Answer {
  ok: boolean;
  status: number | null;
  code?: string;
  details?: Json & { approval?: { id: string; url: string; status: string } };
  body?: Json;
}

interface Seed {
  k: string;
  owner: string;
  memberUser: string;
  store: string;
  membership: string;
  invitation: string;
  open: string;
  pending: string;
  buffered: string;
  both: string;
  withOil: string;
  consumable: string;
  payment: string;
  keyId: string;
  authorization: string;
}

describe(
  "the six branches a person approves, end to end, with the switch on (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let hash: typeof import("@louez/api/platform/hash");
    let readApprovalPage: typeof import("@louez/api/services/approval-page").readApprovalPage;
    let OVERRIDES_SAID: typeof import("@louez/api/services/approval-presentations").OVERRIDES_SAID;
    let rest: (
      method: string,
      path: string,
      body: object | null,
      headers: Record<string, string>,
    ) => Promise<Response>;
    let mcp: (authorization: string, name: string, args: object) => Promise<ToolResult>;
    let rpc: (user: string, store: string, path: string, input: object) => Promise<unknown>;

    /** A stand-in for the app's writer: the row and the billing mark, in the caller's transaction. */
    const insertRecordedPayment = async (
      tx: import("@louez/db").Transaction,
      payment: RecordedPayment,
    ) => {
      await tx.insert(louezDb.payments).values({
        reservationId: payment.reservationId,
        amount: payment.amount,
        type: payment.type,
        method: payment.method,
        status: "completed",
        origin: payment.origin,
        notes: payment.notes,
        paidAt: payment.paidAt,
        currency: payment.facts.currency,
      });
      await louezDb.markReservation(tx, { id: payment.reservationId, storeId: payment.storeId });
    };

    /** A stand-in for the app's billing facts: the reservation's currency, else the store's; no gross, no share. */
    const recordedFacts = async (
      tx: import("@louez/db").Transaction,
      draft: RecordedPaymentDraft,
    ) => {
      const [row] = await tx
        .select({ currency: louezDb.reservations.currency })
        .from(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.id, draft.reservationId));
      return {
        currency: row?.currency ?? draft.storeSettings?.currency ?? "EUR",
        grossMinor: null,
        insuranceShareMinor: 0,
      };
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
      team: { collaboratorLimit: async () => 10, emailConfigured: () => true },
      paymentRecords: { facts: recordedFacts, insert: insertRecordedPayment },
    };

    before(async () => {
      database = await createTestDatabase("mcp_approval_branches");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      hash = await import("@louez/api/platform/hash");

      // The switch, for this test alone: the check as it is, with the three
      // consequences live, before any procedure is loaded.
      const confirmation: Record<string, unknown> =
        await import("@louez/api/platform/confirmation");
      const check = confirmation.checkConfirmation as (input: object) => unknown;
      mock.module(import.meta.resolve("@louez/api/platform/confirmation"), {
        namedExports: {
          ...confirmation,
          checkConfirmation: (input: object) => check({ ...input, liveConsequences: live }),
        },
      });

      ({ readApprovalPage } = await import("@louez/api/services/approval-page"));
      ({ OVERRIDES_SAID } = await import("@louez/api/services/approval-presentations"));
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { createOpenApiHandler, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");
      const { handleMcpRequest } = await import("./transports/http");
      const exposure = createExposure(appRouter);
      const openApiHandler = createOpenApiHandler(exposure.router);
      rest = async (method, path, body, headers) =>
        (await handleOpenApiRequest(
          openApiHandler,
          new Request(
            `http://louez.test/api/v1${path}`,
            body
              ? {
                  method,
                  headers: { "content-type": "application/json", ...headers },
                  body: JSON.stringify(body),
                }
              : { method, headers },
          ),
          { ports },
        )) ?? new Response(null, { status: 404 });
      const httpOptions = { ports, procedures: exposure.procedures };
      mcp = async (authorization, name, args) => {
        const client = new Client({ name: "test", version: "0.0.0" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
            requestInit: { headers: { authorization } },
            fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
          }),
        );
        try {
          return await client.callTool({ name, arguments: args as Json });
        } finally {
          await client.close();
        }
      };

      // RPC: the whole router, as /api/rpc serves it to the dashboard.
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { createORPCClient } = await import("@orpc/client");
      const { RPCLink } = await import("@orpc/client/fetch");
      const rpcHandler = new RPCHandler(appRouter);
      rpc = (user, store, path, input) => {
        const client = createORPCClient<
          Record<string, Record<string, Record<string, (input: object) => Promise<unknown>>>>
        >(
          new RPCLink({
            url: "http://louez.test/api/rpc",
            headers: { [SESSION_HEADER]: user, cookie: `louez_active_store=${store}` },
            fetch: async (request) => {
              const { response } = await rpcHandler.handle(request, {
                prefix: "/api/rpc",
                context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
              });
              return response ?? new Response(null, { status: 404 });
            },
          }),
        );
        const [a, b, c] = path.split(".") as [string, string, string];
        return client[a][b][c](input);
      };
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    let count = 0;
    /** A store of its own for each test: an owner and their key, a member, an invitation, two bookings. */
    async function seedStore(): Promise<Seed> {
      count += 1;
      const k = String(count).padStart(4, "0");
      const ids = {
        k,
        owner: `lb_owner_${k}`,
        memberUser: `lb_muser_${k}`,
        store: `lb_store_${k}`,
        membership: `lb_member_${k}`,
        invitation: `lb_invite_${k}`,
        open: `lb_open_${k}`,
        pending: `lb_pending_${k}`,
        buffered: `lb_buffer_${k}`,
        both: `lb_both_${k}`,
        withOil: `lb_oil_res_${k}`,
        consumable: `lb_consum_${k}`,
        payment: `lb_payment_${k}`,
      };
      const { db } = louezDb;
      await db.insert(louezDb.users).values([
        { id: ids.owner, email: `owner${k}@lb.test`, name: "Olga Owner" },
        { id: ids.memberUser, email: `lucas${k}@lb.test`, name: "Lucas Bernard" },
      ]);
      await db.insert(louezDb.stores).values({
        id: ids.store,
        userId: ids.owner,
        name: "Vélo Liberté",
        slug: `lb-store-${k}`,
        onboardingCompleted: true,
        settings: {
          reservationMode: "request" as const,
          currency: "EUR",
          timezone: "Europe/Paris",
          pendingBlocksAvailability: false,
          advanceNoticeMinutes: 0,
          minRentalMinutes: 0,
          turnoverBufferMinutes: 120,
        },
      });
      await db.insert(louezDb.storeMembers).values([
        { storeId: ids.store, userId: ids.owner, role: "owner" },
        { id: ids.membership, storeId: ids.store, userId: ids.memberUser, role: "member" },
      ]);
      await db.insert(louezDb.storeInvitations).values({
        id: ids.invitation,
        storeId: ids.store,
        email: `nina${k}@lb.test`,
        role: "member",
        token: `lb_invitation_token_${k}_000000000000`,
        invitedBy: ids.owner,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      });
      // No e-mail, no phone: no message goes, so a confirmation is a stock override alone.
      const customer = `lb_customer_${k}`;
      await db
        .insert(louezDb.customers)
        .values({ id: customer, storeId: ids.store, email: "", firstName: "Bo", lastName: "Ray" });
      const reservation = (
        id: string,
        number: string,
        status: "pending" | "confirmed",
        dates = { start: "2026-12-13T13:00:00.000Z", end: "2026-12-17T13:00:00.000Z" },
      ) =>
        db.insert(louezDb.reservations).values({
          id,
          storeId: ids.store,
          customerId: customer,
          number,
          status,
          startDate: new Date(dates.start),
          endDate: new Date(dates.end),
          subtotalAmount: "98.00",
          depositAmount: "300.00",
          totalAmount: "98.00",
          currency: "EUR",
        });
      await reservation(ids.open, `R-${k}1`, "confirmed");
      await db.insert(louezDb.payments).values([
        {
          reservationId: ids.open,
          amount: "300.00",
          type: "deposit",
          method: "card",
          status: "completed",
          currency: "EUR",
        },
        {
          id: ids.payment,
          reservationId: ids.open,
          amount: "80.00",
          type: "rental",
          method: "cash",
          status: "completed",
          currency: "EUR",
        },
      ]);
      // Two paddles asked of one: confirmed beyond the stock, on purpose.
      const product = (
        id: string,
        name: string,
        stockKind: "rental" | "consumable",
        quantity = 1,
      ) =>
        db.insert(louezDb.products).values({
          id,
          storeId: ids.store,
          name,
          price: "10.00",
          pricingMode: "day",
          quantity,
          ...(stockKind === "consumable" ? { stockKind } : {}),
        });
      const line = (reservationId: string, productId: string, name: string, quantity = 2) =>
        db.insert(louezDb.reservationItems).values({
          reservationId,
          productId,
          quantity,
          unitPrice: "49.00",
          depositPerUnit: "0.00",
          totalPrice: "98.00",
          productSnapshot: { name, description: null, images: [] },
        });
      await product(`lb_paddle_${k}`, "Paddle", "rental");
      await reservation(ids.pending, `R-${k}2`, "pending");
      await line(ids.pending, `lb_paddle_${k}`, "Paddle");
      // Two bottles of gas asked of one: a consumable no override passes.
      await product(`lb_gas_${k}`, "Gas bottle", "consumable");
      await reservation(ids.consumable, `R-${k}3`, "pending");
      await line(ids.consumable, `lb_gas_${k}`, "Gas bottle");
      // One kayak, held until an hour before by an earlier booking: free only
      // without the 120-minute turnover buffer.
      await product(`lb_kayak_${k}`, "Kayak", "rental");
      await reservation(`lb_earlier_${k}`, `R-${k}4`, "confirmed", {
        start: "2026-12-12T13:00:00.000Z",
        end: "2026-12-13T12:00:00.000Z",
      });
      await line(`lb_earlier_${k}`, `lb_kayak_${k}`, "Kayak", 1);
      await reservation(ids.buffered, `R-${k}5`, "pending");
      await line(ids.buffered, `lb_kayak_${k}`, "Kayak", 1);
      // Both: two paddles of one, and the kayak past the buffer.
      await reservation(ids.both, `R-${k}6`, "pending");
      await line(ids.both, `lb_paddle_${k}`, "Paddle");
      await line(ids.both, `lb_kayak_${k}`, "Kayak", 1);
      // Two paddles of one, and one can of oil of five: a consumable the stock covers.
      await product(`lb_oil_${k}`, "Oil can", "consumable", 5);
      await reservation(ids.withOil, `R-${k}7`, "pending");
      await line(ids.withOil, `lb_paddle_${k}`, "Paddle");
      await line(ids.withOil, `lb_oil_${k}`, "Oil can", 1);

      const created = await apiKeys.createApiKey({
        db,
        storeId: ids.store,
        userId: ids.owner,
        name: "Store agent",
        permissions: {
          reservations: "write",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "write",
          analytics: "read",
          settings: "read",
          team: "write",
        },
      });
      return { ...ids, keyId: created.id, authorization: `Bearer ${created.key}` };
    }

    interface Branch {
      name: string;
      family: "payments" | "team" | "status";
      procedure: string;
      tool: string;
      rest: (seed: Seed) => { method: string; path: string; body: object | null };
      args: (seed: Seed) => Json;
      /** The request's identity facts, as its presentation builds them. */
      facts: (seed: Seed) => Json;
      /** How many times its write ran: 0 before, 1 after. */
      written: (seed: Seed) => Promise<number>;
    }

    const paymentsOf = (seed: Seed, type: string) =>
      louezDb.db
        .select({ id: louezDb.payments.id, amount: louezDb.payments.amount })
        .from(louezDb.payments)
        .where(
          orm.and(
            orm.eq(louezDb.payments.reservationId, seed.open),
            orm.eq(louezDb.payments.type, type as "rental"),
          ),
        );
    const statusOf = async (id: string) =>
      (
        await louezDb.db
          .select({ status: louezDb.reservations.status })
          .from(louezDb.reservations)
          .where(orm.eq(louezDb.reservations.id, id))
      )[0]?.status;

    const BRANCHES: Branch[] = [
      {
        name: "A1, a payment recorded",
        family: "payments",
        procedure: "dashboard.payments.record",
        tool: "record_payment",
        rest: (seed) => ({
          method: "POST",
          path: `/reservations/${seed.open}/payments`,
          body: { type: "rental", amount: "120.00", method: "cash" },
        }),
        args: (seed) => ({
          reservationId: seed.open,
          type: "rental",
          amount: "120.00",
          method: "cash",
        }),
        facts: (seed) => ({
          reservation: seed.open,
          type: "rental",
          amount: "120.00",
          currency: "EUR",
          method: "cash",
        }),
        written: async (seed) =>
          (await paymentsOf(seed, "rental")).filter((row) => row.amount === "120.00").length,
      },
      {
        name: "A2, a deposit return recorded",
        family: "payments",
        procedure: "dashboard.payments.recordDepositReturn",
        tool: "record_deposit_return",
        rest: (seed) => ({
          method: "POST",
          path: `/reservations/${seed.open}/deposit-returns`,
          body: { amount: "150.00", method: "transfer" },
        }),
        args: (seed) => ({ reservationId: seed.open, amount: "150.00", method: "transfer" }),
        facts: (seed) => ({
          reservation: seed.open,
          amount: "150.00",
          currency: "EUR",
          method: "transfer",
        }),
        written: async (seed) => (await paymentsOf(seed, "deposit_return")).length,
      },
      {
        name: "A3, a payment deleted",
        family: "payments",
        procedure: "dashboard.payments.delete",
        tool: "delete_payment",
        rest: (seed) => ({ method: "DELETE", path: `/payments/${seed.payment}`, body: null }),
        args: (seed) => ({ paymentId: seed.payment }),
        facts: (seed) => ({ payment: seed.payment, amount: "80.00", currency: "EUR" }),
        written: async (seed) =>
          (await paymentsOf(seed, "rental")).some((row) => row.id === seed.payment) ? 0 : 1,
      },
      {
        name: "A4, a member removed",
        family: "team",
        procedure: "dashboard.team.removeMember",
        tool: "team_remove_member",
        rest: (seed) => ({
          method: "DELETE",
          path: `/team/members/${seed.membership}`,
          body: null,
        }),
        args: (seed) => ({ id: seed.membership }),
        facts: (seed) => ({ member: seed.membership }),
        written: async (seed) =>
          1 -
          (
            await louezDb.db
              .select({ id: louezDb.storeMembers.id })
              .from(louezDb.storeMembers)
              .where(orm.eq(louezDb.storeMembers.id, seed.membership))
          ).length,
      },
      {
        name: "A5, an invitation cancelled",
        family: "team",
        procedure: "dashboard.team.cancelInvitation",
        tool: "team_cancel_invitation",
        rest: (seed) => ({
          method: "POST",
          path: `/team/invitations/${seed.invitation}/cancel`,
          body: {},
        }),
        args: (seed) => ({ id: seed.invitation }),
        facts: (seed) => ({ invitation: seed.invitation }),
        written: async (seed) =>
          (
            await louezDb.db
              .select({ status: louezDb.storeInvitations.status })
              .from(louezDb.storeInvitations)
              .where(orm.eq(louezDb.storeInvitations.id, seed.invitation))
          )[0]?.status === "cancelled"
            ? 1
            : 0,
      },
      {
        name: "A6, a booking confirmed beyond the stock",
        family: "status",
        procedure: "dashboard.reservations.updateStatus",
        tool: "reservations_update_status",
        rest: (seed) => ({
          method: "POST",
          path: `/reservations/${seed.pending}/status`,
          body: { status: "confirmed", allowOverbooking: true },
        }),
        args: (seed) => ({ id: seed.pending, status: "confirmed", allowOverbooking: true }),
        facts: (seed) => ({
          reservation: seed.pending,
          status: "confirmed",
          overrides: ["stock"],
          message: null,
        }),
        written: async (seed) => ((await statusOf(seed.pending)) === "confirmed" ? 1 : 0),
      },
      {
        name: "A6b, a booking confirmed past the turnover buffer",
        family: "status",
        procedure: "dashboard.reservations.updateStatus",
        tool: "reservations_update_status",
        rest: (seed) => ({
          method: "POST",
          path: `/reservations/${seed.buffered}/status`,
          body: { status: "confirmed", overrideTurnoverBuffer: true },
        }),
        args: (seed) => ({ id: seed.buffered, status: "confirmed", overrideTurnoverBuffer: true }),
        facts: (seed) => ({
          reservation: seed.buffered,
          status: "confirmed",
          overrides: ["turnover_buffer"],
          message: null,
        }),
        written: async (seed) => ((await statusOf(seed.buffered)) === "confirmed" ? 1 : 0),
      },
      {
        name: "A6c, a booking confirmed beyond the stock and past the buffer",
        family: "status",
        procedure: "dashboard.reservations.updateStatus",
        tool: "reservations_update_status",
        rest: (seed) => ({
          method: "POST",
          path: `/reservations/${seed.both}/status`,
          body: { status: "confirmed", allowOverbooking: true, overrideTurnoverBuffer: true },
        }),
        args: (seed) => ({
          id: seed.both,
          status: "confirmed",
          allowOverbooking: true,
          overrideTurnoverBuffer: true,
        }),
        facts: (seed) => ({
          reservation: seed.both,
          status: "confirmed",
          overrides: ["stock", "turnover_buffer"],
          message: null,
        }),
        written: async (seed) => ((await statusOf(seed.both)) === "confirmed" ? 1 : 0),
      },
    ];
    const branch = (name: string) => {
      const found = BRANCHES.find((candidate) => candidate.name.startsWith(name));
      assert.ok(found, name);
      return found;
    };

    /** The branch's call as an agent makes it, on a transport, with an id or token presented or not. */
    async function send(
      transport: Transport,
      branch: Branch,
      seed: Seed,
      presented?: string,
    ): Promise<Answer> {
      if (transport === "rest") {
        const { method, path, body } = branch.rest(seed);
        const response = await rest(method, path, body, {
          authorization: seed.authorization,
          ...(presented ? { "louez-confirmation": presented } : {}),
        });
        const answer = (await response.json()) as Json & {
          data?: { code: string; details?: Answer["details"] };
        };
        return response.status === 200
          ? { ok: true, status: 200, body: answer }
          : {
              ok: false,
              status: response.status,
              code: answer.data?.code,
              details: answer.data?.details,
            };
      }
      const result = await mcp(seed.authorization, branch.tool, {
        ...branch.args(seed),
        ...(presented ? { confirmationToken: presented } : {}),
      });
      if (result.isError !== true)
        return { ok: true, status: null, body: result.structuredContent as Json };
      const error = (
        result.structuredContent as { error?: { code: string; details?: Answer["details"] } }
      ).error;
      return { ok: false, status: null, code: error?.code, details: error?.details };
    }

    /** Asks: the call must answer APPROVAL_REQUIRED with a link to the approval's page. */
    async function ask(transport: Transport, branch: Branch, seed: Seed) {
      const asked = await send(transport, branch, seed);
      assert.equal(asked.code, "APPROVAL_REQUIRED", `${branch.name}: ${JSON.stringify(asked)}`);
      if (transport === "rest") assert.equal(asked.status, 412);
      const approval = asked.details?.approval;
      assert.ok(approval, "the answer holds the approval");
      assert.equal(approval.url, `${TEST_APP_URL}/handoffs/${approval.id}`);
      assert.equal(asked.details?.confirmationToken, approval.id);
      return approval.id;
    }

    const rowOf = async (id: string) => {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id));
      assert.ok(row, `approval ${id}`);
      return row;
    };
    const approvalsOf = (seed: Seed) =>
      louezDb.db
        .select({ id: louezDb.apiHandoffs.id })
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.storeId, seed.store));
    const previewsOf = (seed: Seed) =>
      louezDb.db
        .select({ id: louezDb.apiConfirmations.id })
        .from(louezDb.apiConfirmations)
        .where(orm.eq(louezDb.apiConfirmations.storeId, seed.store));

    /** The person's answer on the approval's page: `handoffs.decide`, with their session, on RPC. */
    async function decide(seed: Seed, id: string, decision: "approve" | "refuse") {
      const row = await rowOf(id);
      await rpc(seed.owner, seed.store, "dashboard.handoffs.decide", {
        id,
        decision,
        revision: row.revision,
        shown: row.bindingHash,
        acknowledged: true,
      });
      assert.equal((await rowOf(id)).status, decision === "approve" ? "approved" : "failed");
    }

    /** Every primitive a value holds, as text. */
    const leaves = (value: unknown): string[] =>
      value === null || value === undefined
        ? []
        : typeof value === "object"
          ? Object.values(value).flatMap(leaves)
          : [String(value)];

    for (const transport of ["rest", "mcp"] as const) {
      for (const each of BRANCHES) {
        test(`${transport}, ${each.name}: asked, read, approved, carried out once`, async () => {
          const seed = await seedStore();
          const id = await ask(transport, each, seed);
          assert.equal(await each.written(seed), 0, "nothing was done yet");

          // The request's identity is the facts its presentation built.
          const row = await rowOf(id);
          assert.equal(row.status, "pending");
          assert.equal(
            row.subject,
            hash.sha256(
              hash.stableStringify({
                credential: ["api_key", seed.keyId],
                storeId: seed.store,
                procedure: each.procedure,
                facts: each.facts(seed),
              }),
            ),
          );
          // The page reads the display, which holds each identity fact: the
          // records by their ref, the overrides as the headline says them.
          const page = await readApprovalPage(id, seed.owner);
          assert.ok(page.ok, JSON.stringify(page));
          assert.equal(page.approval.state, "pending");
          assert.ok(page.approval.display, "the page shows the display");
          const stored = (row.payload as { display?: { headline: Json; facts: Json[] } }).display;
          assert.ok(stored);
          const headlineKey = String(stored.headline.key);
          const shown = new Set([
            ...[stored.headline, ...stored.facts].flatMap((line) => [
              ...leaves(line.values),
              ...(typeof line.ref === "string" ? [line.ref] : []),
            ]),
            ...(Object.hasOwn(OVERRIDES_SAID, headlineKey)
              ? OVERRIDES_SAID[headlineKey as keyof typeof OVERRIDES_SAID]
              : []),
          ]);
          for (const [name, value] of Object.entries(each.facts(seed))) {
            for (const leaf of leaves(value))
              assert.ok(shown.has(leaf), `${name} (${leaf}) is shown`);
          }

          await decide(seed, id, "approve");
          const done = await send(transport, each, seed, id);
          assert.equal(done.ok, true, JSON.stringify(done));
          assert.equal(await each.written(seed), 1, "written once");
          const completed = await rowOf(id);
          assert.equal(completed.status, "completed");
          assert.ok(completed.consumedOperationId);

          // Presented again: nothing more is written, and the approval stays completed.
          const again = await send(transport, each, seed, id);
          assert.equal(again.ok, false);
          if (each.family === "payments" && each.tool !== "delete_payment") {
            assert.equal(again.code, "APPROVAL_INVALID");
            assert.deepEqual(again.details, { reason: "used" });
          }
          assert.equal(await each.written(seed), 1, "nothing more");
          assert.equal((await rowOf(id)).status, "completed");
        });
      }
    }

    for (const name of ["A1", "A4", "A6"]) {
      test(`${name}: refused by the person, the call presented writes nothing, and is declined`, async () => {
        const each = branch(name);
        const seed = await seedStore();
        const id = await ask("rest", each, seed);
        await decide(seed, id, "refuse");
        const presented = await send("rest", each, seed, id);
        assert.equal(presented.code, "APPROVAL_DECLINED");
        assert.equal(presented.status, 409);
        assert.equal(await each.written(seed), 0);
        // Asked again within the hour: refused at once, as the plan says.
        const asked = await send("rest", each, seed);
        assert.equal(asked.code, "APPROVAL_RECENTLY_DECLINED");
        assert.equal(await each.written(seed), 0);
      });
    }

    /** Each family: a store moved, after the approval, into a state the write refuses. */
    const MOVED: Array<{ name: string; move: (seed: Seed) => Promise<unknown>; code: string }> = [
      {
        name: "A1",
        move: (seed) =>
          louezDb.db
            .update(louezDb.reservations)
            .set({ status: "cancelled" })
            .where(orm.eq(louezDb.reservations.id, seed.open)),
        code: "PAYMENT_RESERVATION_CLOSED",
      },
      {
        name: "A2",
        // The balance lowered below the return: 300 collected, 200 given back since.
        move: (seed) =>
          louezDb.db.insert(louezDb.payments).values({
            reservationId: seed.open,
            amount: "200.00",
            type: "deposit_return",
            method: "cash",
            status: "completed",
            currency: "EUR",
          }),
        code: "DEPOSIT_RETURN_EXCEEDS_BALANCE",
      },
      {
        name: "A4",
        move: (seed) =>
          louezDb.db
            .delete(louezDb.storeMembers)
            .where(orm.eq(louezDb.storeMembers.id, seed.membership)),
        code: "TEAM_MEMBER_NOT_FOUND",
      },
      {
        name: "A6",
        move: (seed) =>
          louezDb.db
            .update(louezDb.reservations)
            .set({ status: "cancelled" })
            .where(orm.eq(louezDb.reservations.id, seed.pending)),
        code: "RESERVATION_TRANSITION_NOT_ALLOWED",
      },
    ];
    for (const { name, move, code } of MOVED) {
      test(`${name}: approved, then refused by the store's own rule: nothing written, the approval still approved`, async () => {
        const each = branch(name);
        const seed = await seedStore();
        const id = await ask("rest", each, seed);
        await decide(seed, id, "approve");
        await move(seed);
        // What the move itself left (a return given back, a member gone), read before the call.
        const moved = await each.written(seed);
        const presented = await send("rest", each, seed, id);
        assert.equal(presented.code, code, JSON.stringify(presented));
        assert.equal(await each.written(seed), moved, "nothing written");
        const row = await rowOf(id);
        assert.equal(row.status, "approved");
        assert.equal(row.consumedOperationId, null);
      });
    }

    test("a confirmation token sent back where a person's approval is required asks for the approval", async () => {
      for (const each of BRANCHES) {
        const seed = await seedStore();
        for (const transport of ["rest", "mcp"] as const) {
          const answer = await send(transport, each, seed, "t".repeat(43));
          assert.equal(answer.code, "APPROVAL_REQUIRED", `${transport}, ${each.name}`);
        }
        assert.equal(await each.written(seed), 0);
        assert.deepEqual(await previewsOf(seed), [], "no token's preview is recorded");
      }
    });

    /** The confirmation over the stock of the booking with an oil can, as A6 asks it. */
    const withOil = (): Branch => ({
      ...branch("A6"),
      rest: (seed) => ({
        method: "POST",
        path: `/reservations/${seed.withOil}/status`,
        body: { status: "confirmed", allowOverbooking: true },
      }),
      args: (seed) => ({ id: seed.withOil, status: "confirmed", allowOverbooking: true }),
      written: async (seed) => ((await statusOf(seed.withOil)) === "confirmed" ? 1 : 0),
    });
    /** The oil line raised from one can to four: the dates, the total and the shortfalls stay as they were. */
    const raiseOil = (seed: Seed) =>
      louezDb.db
        .update(louezDb.reservationItems)
        .set({ quantity: 4 })
        .where(
          orm.and(
            orm.eq(louezDb.reservationItems.reservationId, seed.withOil),
            orm.eq(louezDb.reservationItems.productId, `lb_oil_${seed.k}`),
          ),
        );
    const oilLeft = async (seed: Seed) =>
      (
        await louezDb.db
          .select({ quantity: louezDb.products.quantity })
          .from(louezDb.products)
          .where(orm.eq(louezDb.products.id, `lb_oil_${seed.k}`))
      )[0]?.quantity;

    test("an override's approval binds the stock it takes: a consumable line raised since voids it", async () => {
      const seed = await seedStore();
      const each = withOil();
      const id = await ask("rest", each, seed);
      await decide(seed, id, "approve");
      await raiseOil(seed);
      const presented = await send("rest", each, seed, id);
      assert.equal(presented.code, "APPROVAL_INVALID", JSON.stringify(presented));
      assert.deepEqual(presented.details, { reason: "state_changed" });
      assert.equal(await each.written(seed), 0);
      assert.equal(await oilLeft(seed), 5, "no oil taken");
    });

    test("a status change's token binds the stock it takes: a line changed since answers CONFIRMATION_INVALID", async () => {
      live = [];
      try {
        const seed = await seedStore();
        const each = withOil();
        const asked = await send("rest", each, seed);
        assert.equal(asked.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
        await raiseOil(seed);
        const presented = await send("rest", each, seed, String(asked.details?.confirmationToken));
        assert.equal(presented.code, "CONFIRMATION_INVALID");
        assert.equal(await each.written(seed), 0);
        assert.equal(await oilLeft(seed), 5);
      } finally {
        live = LIVE;
      }
    });

    /**
     * The reviewer's wetsuit: a quote with one size-S line holding unit S,
     * on a product sold by size with one S and one L, both free. Returns the
     * branch that confirms it with `allowOverbooking`, and the change that
     * makes it size L holding unit L, the product, the quantity, the dates
     * and the amounts as they were.
     */
    async function wetsuit(seed: Seed) {
      const { db } = louezDb;
      const product = `lb_suit_${seed.k}`;
      const reservation = `lb_quote_${seed.k}`;
      const line = `lb_suit_line_${seed.k}`;
      const unit = (size: "S" | "L") => `lb_suit_${size}_${seed.k}`;
      await db.insert(louezDb.products).values({
        id: product,
        storeId: seed.store,
        name: "Wetsuit",
        price: "10.00",
        pricingMode: "day",
        quantity: 2,
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
      });
      for (const size of ["S", "L"] as const) {
        await db.insert(louezDb.productUnits).values({
          id: unit(size),
          productId: product,
          identifier: `${size}1`,
          attributes: { size },
          combinationKey: `size:${size}`,
        });
      }
      await db.insert(louezDb.reservations).values({
        id: reservation,
        storeId: seed.store,
        customerId: `lb_customer_${seed.k}`,
        number: `R-${seed.k}8`,
        status: "quote",
        startDate: new Date("2026-12-20T09:00:00.000Z"),
        endDate: new Date("2026-12-21T09:00:00.000Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        currency: "EUR",
      });
      await db.insert(louezDb.reservationItems).values({
        id: line,
        reservationId: reservation,
        productId: product,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        combinationKey: "size:S",
        selectedAttributes: { size: "S" },
        productSnapshot: { name: "Wetsuit", description: null, images: [] },
      });
      await db.insert(louezDb.reservationItemUnits).values({
        reservationItemId: line,
        productUnitId: unit("S"),
        identifierSnapshot: "S1",
      });
      const each: Branch = {
        ...branch("A6"),
        rest: () => ({
          method: "POST",
          path: `/reservations/${reservation}/status`,
          body: { status: "confirmed", allowOverbooking: true },
        }),
        args: () => ({ id: reservation, status: "confirmed", allowOverbooking: true }),
        written: async () => ((await statusOf(reservation)) === "confirmed" ? 1 : 0),
      };
      const toSizeL = async () => {
        await db
          .update(louezDb.reservationItems)
          .set({ combinationKey: "size:L", selectedAttributes: { size: "L" } })
          .where(orm.eq(louezDb.reservationItems.id, line));
        await db
          .update(louezDb.reservationItemUnits)
          .set({ productUnitId: unit("L"), identifierSnapshot: "L1" })
          .where(orm.eq(louezDb.reservationItemUnits.reservationItemId, line));
      };
      return { each, toSizeL };
    }

    /** The binding a token's preview was recorded with. */
    const bindingOf = async (token: unknown) =>
      (
        await louezDb.db
          .select({ bindingHash: louezDb.apiConfirmations.bindingHash })
          .from(louezDb.apiConfirmations)
          .where(orm.eq(louezDb.apiConfirmations.id, String(token)))
      )[0]?.bindingHash;

    test("the stock a status change binds names which: a line moved to another size and unit answers CONFIRMATION_INVALID", async () => {
      live = [];
      try {
        const seed = await seedStore();
        const { each, toSizeL } = await wetsuit(seed);
        const asked = await send("rest", each, seed);
        assert.equal(asked.code, "CONFIRMATION_REQUIRED", JSON.stringify(asked));
        // Read again, unchanged: the same binding.
        const again = await send("rest", each, seed);
        assert.equal(
          await bindingOf(again.details?.confirmationToken),
          await bindingOf(asked.details?.confirmationToken),
        );
        await toSizeL();
        const presented = await send("rest", each, seed, String(asked.details?.confirmationToken));
        assert.equal(presented.code, "CONFIRMATION_INVALID", JSON.stringify(presented));
        assert.equal(await each.written(seed), 0);
      } finally {
        live = LIVE;
      }
    });

    test("the stock an override's approval binds names which: a line moved to another size and unit voids it", async () => {
      const seed = await seedStore();
      const { each, toSizeL } = await wetsuit(seed);
      const id = await ask("rest", each, seed);
      await decide(seed, id, "approve");
      await toSizeL();
      const presented = await send("rest", each, seed, id);
      assert.equal(presented.code, "APPROVAL_INVALID", JSON.stringify(presented));
      assert.deepEqual(presented.details, { reason: "state_changed" });
      assert.equal(await each.written(seed), 0);
      assert.equal((await rowOf(id)).status, "failed");
    });

    /** Each payment write with its record's id sent in upper case. */
    const UPPER: Array<[string, (seed: Seed) => string]> = [
      ["A1", (seed) => `/reservations/${seed.open.toUpperCase()}/payments`],
      ["A2", (seed) => `/reservations/${seed.open.toUpperCase()}/deposit-returns`],
      ["A3", (seed) => `/payments/${seed.payment.toUpperCase()}`],
    ];
    for (const [name, path] of UPPER) {
      test(`${name}: refused, then asked again with the id in another case: the same request, cooled down`, async () => {
        const each = branch(name);
        const seed = await seedStore();
        const id = await ask("rest", each, seed);
        await decide(seed, id, "refuse");
        const upper: Branch = { ...each, rest: (s) => ({ ...each.rest(s), path: path(s) }) };
        const asked = await send("rest", upper, seed);
        assert.equal(asked.code, "APPROVAL_RECENTLY_DECLINED", JSON.stringify(asked));
        assert.equal((await approvalsOf(seed)).length, 1, "no other request opened");
        assert.equal(await each.written(seed), 0);
      });
    }

    /** The booking's customer, given an e-mail address: the confirmation sends them a message. */
    const reachable = (seed: Seed, email: string) =>
      louezDb.db
        .update(louezDb.customers)
        .set({ email })
        .where(orm.eq(louezDb.customers.id, `lb_customer_${seed.k}`));

    test("where a message goes is bound, never the request's identity, and shown in the details", async () => {
      const seed = await seedStore();
      const each = branch("A6");
      await reachable(seed, `bo${seed.k}@lb.test`);
      const id = await ask("rest", each, seed);
      const page = await readApprovalPage(id, seed.owner);
      assert.ok(page.ok);
      // The message's own entry says where it goes (the customer's group names them anyway).
      assert.ok(
        JSON.stringify(page.approval.preview?.details).includes(
          `{"label":"To","value":{"kind":"text","text":"bo${seed.k}@lb.test"}}`,
        ),
        JSON.stringify(page.approval.preview?.details),
      );
      await decide(seed, id, "refuse");
      // Another address: the same request, refused within the hour.
      await reachable(seed, `ray${seed.k}@lb.test`);
      const asked = await send("rest", each, seed);
      assert.equal(asked.code, "APPROVAL_RECENTLY_DECLINED", JSON.stringify(asked));
      assert.equal(await each.written(seed), 0);
    });

    test("an address changed since the approval voids it", async () => {
      const seed = await seedStore();
      const each = branch("A6");
      await reachable(seed, `bo${seed.k}@lb.test`);
      const id = await ask("rest", each, seed);
      await decide(seed, id, "approve");
      await reachable(seed, `ray${seed.k}@lb.test`);
      const presented = await send("rest", each, seed, id);
      assert.equal(presented.code, "APPROVAL_INVALID", JSON.stringify(presented));
      assert.deepEqual(presented.details, { reason: "state_changed" });
      assert.equal(await each.written(seed), 0);
    });

    test("a dashboard session is asked nothing: each of the six runs directly", async () => {
      const seed = await seedStore();
      const calls: Array<[string, string, object]> = [
        ["A1", "dashboard.payments.record", branch("A1").args(seed)],
        ["A2", "dashboard.payments.recordDepositReturn", branch("A2").args(seed)],
        ["A3", "dashboard.payments.delete", branch("A3").args(seed)],
        ["A4", "dashboard.team.removeMember", branch("A4").args(seed)],
        ["A5", "dashboard.team.cancelInvitation", branch("A5").args(seed)],
        ["A6", "dashboard.reservations.updateStatus", branch("A6").args(seed)],
      ];
      for (const [name, path, input] of calls) {
        await rpc(seed.owner, seed.store, path, input);
        assert.equal(await branch(name).written(seed), 1, name);
      }
      assert.deepEqual(await approvalsOf(seed), []);
      assert.deepEqual(await previewsOf(seed), []);
    });

    test("a consumable short is refused before anything is asked, whatever the override", async () => {
      const seed = await seedStore();
      for (const transport of ["rest", "mcp"] as const) {
        const each: Branch = {
          ...branch("A6"),
          rest: () => ({
            method: "POST",
            path: `/reservations/${seed.consumable}/status`,
            body: { status: "confirmed", allowOverbooking: true },
          }),
          args: () => ({ id: seed.consumable, status: "confirmed", allowOverbooking: true }),
        };
        const answer = await send(transport, each, seed);
        assert.equal(answer.code, "RESERVATION_ITEMS_UNAVAILABLE", JSON.stringify(answer));
      }
      assert.equal(await statusOf(seed.consumable), "pending");
      assert.deepEqual(await approvalsOf(seed), [], "nobody is asked");
    });

    /** The store's settings, changed as the settings page does. */
    async function changeSettings(seed: Seed, change: Json) {
      const [store] = await louezDb.db
        .select({ settings: louezDb.stores.settings })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, seed.store));
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...store?.settings, ...change } as never })
        .where(orm.eq(louezDb.stores.id, seed.store));
    }

    test("a reservation without a currency takes the store's: a change of it voids the approval", async () => {
      const seed = await seedStore();
      const each = branch("A2");
      await louezDb.db
        .update(louezDb.reservations)
        .set({ currency: null })
        .where(orm.eq(louezDb.reservations.id, seed.open));
      const id = await ask("rest", each, seed);
      await decide(seed, id, "approve");
      await changeSettings(seed, { currency: "CHF" });
      const presented = await send("rest", each, seed, id);
      // The currency is in the request's identity and in its binding: another request.
      assert.equal(presented.code, "APPROVAL_INVALID", JSON.stringify(presented));
      assert.equal(await each.written(seed), 0);
      assert.equal((await rowOf(id)).status, "approved");
    });

    test("a member's removal says, and binds, that it cancels their pending invitations", async () => {
      const seed = await seedStore();
      await louezDb.db.insert(louezDb.storeInvitations).values({
        storeId: seed.store,
        email: `lucas${seed.k}@lb.test`,
        role: "member",
        token: `lb_invitation_token_${seed.k}_111111111111`,
        invitedBy: seed.owner,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      });
      const id = await ask("rest", branch("A4"), seed);
      const page = await readApprovalPage(id, seed.owner);
      assert.ok(page.ok);
      const details = (page.approval.preview as { details?: Json } | null)?.details;
      assert.match(
        JSON.stringify(details),
        /\{"label":"Pending invitations cancelled","value":\{"kind":"number","value":1\}\}/,
      );
    });

    test("a payment's notes are shown in the preview's details, which the page reads", async () => {
      const seed = await seedStore();
      const each: Branch = {
        ...branch("A1"),
        rest: (s) => ({
          method: "POST",
          path: `/reservations/${s.open}/payments`,
          body: { type: "rental", amount: "120.00", method: "cash", notes: "Paid at the counter" },
        }),
      };
      const id = await ask("rest", each, seed);
      const page = await readApprovalPage(id, seed.owner);
      assert.ok(page.ok);
      assert.match(
        JSON.stringify(page.approval.preview),
        /\{"label":"Notes","value":\{"kind":"text","text":"Paid at the counter"\}\}/,
      );
    });
  },
);
