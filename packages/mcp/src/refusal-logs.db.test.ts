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
 * The answer with the values a confirmation draws afresh for each call replaced, in
 * place, by their names: its token (random) and when it expires (the call's time plus
 * its life). Nothing else is normalised: every other byte, the preview's ids and
 * dates included, must be the same. An approval asked twice for one request is the
 * same approval, its id and link alike: only its expiry, set from the time of each
 * ask, is named (`withApprovalExpiryNamed`).
 */
function withConfirmationNamed(text: string, details: unknown): string {
  const named = (value: unknown, name: string, into: string) =>
    typeof value === "string" && value.length > 0 ? into.split(value).join(`<${name}>`) : into;
  const fields = details && typeof details === "object" ? details : {};
  const token = Reflect.get(fields, "confirmationToken");
  const expiresAt = Reflect.get(fields, "expiresAt");
  assert.equal(typeof token, "string", "a confirmation names its token");
  return named(expiresAt, "expiresAt", named(token, "confirmationToken", text));
}

/** The answer with an approval's expiry, set from the time of each ask, named in place. */
function withApprovalExpiryNamed(text: string): string {
  const parsed: unknown = JSON.parse(text);
  const expiresAt = ["json", "data", "details", "approval", "expiresAt"].reduce<unknown>(
    (value, key) => (value && typeof value === "object" ? Reflect.get(value, key) : undefined),
    parsed,
  );
  assert.equal(typeof expiresAt, "string", "an approval names when it expires");
  return text.split(String(expiresAt)).join("<expiresAt>");
}

/** The headers a caller acts on: its type, an authentication challenge, a wait, a limit. */
function meaningfulHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers.entries()].filter(([name]) =>
      /^(content-type|www-authenticate|retry-after|(x-)?ratelimit.*)$/i.test(name),
    ),
  );
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
    assert.equal(reference.status, logged.status);
    assert.deepEqual(meaningfulHeaders(logged), meaningfulHeaders(reference));
    const body = await logged.text();
    const referenceBody = await reference.text();
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    const detailsOf = (text: string) =>
      (JSON.parse(text) as { data: { details: unknown } }).data.details;
    assert.equal(
      withConfirmationNamed(body, detailsOf(body)),
      withConfirmationNamed(referenceBody, detailsOf(referenceBody)),
    );
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
    assert.equal(reference.status, logged.status);
    assert.deepEqual(meaningfulHeaders(logged), meaningfulHeaders(reference));
    const body = await logged.text();
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    assert.equal(withApprovalExpiryNamed(body), withApprovalExpiryNamed(await reference.text()));
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

    // A tool's result has no HTTP headers of its own: the whole result is compared. The
    // bridge always runs its interceptor; the reference differs by the log port alone.
    assert.equal(logged.isError, true);
    const body = JSON.stringify(logged);
    assert.match(body, new RegExp(`${FIRST_NAME} ${LAST_NAME}`), "the caller still reads it");
    const detailsOf = (result: ToolResult) =>
      (result.structuredContent as { error: { details: unknown } }).error.details;
    assert.equal(
      withConfirmationNamed(body, detailsOf(logged)),
      withConfirmationNamed(JSON.stringify(reference), detailsOf(reference)),
    );
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

  // What a caller writes into its own request: a record's key, an id field holding a
  // word, a string shaped as a token. None of it is Louez's to log.
  const RECORD_KEY = "Alice Martin +33612345678";
  const WORD_ID = "Alice_Martin";
  const TOKEN_SHAPED = "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5kL7nP9";
  const creation = (productId: string) => ({
    customer: { email: "alice@rl.test", firstName: "Alice", lastName: "Martin" },
    startDate: "2032-07-01T09:00:00+02:00",
    endDate: "2032-07-03T09:00:00+02:00",
    lines: [{ productId, quantity: 1, selectedAttributes: { [RECORD_KEY]: 42 } }],
    notifyCustomer: false,
  });
  const assertNothingOfTheCaller = (log: ReturnType<typeof capture>) => {
    const printed = log.printed();
    for (const words of ["Alice", "+33612345678", WORD_ID, TOKEN_SHAPED]) {
      assert.ok(!printed.includes(words), `${words} in ${printed}`);
    }
  };

  test("REST: a record's key, an echoed id and a token-shaped string never reach the log", async () => {
    const agent = await key();
    const log = capture();
    const invalid = await openApi(log.sink, "/reservations", creation("rl_product_0000000001"), {
      authorization: agent.authorization,
      "idempotency-key": "rl-key-1",
    });
    assert.equal(invalid.status, 400);
    for (const id of [WORD_ID, TOKEN_SHAPED]) {
      const missing = await openApi(
        log.sink,
        `/reservations/${id}/cancel`,
        {},
        {
          authorization: agent.authorization,
        },
      );
      assert.ok(missing.status >= 400 && missing.status < 500, String(missing.status));
    }
    assert.equal(log.refusals.length, 3, log.printed());
    // The field of the procedure's own schema is kept; nothing under it.
    assert.ok(log.refusals[0]?.issues?.includes("invalid_type at lines"), log.printed());
    assertNothingOfTheCaller(log);
  });

  test("RPC: a record's key, an echoed id and a token-shaped string never reach the log", async () => {
    const log = capture();
    const invalid = await rpc(
      log.sink,
      "dashboard.reservations.create",
      creation("rl_product_0000000001"),
    );
    assert.equal(invalid.status, 400);
    for (const id of [WORD_ID, TOKEN_SHAPED]) {
      const missing = await rpc(log.sink, "dashboard.reservations.cancel", { id });
      assert.ok(missing.status >= 400 && missing.status < 500, String(missing.status));
    }
    assert.equal(log.refusals.length, 3, log.printed());
    assert.ok(log.refusals[0]?.issues?.includes("invalid_type at lines"), log.printed());
    assertNothingOfTheCaller(log);
  });

  test("MCP: a record's key, an echoed id and a token-shaped string never reach the log", async () => {
    const agent = await key();
    const log = capture();
    const invalid = await mcpCall(log.sink.refusal, agent.authorization, "reservations_create", {
      ...creation("rl_product_0000000001"),
      idempotencyKey: "rl-key-2",
    });
    assert.equal(invalid.isError, true);
    for (const id of [WORD_ID, TOKEN_SHAPED]) {
      const missing = await mcpCall(log.sink.refusal, agent.authorization, "reservations_cancel", {
        id,
      });
      assert.equal(missing.isError, true);
    }
    assert.ok(log.refusals.length >= 2, log.printed());
    assertNothingOfTheCaller(log);
  });
});
