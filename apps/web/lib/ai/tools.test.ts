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

// The in-app assistant writes money only through a procedure that asks the
// person's approval for it: recording a payment, deleting one and recording
// a deposit return each wait for the person's decision on the approval's
// page (`APPROVAL_LIVE`, platform/approval-rule.ts, for a session marked as
// the assistant's), and the model can ask, never decide.
//
// What it can reach: no tool reaches a dashboard domain the assistant holds
// no client of, and the payment-writing procedures within the domains it
// holds are listed below, each with why it is safe, so a new one is a
// decision, not an accident. What it does: every tool runs with each of its
// parameters filled, and once more per other value of each top-level choice
// and yes/no, against an API that refuses each call and against one that
// answers each call, so a tool goes on past its first call; every
// payment-writing procedure a tool called must be one that asks the person,
// and the database notes each table written, none of which may be the
// payments table. A tool that writes behind a value read from an answer
// needs its own case here, with that answer. That the three ask the
// assistant's caller, and carry out only what the person approved, once, is
// proved on the database (lib/ai/payment-approval.db.test.ts).

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

/** The schema under its optional, nullable and default wrappers. */
function unwrapped(schema: z.ZodType): z.ZodType {
  const def = (schema as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod
    .def;
  return def.innerType && ["optional", "nullable", "default"].includes(def.type)
    ? unwrapped(def.innerType)
    : schema;
}

/** The first sample, then one more per other value of each choice and each yes/no. */
function samplesOf(schema: z.ZodType): unknown[] {
  const first = sampleOf(schema);
  const def = (
    unwrapped(schema) as unknown as {
      _zod: { def: { type: string; shape?: Record<string, z.ZodType> } };
    }
  )._zod.def;
  if (def.type !== "object" || !def.shape) return [first];
  const others = Object.entries(def.shape).flatMap(([key, field]) => {
    const inner = (
      unwrapped(field) as unknown as {
        _zod: { def: { type: string; entries?: Record<string, string> } };
      }
    )._zod.def;
    const values =
      inner.type === "enum"
        ? Object.values(inner.entries ?? {}).slice(1)
        : inner.type === "boolean"
          ? [false]
          : [];
    return values.map((value) => ({ ...(first as object), [key]: value }));
  });
  return [first, ...others];
}

/** A value that answers every read and every call: a tool goes on past the call that returned it. */
const anything: unknown = new Proxy(() => {}, {
  get: (_, key) => {
    if (key === "then") return undefined;
    if (key === Symbol.iterator) return function* () {};
    if (key === Symbol.toPrimitive) return () => "sample";
    if (key === "length") return 0;
    return anything;
  },
  apply: () => anything,
});

/** Every procedure of a router, by its path. */
function proceduresOf(router: object, path: string[] = []): [string, { meta?: unknown }][] {
  return Object.entries(router).flatMap(([key, value]) => {
    if (value && typeof value === "object" && "~orpc" in value) {
      return [[[...path, key].join("."), (value as { "~orpc": { meta?: unknown } })["~orpc"]]];
    }
    return value && typeof value === "object" ? proceduresOf(value, [...path, key]) : [];
  });
}

/**
 * The payment-writing procedures within the domains the assistant holds,
 * and why each is safe for it.
 */
const HELD_PAYMENT_WRITES: Record<string, string> = {
  // Called by record_payment, delete_payment and return_deposit: each
  // declares `money`, which asks the person's approval of a session marked
  // as the assistant's, whatever any option.
  "dashboard.payments.record": "asks the person",
  "dashboard.payments.recordDepositReturn": "asks the person",
  "dashboard.payments.delete": "asks the person",
  // Session-only (`actors`), so refused to the assistant's session; no tool calls it.
  "dashboard.reservations.resolveDepositAttempt": "not called",
  // A refund given by hand: it declares `money`, so it asks the person's
  // approval of the assistant's session too (lib/ai/payment-approval.db.test.ts);
  // no tool calls it.
  "dashboard.payments.recordRefund": "not called",
  // A refund of an online payment through Stripe: it declares `money`, so the
  // assistant's session is asked the person's approval
  // (lib/api/stripe-refunds-procedure.db.test.ts); no tool calls it.
  "dashboard.payments.refund": "not called",
};

/** The ones a tool may call: they ask the person (`personApproval`). */
const ASKS_THE_PERSON = Object.entries(HELD_PAYMENT_WRITES)
  .filter(([, why]) => why === "asks the person")
  .map(([path]) => path);

describe("the in-app assistant writes money only through the person's approval", () => {
  /** `dashboard.<domain>.<procedure>`, each procedure a tool called. */
  const called: string[] = [];
  /** The database's write calls on the payments table. */
  const paymentTableWrites: string[] = [];
  /** The procedures whose scope is `payments:write`. */
  let paymentWrites: string[] = [];
  /** Each procedure's meta, by its path. */
  let metas = new Map<string, unknown>();
  /** The domains a tool asked a client of, outside those the assistant holds. */
  const outside: string[] = [];
  /** `tool: message`, each tool whose parameters could not be filled. */
  const unfilled: string[] = [];
  let domains: readonly string[] = [];
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
    metas = new Map(proceduresOf(appRouter).map(([path, { meta }]) => [path, meta]));
    paymentWrites = proceduresOf(appRouter)
      .filter(([, { meta }]) => {
        const scope = (meta as { scope?: { domain: string; level: string } } | undefined)?.scope;
        return scope?.domain === "payments" && scope.level === "write";
      })
      .map(([path]) => path);

    const { createAITools: create, ASSISTANT_API_DOMAINS } = await import("./tools");
    domains = ASSISTANT_API_DOMAINS;

    // Each procedure is noted, then refused or answered. A domain the
    // assistant holds no client of is noted too.
    let served = 0;
    const apiThat = (answers: boolean) =>
      new Proxy(
        {},
        {
          get: (_, name) => {
            if (!domains.includes(String(name))) outside.push(String(name));
            return new Proxy(
              {},
              {
                get: (__, procedure) => async () => {
                  called.push(`dashboard.${String(name)}.${String(procedure)}`);
                  served += 1;
                  // A tool that pages through an answer that never ends stops here.
                  if (answers && served <= 20) return anything;
                  throw new Error("Not served in this test");
                },
              },
            );
          },
        },
      );

    for (const answers of [false, true]) {
      tools = create({
        storeId: "store_guard",
        userId: "user_guard",
        storeName: "Guard",
        urls: createTestUrls(),
        api: apiThat(answers) as AIChatContext["api"],
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
        let samples: unknown[];
        try {
          samples = samplesOf(tool.inputSchema);
        } catch (error) {
          unfilled.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        for (const sample of samples) {
          served = 0;
          try {
            await tool.execute(sample, { toolCallId: name, messages: [] });
          } catch {
            // A refusal or an empty answer: what the tool called and wrote is what counts.
          }
        }
      }
    }
  });

  test("every tool ran with its parameters filled", () => {
    assert.deepEqual(unfilled, []);
  });

  test("no tool reaches a domain the assistant holds no client of", () => {
    assert.deepEqual(outside, []);
  });

  test("the payment-writing procedures within the assistant's domains are these, each decided", () => {
    // A procedure added here is one a tool could be given tomorrow: adding it
    // to the list is the moment to decide whether it asks the person.
    const held = paymentWrites.filter((path) =>
      domains.some((domain) => path.startsWith(`dashboard.${domain}.`)),
    );
    assert.deepEqual([...held].sort(), Object.keys(HELD_PAYMENT_WRITES).sort());
    assert.ok(called.length > 0, "the tools called the API");
  });

  test("every payment-writing procedure a tool calls asks the person's approval", () => {
    const writes = [...new Set(called.filter((path) => paymentWrites.includes(path)))].sort();
    assert.deepEqual(writes, [...ASKS_THE_PERSON].sort(), "the three payment tools call these");
    for (const path of writes) {
      const meta = metas.get(path) as { personApproval?: boolean };
      assert.equal(meta.personApproval, true, `${path} asks a person`);
    }
  });

  test("no payment-writing procedure that does not ask the person is called", () => {
    assert.deepEqual(
      called.filter((path) => paymentWrites.includes(path) && !ASKS_THE_PERSON.includes(path)),
      [],
    );
  });

  test("the assistant's caller is asked a person for money, and a person's session is not", async () => {
    const { confirmationStep } = await import("@louez/api/platform/approval-rule");
    const assistant = {
      kind: "session" as const,
      confirmSensitive: false,
      assistant: true as const,
    };
    assert.equal(confirmationStep(["money"], assistant), "approval");
    assert.equal(confirmationStep(["money"], { kind: "session", confirmSensitive: false }), "none");
  });

  test("no tool writes the payments table", () => {
    assert.deepEqual(paymentTableWrites, []);
  });

  test("no tool reaches the decision of an approval", () => {
    // Deciding is the person's, on the approval's page: the assistant holds
    // no client of the handoffs (`handoffs.decide`), and a session marked as
    // the assistant's is refused it (platform/procedures.ts).
    assert.equal((domains as readonly string[]).includes("handoffs"), false);
    assert.equal(
      called.some((path) => path.startsWith("dashboard.handoffs.")),
      false,
    );
  });
});
