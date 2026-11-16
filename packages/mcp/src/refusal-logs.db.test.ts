import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import type { RefusalLogEvent, RequestLogSink } from "@louez/api/platform/refusal-log";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// A call refused with a preview, on each transport: the request log holds its code,
// its procedure, the store, who called and the ids it is about, never the preview's
// words, its message or a stack; and the caller's answer is what it was without the
// log. The preview of a cancellation names the customer, which the log never does.

const SESSION_HEADER = "x-test-session-user";
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@rl.test` } } : null;
        },
      },
    },
  },
});

const OWNER = "rl_owner_user_000001";
const STORE = "rl_store_a_000000001";
const CUSTOMER = "rl_customer_00000001";
/** The customer the previews name: never in a log. */
const FIRST_NAME = "Philomène";
const LAST_NAME = "Quertier-Vasseur";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

/** What a sink was given, as the log would print it. */
function capture() {
  const refusals: RefusalLogEvent[] = [];
  const faults: Error[] = [];
  const sink: RequestLogSink = {
    refusal: (event) => refusals.push(event),
    fault: (error) => faults.push(error),
  };
  const printed = () =>
    JSON.stringify({
      refusals,
      faults: faults.map((error) => ({ message: error.message, stack: error.stack })),
    });
  return { sink, refusals, faults, printed };
}

/**
 * The answer with the values each call draws afresh (its token, its approval and
 * their dates) replaced, in place, by their names: two answers to the same call
 * compare byte for byte.
 */
function sameBytes(text: string): string {
  let out = text;
  const visit = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (/token|^id$|url|At$/i.test(key) && value.length > 0) {
        out = out.split(value).join(`<${key}>`);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(JSON.parse(text), "");
  return out;
}

describe("refused calls in the request log (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let openApi: (
    log: RequestLogSink | null,
    path: string,
    body: object,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let rpc: (log: RequestLogSink | null, path: string, input: object) => Promise<Response>;
  let mcpCall: (
    log: ((event: RefusalLogEvent) => void) | null,
    authorization: string,
    name: string,
    args: object,
  ) => Promise<ToolResult>;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_refusal_logs");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { reportUnexpectedErrors } = await import("@louez/api/platform/error-reporting");
    const { logRefusals, logRequestError } = await import("@louez/api/platform/refusal-log");
    const { onError } = await import("@orpc/server");
    const { RPCHandler } = await import("@orpc/server/fetch");
    const { handleMcpRequest } = await import("./transports/http");
    const exposure = createExposure(appRouter);

    // As /api/v1 builds it, with the log or, as a reference, without any.
    openApi = async (log, path, body, headers) =>
      (await handleOpenApiRequest(
        createOpenApiHandler(exposure.router, log ? { log } : {}),
        new Request(`http://louez.test/api/v1${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
        { ports },
      )) ?? new Response(null, { status: 404 });

    // As /api/rpc builds it: the assistant acting for the owner's session.
    rpc = async (log, path, input) => {
      const handler = log
        ? new RPCHandler(appRouter, {
            clientInterceptors: [reportUnexpectedErrors, logRefusals(log.refusal)],
            interceptors: [onError(logRequestError(log))],
          })
        : new RPCHandler(appRouter);
      const request = new Request(`http://louez.test/api/rpc/${path.split(".").join("/")}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SESSION_HEADER]: OWNER,
          cookie: `louez_active_store=${STORE}`,
        },
        body: JSON.stringify({ json: input }),
      });
      const { response } = await handler.handle(request, {
        prefix: "/api/rpc",
        context: {
          headers: request.headers,
          transport: "rpc",
          ports,
          receipt: {},
          assistant: true,
        },
      });
      return response ?? new Response(null, { status: 404 });
    };

    // As /api/mcp serves it: the bridge logs through the app's port.
    mcpCall = async (log, authorization, name, args) => {
      const httpOptions = {
        ports: log ? { ...ports, log: { error: () => {}, refusal: log } } : ports,
        procedures: exposure.procedures,
      };
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      try {
        return await mcp.callTool({ name, arguments: args as Json });
      } finally {
        await mcp.close();
      }
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rl.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Log store", slug: "rl-store-a" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "philomene@rl.test",
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function key() {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Log agent",
      permissions: {
        reservations: "write",
        products: "read",
        customers: "read",
        categories: "read",
        payments: "read",
        analytics: "read",
        settings: "read",
      },
    });
    return { id: created.id, authorization: `Bearer ${created.key}` };
  }

  let counter = 0;
  async function reservation(status: "pending" | "confirmed" = "confirmed") {
    const id = `rl_res_${String(++counter).padStart(14, "0")}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: `2032-${String(counter).padStart(4, "0")}`,
      status,
      startDate: new Date("2032-06-01T09:00:00Z"),
      endDate: new Date("2032-06-03T09:00:00Z"),
      subtotalAmount: "20.00",
      depositAmount: "0.00",
      totalAmount: "20.00",
    });
    return id;
  }

  /** The log holds the code, where, who and the reservation's id, and none of the preview. */
  function assertLogged(
    log: ReturnType<typeof capture>,
    expected: { code: string; procedure: string; actorId: string; reservationId: string },
  ) {
    assert.equal(log.faults.length, 0, log.printed());
    assert.equal(log.refusals.length, 1, log.printed());
    const [event] = log.refusals;
    assert.equal(event?.code, expected.code);
    assert.equal(event?.procedure, expected.procedure);
    assert.equal(event?.storeId, STORE);
    assert.equal(event?.actorId, expected.actorId);
    assert.ok(
      Object.values(event?.ids ?? {}).includes(expected.reservationId),
      `the reservation's id: ${log.printed()}`,
    );
    const printed = log.printed();
    for (const words of [FIRST_NAME, LAST_NAME, "reservation #", "20.00"]) {
      assert.ok(!printed.includes(words), `${words} in ${printed}`);
    }
  }

  test("REST: a cancellation asked for confirmation is logged by its code and ids, its answer unchanged", async () => {
    const agent = await key();
    const id = await reservation();
    const log = capture();
    const logged = await openApi(
      log.sink,
      `/reservations/${id}/cancel`,
      {},
      {
        authorization: agent.authorization,
      },
    );
    const reference = await openApi(
      null,
      `/reservations/${id}/cancel`,
      {},
      {
        authorization: agent.authorization,
      },
    );

    assert.equal(logged.status, 412);
    const body = await logged.text();
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    assert.equal(sameBytes(body), sameBytes(await reference.text()));
    assert.equal(reference.status, logged.status);
    assertLogged(log, {
      code: "CONFIRMATION_REQUIRED",
      procedure: "dashboard.reservations.cancel",
      actorId: agent.id,
      reservationId: id,
    });
    // The token that carries the call out is the caller's alone.
    const { data } = JSON.parse(body) as { data: { details: { confirmationToken: string } } };
    assert.ok(!log.printed().includes(data.details.confirmationToken), log.printed());
  });

  test("RPC: the assistant's confirmation over the stock asked for approval is logged by its code and ids, its answer unchanged", async () => {
    const id = await reservation("pending");
    const log = capture();
    const input = { id, status: "confirmed", allowOverbooking: true };
    const logged = await rpc(log.sink, "dashboard.reservations.updateStatus", input);
    const reference = await rpc(null, "dashboard.reservations.updateStatus", input);

    assert.equal(logged.status, 412);
    const body = await logged.text();
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    assert.equal(sameBytes(body), sameBytes(await reference.text()));
    assertLogged(log, {
      code: "APPROVAL_REQUIRED",
      procedure: "dashboard.reservations.updateStatus",
      actorId: OWNER,
      reservationId: id,
    });
  });

  test("MCP: a cancellation asked for confirmation is logged by its code and ids, its answer unchanged", async () => {
    const agent = await key();
    const id = await reservation();
    const log = capture();
    const logged = await mcpCall(log.sink.refusal, agent.authorization, "reservations_cancel", {
      id,
    });
    const reference = await mcpCall(null, agent.authorization, "reservations_cancel", { id });

    assert.equal(logged.isError, true);
    const body = JSON.stringify(logged);
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    assert.equal(sameBytes(body), sameBytes(JSON.stringify(reference)));
    assertLogged(log, {
      code: "CONFIRMATION_REQUIRED",
      procedure: "dashboard.reservations.cancel",
      actorId: agent.id,
      reservationId: id,
    });
  });

  test("a refusal that is not a preview is logged by its code, and a validation error by its issues' codes", async () => {
    const agent = await key();
    const log = capture();
    const missing = await openApi(
      log.sink,
      `/reservations/rl_res_unknown_000001/cancel`,
      {},
      {
        authorization: agent.authorization,
      },
    );
    assert.equal(missing.status, 404);
    const invalid = await rpc(log.sink, "dashboard.reservations.cancel", {
      id: `${FIRST_NAME} ${LAST_NAME}`.repeat(5),
    });
    assert.ok(invalid.status >= 400 && invalid.status < 500, String(invalid.status));
    assert.equal(log.faults.length, 0, log.printed());
    assert.equal(log.refusals.length, 2, log.printed());
    assert.ok(!log.printed().includes(FIRST_NAME), log.printed());
  });
});
