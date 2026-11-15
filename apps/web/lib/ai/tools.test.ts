import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, mock, test } from "node:test";
import { pathToFileURL } from "node:url";

import type { z } from "zod";

import { createTestUrls } from "@louez/api/platform/test-urls";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

import type { AIChatContext, createAITools } from "./tools";

// The in-app assistant does not write money: recording a payment, deleting
// one and recording a deposit return are done by a person on the
// reservation's page, or by an agent through a person's approval. Every tool
// runs here with each of its parameters filled, against an API that notes
// each procedure called and a database that notes each table written: none
// may be a procedure that writes payments, nor the payments table.

closeNetworkForSuite();

// The status-change module the tools import pulls in "server-only"; the
// router reads the session through "@louez/auth", which no call reaches here.
const directory = mkdtempSync(join(tmpdir(), "louez-ai-tools-"));
const authStubPath = join(directory, "auth.mjs");
writeFileSync(
  authStubPath,
  "export const auth = {}; export const mcpOAuth = null; export const authInstance = {};",
);
after(() => rmSync(directory, { recursive: true }));
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
    if (specifier === "@louez/auth") {
      return { url: pathToFileURL(authStubPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

type Tools = ReturnType<typeof createAITools>;
type AnyTool = {
  inputSchema: z.ZodType;
  execute?: (input: unknown, options: { toolCallId: string; messages: [] }) => unknown;
};

/** A value for every parameter of a tool, optional ones included. */
function sampleOf(schema: z.ZodType, description?: string): unknown {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })
    ._zod.def;
  const said = (schema as { description?: string }).description ?? description;
  switch (def.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(def.shape as Record<string, z.ZodType>).map(([key, field]) => [
          key,
          sampleOf(field),
        ]),
      );
    case "optional":
    case "nullable":
    case "default":
      return sampleOf(def.innerType as z.ZodType, said);
    case "array":
      return [sampleOf(def.element as z.ZodType)];
    case "enum":
      return Object.values(def.entries as Record<string, string>)[0];
    case "literal":
      return (def.values as unknown[])[0];
    case "union":
      return sampleOf((def.options as z.ZodType[])[0]!, said);
    case "number":
      return 1;
    case "boolean":
      return true;
    case "string":
      if (def.format === "email") return "owner@example.com";
      return said?.includes("YYYY-MM-DD") ? "2027-03-01" : "sample";
    default:
      throw new Error(`No sample for a ${def.type} parameter: add one here.`);
  }
}

/** Every procedure of a router, by its path. */
function proceduresOf(router: object, path: string[] = []): [string, { meta?: unknown }][] {
  return Object.entries(router).flatMap(([key, value]) => {
    if (value && typeof value === "object" && "~orpc" in value) {
      return [[[...path, key].join("."), (value as { "~orpc": { meta?: unknown } })["~orpc"]]];
    }
    return value && typeof value === "object" ? proceduresOf(value, [...path, key]) : [];
  });
}

describe("the in-app assistant writes no payment", () => {
  /** `dashboard.<domain>.<procedure>`, each procedure a tool called. */
  const called: string[] = [];
  /** The database's write calls on the payments table. */
  const paymentTableWrites: string[] = [];
  /** The procedures whose scope is `payments:write`. */
  let paymentWrites: string[] = [];
  let tools: Tools;

  before(async () => {
    const realDb = await import("@louez/db");

    // A query finds no row (`findFirst` none, any other read an empty list),
    // so each tool goes as far as an empty store takes it; a write is noted
    // with its table.
    const answer = (rows: unknown): unknown =>
      new Proxy(() => {}, {
        get: (_, key) =>
          key === "then"
            ? (resolve: (value: unknown) => void) => resolve(rows)
            : answer(key === "findFirst" ? undefined : rows),
        apply: () => answer(rows),
      });
    const db: unknown = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === "insert" || key === "update" || key === "delete") {
            return (table: unknown) => {
              if (table === realDb.payments) paymentTableWrites.push(key);
              return answer([]);
            };
          }
          if (key === "transaction") return async (run: (tx: unknown) => unknown) => run(db);
          return answer([]);
        },
      },
    );
    mock.module("@louez/db", { namedExports: { ...realDb, db } });

    await import("@louez/mcp/testing/cjs-named-exports");
    const { appRouter } = await import("@louez/api/router");
    paymentWrites = proceduresOf(appRouter)
      .filter(([, { meta }]) => {
        const scope = (meta as { scope?: { domain: string; level: string } } | undefined)?.scope;
        return scope?.domain === "payments" && scope.level === "write";
      })
      .map(([path]) => path);

    // Each procedure is noted, then refused: no tool's call goes further.
    const domain = (name: string) =>
      new Proxy(
        {},
        {
          get: (_, procedure) => async () => {
            called.push(`dashboard.${name}.${String(procedure)}`);
            throw new Error("Not served in this test");
          },
        },
      );
    const api = new Proxy({}, { get: (_, name) => domain(String(name)) });

    const { createAITools: create } = await import("./tools");
    tools = create({
      storeId: "store_guard",
      userId: "user_guard",
      storeName: "Guard",
      urls: createTestUrls(),
      api: api as AIChatContext["api"],
      permissions: {
        reservations: "write",
        products: "write",
        customers: "write",
        categories: "write",
        payments: "write",
        analytics: "read",
        settings: "write",
      },
    });

    for (const [name, candidate] of Object.entries(tools)) {
      const tool = candidate as unknown as AnyTool;
      assert.ok(tool.execute, `${name} runs on the server`);
      try {
        await tool.execute(sampleOf(tool.inputSchema), { toolCallId: name, messages: [] });
      } catch {
        // A refusal or an empty answer: what the tool called is what counts.
      }
    }
  });

  test("the procedures that write payments are known", () => {
    for (const path of [
      "dashboard.payments.record",
      "dashboard.payments.recordDepositReturn",
      "dashboard.payments.delete",
    ]) {
      assert.ok(paymentWrites.includes(path), path);
    }
    assert.ok(called.length > 0, "the tools called the API");
  });

  test("no tool calls a procedure that writes payments", () => {
    assert.deepEqual(
      called.filter((path) => paymentWrites.includes(path)),
      [],
    );
  });

  test("no tool writes the payments table", () => {
    assert.deepEqual(paymentTableWrites, []);
  });

  test("record_payment, delete_payment and return_deposit are not offered", () => {
    for (const name of ["record_payment", "delete_payment", "return_deposit"]) {
      assert.equal(name in tools, false, name);
    }
  });
});
