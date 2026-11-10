import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { Client as McpClient } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

import { openAiProfileProblem } from "./testing/openai-profile";

// What the Claude connectors directory and ChatGPT's app review check on every
// listed tool: a name of 64 characters at most, a title, a description, the
// three hints as explicit booleans, and, for ChatGPT, the OAuth scheme in
// `_meta` and the profile tool. Built without the database: listing a tool and
// a call refused before it runs read none.

// The app's router loads @louez/auth, which reads the database URL. Nothing connects.
process.env.DATABASE_URL ??= "mysql://unused:unused@127.0.0.1:1/unused";

const RESOURCE_METADATA = "https://app.louez.test/.well-known/oauth-protected-resource/api/mcp";

/** The hand-written tools, which predate the bridge: each must pass too. */
const LEGACY_TOOLS = [
  "check_availability",
  "create_customer",
  "delete_payment",
  "get_customer",
  "get_dashboard_stats",
  "get_product_performance",
  "get_revenue_report",
  "list_customers",
  "list_payments",
  "record_payment",
  "return_deposit",
  "update_customer",
];

type ListedTool = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

describe("MCP directory conformance", () => {
  let tools: ListedTool[];
  let instructions: string;
  let client: McpClient;
  let serverInfo: ReturnType<McpClient["getServerVersion"]>;

  before(async () => {
    const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
    const { appRouter } = await import("@louez/api/router");
    const { createExposure } = await import("@louez/api/platform/exposure");
    const { createMcpServer } = await import("./server");
    const { testRequestContext } = await import("./testing/request-context");
    const { addTool } = await import("./tool-registry");
    const { errorResult } = await import("./utils/errors");
    const { platformErrors } = await import("@louez/api/platform/errors");

    // An owner's OAuth grant with write rights on all their stores, every
    // bundle shown, lists every tool, stores_create included.
    const write = "write" as const;
    const key = testRequestContext({
      storeId: "store_conformance",
      userId: "user_conformance",
      permissions: {
        reservations: write,
        products: write,
        customers: write,
        categories: write,
        payments: write,
        analytics: "read",
        settings: write,
        online_store: write,
        integrations: write,
        team: write,
        billing: write,
      },
    });
    const ctx = {
      ...key,
      actor: {
        ...key.actor,
        credential: {
          ...key.actor.credential,
          kind: "oauth" as const,
          storeId: null,
          stores: null,
          scopes: { ...key.actor.credential.scopes!, stores: write },
        },
      },
      storeArgument: true,
      resourceMetadataUrl: RESOURCE_METADATA,
    };
    const server = createMcpServer(
      ctx,
      { insertRecordedPayment: async () => undefined },
      createExposure(appRouter).procedures,
    );
    // A call whose token expired after the request's check.
    addTool(server, ctx, {
      name: "test_expired_token",
      title: "Expired Token",
      description: "Answers as a call whose access token expired.",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      listed: false,
      call: async () => errorResult("test_expired_token", platformErrors.unauthenticated()),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "conformance", version: "0.0.0" });
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
    instructions = client.getInstructions() ?? "";
    serverInfo = client.getServerVersion();
  });

  test("lists the procedures and every hand-written tool", () => {
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(tools.length > 80, `only ${tools.length} tools listed`);
    for (const name of LEGACY_TOOLS) assert.ok(names.has(name), `${name} is listed`);
    assert.ok(names.has("account_get_profile"));
  });

  test("every callable tool is listed: no former name is served", async () => {
    // The names tools had before the bridge, once served as hidden aliases:
    // a directory may read an operation it cannot see as unreviewed.
    for (const name of [
      "archive_product",
      "calendar_overdue",
      "calendar_upcoming",
      "create_category",
      "create_product",
      "delete_category",
      "get_product",
      "get_reservation",
      "get_reservation_poll",
      "get_store_settings",
      "list_categories",
      "list_products",
      "list_reservations",
      "update_category",
      "update_product",
      "update_reservation_notes",
      "update_reservation_status",
      "update_store_info",
      "update_store_legal",
    ]) {
      await assert.rejects(client.callTool({ name, arguments: {} }), /not found/, name);
    }
  });

  test("every listed tool has a name, a title, a description and the three hints", () => {
    const problems: string[] = [];
    for (const tool of tools) {
      if (!/^[a-z][a-z0-9_]*$/.test(tool.name) || tool.name.length > 64) {
        problems.push(`${tool.name}: name`);
      }
      if (!tool.title?.trim()) problems.push(`${tool.name}: no title`);
      if (!tool.description?.trim()) problems.push(`${tool.name}: no description`);
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
        if (typeof tool.annotations?.[hint] !== "boolean") {
          problems.push(`${tool.name}: ${hint} is not an explicit boolean`);
        }
      }
      if (tool.annotations?.readOnlyHint && tool.annotations.destructiveHint) {
        problems.push(`${tool.name}: read-only and destructive`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("no description tells the model what to call or do", () => {
    // Imperatives the Claude directory refuses in a description: an order of
    // calls ("list them first", "then call"), a call to another tool or to
    // itself again, or a rule for the model. What a tool takes, returns and
    // refuses, and the first call's CONFIRMATION_REQUIRED, are facts.
    const IMPERATIVES = [
      /\b(?:call|use|run|invoke|check|list|read|fetch|look|upload|ask)\b[^.;:()]*\bfirst\b(?! call)/i,
      /\bthen\s+(?:call|use|send|pass|set|list|check|read|ask|show|tell|upload|poll|save)\b/i,
      /\b(?:call|use|invoke|try|poll)\s+(?:this tool|it again|again|[a-z]+_[a-z_]+)\b/i,
      /\b(?:do not|don't|you must|you should|make sure|never (?:open|ask|build|guess|call|use))\b/i,
      /\b(?:show|give|tell) (?:it|this|them) to the user\b/i,
    ];
    const hits = tools.flatMap((tool) =>
      IMPERATIVES.flatMap((pattern) => {
        const match = pattern.exec(tool.description ?? "");
        return match ? [`${tool.name}: "${match[0]}"`] : [];
      }),
    );
    assert.deepEqual(hits, []);
  });

  test("every listed tool declares OAuth, and the procedures their output", () => {
    for (const tool of tools) {
      assert.deepEqual(
        tool._meta?.securitySchemes,
        [{ type: "oauth2", scopes: [] }],
        `${tool.name}: securitySchemes`,
      );
    }
    const withoutOutput = tools
      .filter((tool) => !LEGACY_TOOLS.includes(tool.name) && tool.outputSchema?.type !== "object")
      .map((tool) => tool.name);
    assert.deepEqual(withoutOutput, []);
  });

  test("every tool's hints follow what it does, tool by tool", () => {
    // What each listed tool does: read, or what its write does to the data
    // already there (additive, overwrite, delete), then why it reaches outside
    // the user's Louez account: a customer message, a provider (Stripe, the
    // insurer, a registry), or what the public storefront shows.
    const EXPECTED: Record<string, string> = {
      account_get_profile: "read",
      billing_get_status: "read/provider",
      billing_start_card_setup: "overwrite/provider",
      categories_complete_image_upload: "additive",
      categories_create: "additive/public",
      categories_create_image_upload: "additive",
      categories_delete: "delete/public",
      categories_get: "read",
      categories_list: "read",
      categories_reorder: "overwrite/public",
      categories_update: "overwrite/public",
      // A new key each time; imageUrl makes Louez download a public image.
      categories_upload_image: "additive/provider",
      handoffs_get: "read",
      handoffs_refresh: "overwrite/provider",
      inbox_acknowledge: "overwrite",
      inbox_list: "read",
      jobs_get: "read",
      online_store_check_slug_availability: "read",
      online_store_complete_image_upload: "additive",
      online_store_create_image_upload: "additive",
      online_store_update: "overwrite/public",
      online_store_update_appearance: "overwrite/public",
      online_store_update_slug: "overwrite/public",
      online_store_upload_image: "additive/provider",
      payments_open_stripe_dashboard: "overwrite/provider",
      payments_start_stripe_onboarding: "overwrite/provider",
      payments_sync_stripe_status: "overwrite/provider",
      products_close_downtime: "overwrite/public",
      products_complete_image_upload: "additive",
      products_create: "additive/public",
      products_create_image_upload: "additive",
      products_create_seasonal_pricing: "additive/public",
      products_create_variant: "additive/public",
      products_create_variant_value: "overwrite/public",
      products_declare_downtime: "additive/public",
      products_delete: "delete/public",
      products_delete_downtime: "delete/public",
      products_delete_seasonal_pricing: "delete/public",
      products_delete_variant: "delete/public",
      products_delete_variant_value: "delete/public",
      products_duplicate: "additive",
      products_duplicate_seasonal_pricing: "additive/public",
      // The result replaces the photo on the product; it runs on AI providers.
      products_enhance_image: "overwrite/public",
      products_get: "read",
      products_get_activity: "read",
      products_get_reservation_timeline: "read",
      products_get_unit_history: "read",
      products_get_variant_usage: "read",
      products_list: "read",
      products_list_seasonal_pricings: "read",
      products_list_units: "read",
      products_list_variants: "read",
      products_reinstate_unit: "overwrite/public",
      products_remove_image_background: "overwrite/public",
      products_reorder: "overwrite/public",
      products_retire_unit: "overwrite/public",
      products_set_variant_active: "overwrite/public",
      products_update: "overwrite/public",
      products_update_downtime: "overwrite/public",
      products_update_seasonal_pricing: "overwrite/public",
      products_update_status: "overwrite/public",
      products_update_unit_details: "overwrite",
      products_update_variant: "overwrite/public",
      products_update_variant_value: "overwrite/public",
      products_upload_image: "additive/provider",
      products_use_image_version: "overwrite/public",
      products_withdraw_variant: "delete/public",
      reservations_cancel: "overwrite/provider",
      reservations_get: "read",
      reservations_get_planning_timeline: "read",
      reservations_list: "read",
      reservations_list_calendar_period: "read",
      reservations_list_overdue: "read",
      reservations_list_upcoming: "read",
      reservations_poll: "read",
      reservations_update_notes: "overwrite",
      reservations_update_status: "overwrite/customer",
      search_global: "read",
      settings_create_location: "additive/public",
      settings_get: "read",
      settings_get_legal_profile: "read",
      settings_search_company_registry: "read/provider",
      settings_set_location_active: "overwrite/public",
      settings_update_business_hours: "overwrite/public",
      settings_update_company: "overwrite/public",
      settings_update_delivery: "overwrite/public",
      settings_update_legal: "overwrite/public",
      settings_update_legal_profile: "overwrite/public",
      settings_update_location: "overwrite/public",
      settings_update_reservation_rules: "overwrite/public",
      settings_update_store_info: "overwrite/public",
      settings_update_taxes: "overwrite/public",
      stores_check_slug_availability: "read",
      stores_create: "additive",
      stores_get_launch_checklist: "read",
      stores_go_live: "overwrite/public",
      stores_list: "read",
      team_cancel_invitation: "overwrite",
      team_invite_member: "additive",
      team_list_invitations: "read",
      team_list_members: "read",
      team_remove_member: "delete",
      // The hand-written tools.
      check_availability: "read",
      create_customer: "additive",
      delete_payment: "delete",
      get_customer: "read",
      get_dashboard_stats: "read",
      get_product_performance: "read",
      get_revenue_report: "read",
      list_customers: "read",
      list_payments: "read",
      // A payment row added; nothing recorded before changes.
      record_payment: "additive",
      return_deposit: "additive",
      update_customer: "overwrite",
    };
    assert.deepEqual(tools.map((tool) => tool.name).sort(), Object.keys(EXPECTED).sort());
    const wrong = tools.flatMap((tool) => {
      const [effect, reach] = EXPECTED[tool.name].split("/");
      const expected = {
        readOnlyHint: effect === "read",
        destructiveHint: effect === "overwrite" || effect === "delete",
        openWorldHint: reach !== undefined,
      };
      const { readOnlyHint, destructiveHint, openWorldHint } = tool.annotations ?? {};
      const actual = { readOnlyHint, destructiveHint, openWorldHint };
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? []
        : [`${tool.name}: ${JSON.stringify(actual)}`];
    });
    assert.deepEqual(wrong, []);
  });

  test("the profile tool reads the account, with no argument", () => {
    const profile = tools.find((tool) => tool.name === "account_get_profile");
    assert.equal(profile?._meta?.["openai/profile"], true);
    assert.equal(profile?.annotations?.readOnlyHint, true);
    assert.deepEqual(Object.keys(profile?.inputSchema.properties ?? {}), []);
    // Its output schema takes what ChatGPT's profile takes: an account without
    // a name leaves it out, never null.
    const output = profile?.outputSchema as Record<string, unknown> | undefined;
    assert.deepEqual(output?.required, ["id"]);
    const validate = new AjvJsonSchemaValidator().getValidator(output ?? {});
    for (const sample of [{ id: "user_1" }, { id: "user_1", name: "Morgane" }]) {
      assert.equal(validate(sample).valid, true, JSON.stringify(sample));
      assert.equal(openAiProfileProblem(sample), null, JSON.stringify(sample));
    }
    for (const sample of [{ id: "user_1", name: null }, { id: "" }, { id: "user_1", email: 1 }]) {
      assert.equal(validate(sample).valid, false, JSON.stringify(sample));
      assert.notEqual(openAiProfileProblem(sample), null, JSON.stringify(sample));
    }
    const flagged = tools.filter((tool) => tool._meta?.["openai/profile"] === true);
    assert.deepEqual(
      flagged.map((tool) => tool.name),
      ["account_get_profile"],
    );
  });

  test("a call whose token expired asks the client to sign in again", async () => {
    const result = await client.callTool({ name: "test_expired_token", arguments: {} });
    assert.equal(result.isError, true);
    assert.deepEqual(result._meta?.["mcp/www_authenticate"], [
      `Bearer resource_metadata="${RESOURCE_METADATA}", error="invalid_token", error_description="The access token expired or was revoked. Sign in to Louez again."`,
    ]);
    // Any other failure is not fixed by signing in again; a bad argument is
    // structured, as a procedure's is.
    const refused = await client.callTool({
      name: "get_customer",
      arguments: { customerId: 42 },
    });
    assert.equal(refused.isError, true);
    assert.equal(refused._meta?.["mcp/www_authenticate"], undefined);
    assert.match(
      (refused.content as Array<{ text: string }>)[0].text,
      /code: INVALID_ARGUMENT\nretryable: false/,
    );
  });

  test("the server names itself, and its instructions start with the essentials", () => {
    assert.equal(serverInfo?.title, "Louez");
    assert.ok((serverInfo?.icons ?? []).length > 0);
    const essentials = instructions.slice(0, 512);
    assert.match(essentials, /^Louez runs rental stores/);
    assert.match(essentials, /`links`/);
    assert.match(essentials, /CONFIRMATION_REQUIRED/);
  });

  test("the instructions set no schedule and give the model no orders", () => {
    // A reviewer reads a cadence or a "never" aimed at the model as prompt
    // injection: the instructions say what tools do and what is enough.
    for (const pattern of [
      /\bevery \d+/i,
      /\b\d+ (?:seconds|minutes) to \d+/i,
      /\b(?:you must|you cannot|you should|make sure|always)\b/i,
      /\bnever (?:open|start|call|ask)\b/i,
    ]) {
      assert.doesNotMatch(instructions, pattern);
    }
    assert.match(instructions, /If the user asks you to keep an eye on the store/);
  });

  test("the essentials fit whatever the connection reaches", async () => {
    const { serverInstructions, INSTRUCTIONS_ESSENTIALS_MAX } = await import("./instructions");
    const { testRequestContext } = await import("./testing/request-context");
    const base = testRequestContext({
      storeId: "store_essentials",
      userId: "user_essentials",
      storeName: "A store whose name is as long as a name can be ".repeat(5),
      permissions: { reservations: "write", settings: "write" },
    });
    const oauth = {
      ...base,
      actor: {
        ...base.actor,
        credential: {
          ...base.actor.credential,
          kind: "oauth" as const,
          storeId: null,
          bundles: ["daily" as const],
        },
      },
    };
    const variants = {
      oneStore: base,
      severalStores: { ...oauth, multiStore: true, storeChosen: false, storeArgument: true },
      severalStoresOneNamed: { ...oauth, multiStore: true, storeArgument: true },
      noStore: { ...oauth, noStore: true, storeChosen: false, storeOnline: false },
    };
    for (const [name, ctx] of Object.entries(variants)) {
      const essentials = serverInstructions(ctx, ["daily"]).slice(0, INSTRUCTIONS_ESSENTIALS_MAX);
      assert.match(essentials, /^Louez runs rental stores/, name);
      assert.match(essentials, /never build or guess a Louez URL/, name);
      assert.match(essentials, /confirmationToken only once they agree\./, name);
      if (name === "severalStores" || name === "severalStoresOneNamed") {
        assert.match(essentials, /call stores_list first/, name);
      }
    }
  });

  test("the instructions name only the bundles that hold a tool", async () => {
    const { serverInstructions } = await import("./instructions");
    const { testRequestContext } = await import("./testing/request-context");
    const { appRouter } = await import("@louez/api/router");
    const { bundlesWithTools, createExposure } = await import("@louez/api/platform/exposure");
    const { MCP_BUNDLES } = await import("@louez/api/platform/meta");
    const base = testRequestContext({
      storeId: "store_bundles",
      userId: "user_bundles",
      permissions: { reservations: "write" },
    });
    const ctx = {
      ...base,
      actor: {
        ...base.actor,
        credential: { ...base.actor.credential, kind: "oauth" as const, bundles: ["daily" as const] },
      },
    };
    const named = (text: string) =>
      MCP_BUNDLES.filter((bundle) => new RegExp(`\\b${bundle} \\(`).test(text));

    // The app's: a bundle without a tool is neither listed nor offered.
    const withTools = bundlesWithTools(createExposure(appRouter).procedures);
    assert.deepEqual(named(serverInstructions(ctx, withTools)), withTools);

    // Once a bundle holds a tool, it is offered with the others.
    const text = serverInstructions(ctx, ["daily", "integrations"]);
    assert.match(text, /Tool bundles listed: daily \(/);
    assert.match(text, /Not listed: integrations \(connected services\)\./);
    assert.deepEqual(named(text), ["daily", "integrations"]);
  });
});
