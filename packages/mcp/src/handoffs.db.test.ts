import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { StripeConnectClient } from "@louez/api/adapters/stripe-connect";
import type { BillingPort } from "@louez/api";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// Handoffs and the tools that start them, through the app's real router and
// the real MCP and OpenAPI handlers: their bundles, their listing by rights,
// the link in the tool's text, and the same status on both transports.
// Stripe and the billing service are fakes.

const OWNER = "hx_owner_user_000001";
const STORE = "hx_store_a_000000001";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;

const stripe: StripeConnectClient = {
  accounts: {
    create: async () => ({ id: "acct_hx" }),
    retrieve: async () => ({ type: "standard", country: "FR", charges_enabled: false }),
    createLoginLink: async () => ({ url: "https://connect.stripe.test/login" }),
  },
  accountLinks: { create: async () => ({ url: "https://connect.stripe.test/setup" }) },
};

const billing: BillingPort = {
  status: async () => ({
    billing: "legacy",
    mode: "pay_as_you_go",
    plan: null,
    offer: null,
    notice: null,
    payAsYouGo: null,
    card: null,
    invoices: [],
    service: null,
    cardSetupOpen: false,
    cardSetupBlocked: "not_billed_by_service",
  }),
  billedByService: async () => true,
  startCardSetup: async () => ({ ok: true, url: "https://checkout.stripe.test/c" }),
  finishCardSetup: async () => "pending",
};

