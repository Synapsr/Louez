import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { Client as McpClient } from "@modelcontextprotocol/client";

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

    // An owner's key over every domain lists every tool.
    const write = "write" as const;
    const ctx = {
      ...testRequestContext({
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
      }),
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

  test("no description tells the model to call another tool", () => {
    const names = tools.map((tool) => tool.name);
    const pointing = tools.flatMap((tool) =>
      names
        .filter((other) => other !== tool.name)
        .filter((other) =>
          new RegExp(`\\b(?:call|use|then|first with|upload one with)\\s+${other}\\b`, "i").test(
            tool.description ?? "",
          ),
        )
        .map((other) => `${tool.name} → ${other}`),
    );
    assert.deepEqual(pointing, []);
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

  test("the hints follow what each tool does", () => {
    const hints = (name: string) => {
      const { readOnlyHint, destructiveHint, openWorldHint } =
        tools.find((tool) => tool.name === name)?.annotations ?? {};
      return { readOnlyHint, destructiveHint, openWorldHint };
    };
    const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    assert.deepEqual(hints("reservations_list"), read);
    assert.deepEqual(hints("list_customers"), read);
    assert.deepEqual(hints("settings_search_company_registry"), { ...read, openWorldHint: true });
    assert.deepEqual(hints("categories_create"), { ...read, readOnlyHint: false });
    assert.deepEqual(hints("categories_delete"), {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    // Sends the customer the acceptance or the rejection.
    assert.deepEqual(hints("reservations_update_status"), {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    // Cancels the insurer's contract.
    assert.deepEqual(hints("reservations_cancel"), {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    assert.deepEqual(hints("payments_start_stripe_onboarding"), {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    for (const name of ["record_payment", "delete_payment", "return_deposit"]) {
      assert.deepEqual(hints(name), {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });
    }
  });

  test("the profile tool reads the account, with no argument", () => {
    const profile = tools.find((tool) => tool.name === "account_get_profile");
    assert.equal(profile?._meta?.["openai/profile"], true);
    assert.equal(profile?.annotations?.readOnlyHint, true);
    assert.deepEqual(Object.keys(profile?.inputSchema.properties ?? {}), []);
    const output = profile?.outputSchema as { required?: string[] } | undefined;
    assert.ok(output?.required?.includes("id"));
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
      const essentials = serverInstructions(ctx).slice(0, INSTRUCTIONS_ESSENTIALS_MAX);
      assert.match(essentials, /^Louez runs rental stores/, name);
      assert.match(essentials, /never build or guess a Louez URL/, name);
      assert.match(essentials, /confirmationToken only once they agree\./, name);
      if (name === "severalStores" || name === "severalStoresOneNamed") {
        assert.match(essentials, /call stores_list first/, name);
      }
    }
  });
});
