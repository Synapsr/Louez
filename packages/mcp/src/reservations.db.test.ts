import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// The reservation follow-up tools, through the app's real router and the
// real MCP and OpenAPI handlers: what an agent sees in the daily bundle, the
// former tool names kept as aliases, and the confirmation of a status change.

const OWNER = "rt_owner_user_000001";
const STORE = "rt_store_a_000000001";
const CUSTOMER = "rt_customer_00000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

describe("reservation tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let orm: typeof import("drizzle-orm");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
  let mcpTools: (authorization: string) => Promise<string[]>;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  before(async () => {
    database = await createTestDatabase("api_reservation_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    orm = await import("drizzle-orm");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { handleMcpRequest } = await import("./transports/http");
    exposure = createExposure(appRouter);

    const openApiHandler = createOpenApiHandler(exposure.router, { docs: false });
    openApi = async (method, path, body, headers) =>
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

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: {
        insertRecordedPayment: async () => undefined,
      },
    };
    const connect = async (authorization: string) => {
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      return mcp;
    };
    mcpCall = async (authorization, name, args) => {
      const mcp = await connect(authorization);
      try {
        return await mcp.callTool({ name, arguments: args as Json });
      } finally {
        await mcp.close();
      }
    };
    mcpTools = async (authorization) => {
      const mcp = await connect(authorization);
      try {
        return (await mcp.listTools()).tools.map((tool) => tool.name);
      } finally {
        await mcp.close();
      }
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rt.test" });
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: OWNER, name: "Tools store", slug: "rt-store-a" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@rt.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const readOnly: Permissions = {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function key(permissions: Permissions = { ...readOnly, reservations: "write" }) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Reservations agent",
      permissions,
    });
    return `Bearer ${created.key}`;
  }

  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };
  const toolError = (result: ToolResult) =>
    (result.structuredContent as { error?: { code?: string } } | undefined)?.error;
  const tokenOf = (result: ToolResult) => {
    const error = toolError(result) as { code?: string; details?: { confirmationToken?: string } };
    assert.equal(error?.code, "CONFIRMATION_REQUIRED", JSON.stringify(result.content));
    return error.details?.confirmationToken ?? "";
  };

  let counter = 0;
  async function reservation(status: "pending" | "confirmed" | "ongoing", endDate?: Date) {
    const id = `rt_res_${String(++counter).padStart(14, "0")}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: `2030-${String(counter).padStart(4, "0")}`,
      status,
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: endDate ?? new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "20.00",
      depositAmount: "0.00",
      totalAmount: "20.00",
    });
    return id;
  }

  const statusOf = async (id: string) =>
    (
      await louezDb.db.query.reservations.findFirst({
        where: orm.eq(louezDb.reservations.id, id),
        columns: { status: true },
      })
    )?.status;

  test("every follow-up tool is in the daily bundle, and the former names are not listed", async () => {
    const tools = exposure.procedures.filter(
      (entry) =>
        entry.path.startsWith("dashboard.reservations.") ||
        entry.path === "dashboard.search.global",
    );
    assert.deepEqual(tools.map((entry) => entry.meta.mcp.name).sort(), [
      "reservations_cancel",
      "reservations_get",
      "reservations_get_planning_timeline",
      "reservations_list",
      "reservations_list_calendar_period",
      "reservations_list_overdue",
      "reservations_list_upcoming",
      "reservations_poll",
      "reservations_update_notes",
      "reservations_update_status",
      "search_global",
    ]);
    assert.deepEqual([...new Set(tools.map((entry) => entry.meta.mcp.bundle))], ["daily"]);
    const aliases = tools.flatMap((entry) =>
      (entry.meta.mcp.aliases ?? []).map((alias) => alias.name),
    );
    assert.deepEqual(aliases.sort(), [
      "calendar_overdue",
      "calendar_upcoming",
      "get_reservation",
      "get_reservation_poll",
      "list_reservations",
      "update_reservation_notes",
      "update_reservation_status",
    ]);

    const writer = await mcpTools(await key());
    for (const tool of tools) {
      assert.ok(writer.includes(tool.meta.mcp.name), `${tool.meta.mcp.name} is listed`);
    }
    for (const alias of aliases) assert.ok(!writer.includes(alias), `${alias} is not listed`);
    // check_availability stays a hand-written tool until lot 2b.
    assert.ok(writer.includes("check_availability"));

    const reader = await mcpTools(await key(readOnly));
    assert.ok(reader.includes("reservations_get"));
    assert.ok(
      !reader.includes("reservations_update_status"),
      "a read-only key does not see writes",
    );
  });

  test("the former tool names still work with their former arguments", async () => {
    const authorization = await key();
    const pending = await reservation("pending");
    const late = await reservation("ongoing", new Date(Date.now() - 2 * 86_400_000));

    const listed = output(await mcpCall(authorization, "list_reservations", { pageSize: 10 }));
    assert.ok((listed.items as Json[]).some((item) => item.id === pending));

    const got = output(await mcpCall(authorization, "get_reservation", { reservationId: pending }));
    assert.equal(got.id, pending);
    assert.equal((got.customer as Json).firstName, "Ada");

    const poll = output(await mcpCall(authorization, "get_reservation_poll", {}));
    assert.equal(poll.pendingCount, 1);

    const overdue = output(await mcpCall(authorization, "calendar_overdue", {}));
    assert.deepEqual(
      (overdue.items as Json[]).map((item) => item.id),
      [late],
    );
    output(await mcpCall(authorization, "calendar_upcoming", { days: 7 }));

    const notes = output(
      await mcpCall(authorization, "update_reservation_notes", {
        reservationId: pending,
        notes: "Call before",
      }),
    );
    assert.equal(notes.internalNotes, "Call before");

    // A rejection emails the customer: it waits for the confirmation, under the old name too.
    const first = await mcpCall(authorization, "update_reservation_status", {
      reservationId: pending,
      status: "rejected",
    });
    const token = tokenOf(first);
    assert.equal(await statusOf(pending), "pending");
    const rejected = output(
      await mcpCall(authorization, "update_reservation_status", {
        reservationId: pending,
        status: "rejected",
        confirmationToken: token,
      }),
    );
    assert.equal(rejected.to, "rejected");
    assert.equal(await statusOf(pending), "rejected");
  });

  test("the follow-up is served at its REST paths", async () => {
    const authorization = await key();
    const id = await reservation("confirmed");
    const headers = { authorization };

    for (const path of [
      "/reservations",
      `/reservations/${id}`,
      "/reservations/counters",
      "/reservations/upcoming",
      "/reservations/overdue",
      "/reservations/calendar?from=2030-06-01T00:00:00Z&to=2030-06-30T00:00:00Z",
      "/reservations/planning?from=2030-06-01T00:00:00Z&to=2030-06-30T00:00:00Z",
      "/search?query=2030",
    ]) {
      const response = await openApi("GET", path, null, headers);
      assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    }
    const counters = (await (
      await openApi("GET", "/reservations/counters", null, headers)
    ).json()) as Json;
    assert.equal(typeof counters.pendingCount, "number", "counters is not read as an id");

    const pickedUp = await openApi(
      "POST",
      `/reservations/${id}/status`,
      { status: "ongoing" },
      headers,
    );
    assert.equal(pickedUp.status, 200, await pickedUp.clone().text());
    assert.equal(await statusOf(id), "ongoing");

    const cancel = await openApi("POST", `/reservations/${id}/cancel`, {}, headers);
    assert.equal(cancel.status, 412, "a cancellation waits for the confirmation");
    assert.equal(await statusOf(id), "ongoing");

    const missing = await openApi("GET", "/reservations/rt_missing", null, headers);
    assert.equal(missing.status, 404);
  });
  test("a reservation tool's answer carries its links, on their own line too", async () => {
    const authorization = await key();
    const id = await reservation("pending");
    const dashboard = `${TEST_APP_URL}/dashboard/reservations/${id}?store=${STORE}`;
    const got = await mcpCall(authorization, "reservations_get", { id });
    const detail = output(got) as { links: Json; customer: { links: Json } | null };
    assert.deepEqual(detail.links, { dashboard });
    assert.deepEqual(detail.customer?.links, {
      dashboard: `${TEST_APP_URL}/dashboard/customers/${CUSTOMER}?store=${STORE}`,
    });
    const [text] = got.content as Array<{ type: string; text: string }>;
    assert.ok(text.text.includes(`Links to give the user: dashboard ${dashboard}.`), text.text);

    // Without customers read, the customer and its link are left out.
    const blind = await key({ ...readOnly, customers: "none" });
    const redacted = JSON.stringify(output(await mcpCall(blind, "reservations_get", { id })));
    assert.ok(!redacted.includes(CUSTOMER), redacted.slice(0, 300));
    assert.ok(redacted.includes(dashboard));
  });
});