describe("handoff tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let exposure: import("@louez/api/platform/exposure").Exposure;
  let openApi: (method: string, path: string, headers: Record<string, string>) => Promise<Response>;
  let connect: (authorization: string) => Promise<Client>;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    stripeConnect: () => stripe,
    billing,
  };

  before(async () => {
    database = await createTestDatabase("api_handoff_tools");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createOpenApiHandler, handleOpenApiRequest } =
      await import("@louez/api/platform/openapi");
    const { handleMcpRequest } = await import("./transports/http");
    exposure = createExposure(appRouter);

    const openApiHandler = createOpenApiHandler(exposure.router);
    openApi = async (method, path, headers) =>
      (await handleOpenApiRequest(
        openApiHandler,
        new Request(`http://louez.test/api/v1${path}`, { method, headers }),
        { ports },
      )) ?? new Response(null, { status: 404 });

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: { insertRecordedPayment: async () => undefined },
    };
    connect = async (authorization: string) => {
      const mcp = new Client({ name: "test", version: "0.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
          requestInit: { headers: { authorization } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      return mcp;
    };

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@hx.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Brest Surf",
      slug: "hx-brest-surf",
      settings: {
        reservationMode: "payment",
        advanceNoticeMinutes: 0,
        currency: "EUR",
        country: "FR",
      },
      onboardingCompleted: true,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: OWNER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const rights = (settings: "read" | "write", billingLevel: "none" | "read" | "write") =>
    ({
      reservations: "read",
      products: "none",
      customers: "none",
      categories: "none",
      payments: "none",
      analytics: "none",
      settings,
      billing: billingLevel,
    }) satisfies Permissions;

  async function key(permissions: Permissions) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Handoff agent",
      permissions,
    });
    return `Bearer ${created.key}`;
  }

  async function withClient<T>(authorization: string, run: (mcp: Client) => Promise<T>) {
    const mcp = await connect(authorization);
    try {
      return await run(mcp);
    } finally {
      await mcp.close();
    }
  }

  const output = (result: ToolResult) => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent as Json;
  };

  test("Stripe's tools are in the settings bundle, billing's in billing, handoffs_get in daily", async () => {
    const names = (prefix: string) =>
      exposure.procedures
        .filter((entry) => entry.path.startsWith(prefix))
        .map((entry) => [entry.meta.mcp.name, entry.meta.mcp.bundle])
        .sort();
    assert.deepEqual(names("dashboard.payments."), [
      ["payments_open_stripe_dashboard", "settings"],
      ["payments_start_stripe_onboarding", "settings"],
      ["payments_sync_stripe_status", "settings"],
    ]);
    assert.deepEqual(names("dashboard.billing."), [
      ["billing_get_status", "billing"],
      ["billing_start_card_setup", "billing"],
    ]);
    assert.deepEqual(names("dashboard.handoffs."), [
      ["handoffs_get", "daily"],
      ["handoffs_refresh", "daily"],
    ]);

    const { tools, instructions } = await withClient(
      await key(rights("write", "write")),
      async (mcp) => ({
        tools: (await mcp.listTools()).tools,
        instructions: mcp.getInstructions() ?? "",
      }),
    );
    const listed = tools.map((tool) => tool.name);
    for (const name of [
      "payments_start_stripe_onboarding",
      "payments_open_stripe_dashboard",
      "payments_sync_stripe_status",
      "billing_get_status",
      "billing_start_card_setup",
      "handoffs_get",
      "handoffs_refresh",
    ]) {
      assert.ok(listed.includes(name), name);
    }
    // Each start tool says it returns a link for the user, followed with
    // handoffs_get; the instructions say it shows where the step stands, so
    // the user need not report back, with no schedule.
    for (const name of ["payments_start_stripe_onboarding", "billing_start_card_setup"]) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      assert.match(description, /a link \(url\) for the user/);
      assert.match(description, /handoffs_get/);
    }
    assert.match(instructions, /a link for the user to open, as it is/);
    assert.match(instructions, /handoffs_get with its id then says where the step stands/);
    assert.match(instructions, /the user need not report back/);
    assert.match(instructions, /`confirming: true`[^\n]*handoffs_refresh asks the provider again/);

    // A read-only key reads where a step stands, and starts none.
    const reader = await withClient(await key(rights("read", "read")), async (mcp) =>
      (await mcp.listTools()).tools.map((tool) => tool.name),
    );
    assert.ok(reader.includes("handoffs_get"));
    assert.ok(!reader.includes("handoffs_refresh"), "settling a step is a write");
    assert.ok(reader.includes("billing_get_status"));
    assert.ok(!reader.includes("payments_start_stripe_onboarding"));
    assert.ok(!reader.includes("billing_start_card_setup"));
  });

  test("the start tool gives the link in its text, and both transports read the same status", async () => {
    const authorization = await key(rights("write", "read"));
    const result = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "payments_start_stripe_onboarding", arguments: {} }),
    );
    const started = output(result) as { url: string; handoff: Json & { id: string } };
    assert.ok(started.url.startsWith(`${TEST_APP_URL}/handoffs/`));
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    assert.match(text, /Link to send the user \(only they can finish this step\): /);
    assert.ok(text.includes(started.url));
    assert.ok(text.includes(`handoffs_get with id ${started.handoff.id}`));

    const viaMcp = output(
      await withClient(authorization, (mcp) =>
        mcp.callTool({ name: "handoffs_get", arguments: { id: started.handoff.id } }),
      ),
    );
    assert.equal(viaMcp.status, "pending");
    assert.equal(viaMcp.kind, "stripe_connect_onboarding");
    assert.equal(viaMcp.url, started.url, "the same link, as long as the step lasts");
    assert.equal(started.url, `${TEST_APP_URL}/handoffs/${started.handoff.id}`);

    const viaOpenApi = await openApi("GET", `/handoffs/${started.handoff.id}`, { authorization });
    assert.equal(viaOpenApi.status, 200);
    const body = (await viaOpenApi.json()) as Json;
    assert.equal(body.status, "pending");
    assert.equal(body.id, started.handoff.id);

    const billingStatus = await openApi("GET", "/billing", { authorization });
    assert.equal(billingStatus.status, 200);
    const status = (await billingStatus.json()) as { billing: string; cardSetup: Json };
    assert.equal(status.billing, "legacy");
    assert.deepEqual(status.cardSetup, { available: false, reason: "not_billed_by_service" });

    // Without billing write, the card setup is refused with the platform's code.
    const refused = await withClient(authorization, (mcp) =>
      mcp.callTool({ name: "billing_start_card_setup", arguments: {} }),
    );
    assert.equal(refused.isError, true);
    assert.equal(
      (refused.structuredContent as { error?: { code?: string } }).error?.code,
      "PERMISSION_DENIED",
    );
  });
});
