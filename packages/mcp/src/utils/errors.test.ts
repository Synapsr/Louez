import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ORPCError } from "@orpc/server";

import { TRANSLATION_KEY_MESSAGES } from "./error-messages";
import type { McpRequestContext } from "../auth/context";
import { errorFacts, reportToolError } from "./errors";

// What a tool says when a procedure fails: never internals, always what to do.

/** The source files of packages/api, tests left out. */
function apiSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return apiSources(path);
    return entry.name.endsWith(".ts") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("tool errors", () => {
  test("a translation key an older service throws reads as English, with the way out", () => {
    const facts = errorFacts(new ORPCError("NOT_FOUND", { message: "errors.productNotFound" }));
    assert.deepEqual(facts, {
      message: "No product of this store has this id: find it with products_list.",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  test("a key with no message yet is made readable, never shown raw", () => {
    const facts = errorFacts(new ORPCError("CONFLICT", { message: "errors.slotAlreadyTaken" }));
    assert.equal(facts.code, "CONFLICT");
    assert.match(facts.message, /^Louez refused this call: slot already taken\. /);
    assert.doesNotMatch(facts.message, /errors\./);
  });

  test("a server error keeps its internals out, unless it is a known key", () => {
    const lookup = errorFacts(
      new ORPCError("INTERNAL_SERVER_ERROR", { message: "errors.addressLookupFailed" }),
    );
    assert.match(lookup.message, /send the address as text/);
    assert.equal(lookup.retryable, true);
    const internal = errorFacts(
      new ORPCError("INTERNAL_SERVER_ERROR", { message: "TypeError: x is undefined" }),
    );
    assert.equal(internal.code, "INTERNAL_SERVER_ERROR");
    assert.doesNotMatch(internal.message, /TypeError/);
    assert.match(
      errorFacts(new Error("ECONNREFUSED 10.0.0.3")).message,
      /^Louez hit an unexpected/,
    );
  });

  test("every translation key packages/api throws has its message", () => {
    const root = fileURLToPath(new URL("../../../api/src", import.meta.url));
    const thrown = new Set<string>();
    const pattern =
      /(?:ApiServiceError\(\s*["'][A-Z_]+["'],\s*|message:\s*)["'](errors\.[A-Za-z0-9_.]+)["']/g;
    for (const file of apiSources(root)) {
      for (const match of readFileSync(file, "utf8").matchAll(pattern)) thrown.add(match[1]);
    }
    assert.ok(thrown.size > 20, `only ${thrown.size} keys found`);
    const missing = [...thrown].filter((key) => !(key in TRANSLATION_KEY_MESSAGES)).sort();
    assert.deepEqual(missing, []);
  });
});

describe("tool errors in error tracking", () => {
  const reported: Array<[unknown, Record<string, unknown>]> = [];
  const ctx = {
    actor: { storeId: "store_1", credential: { kind: "oauth", directory: "anthropic" } },
    storeChosen: true,
    ports: {
      reportError: (error: unknown, context: Record<string, unknown>) =>
        reported.push([error, context]),
    },
  } as unknown as McpRequestContext;

  test("a hand-written tool's error goes with the tool and the caller, never the store", () => {
    const boom = new Error("boom");
    reportToolError(ctx, "record_payment", boom);
    assert.deepEqual(reported, [
      [
        boom,
        {
          source: "mcp_tool",
          transport: "mcp",
          tool: "record_payment",
          client: "oauth",
          directory: "anthropic",
        },
      ],
    ]);
  });
});
