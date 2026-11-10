import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { LOUEZ_ERROR_CODES, LOUEZ_ERROR_I18N_KEYS } from "./error-registry";

// The registry lists what Louez's code writes, read here from the source of
// every package: `apiError(status, "CODE", { i18nKey: "…" })` and
// `new ApiServiceError(status, "errors.…")`, literal values only.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sources = globSync("*/src/**/*.ts", { cwd: root }).filter(
  (file) => !file.endsWith(".test.ts") && !file.includes("node_modules"),
);

function written() {
  const codes = new Set<string>();
  const keys = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(`${root}${file}`, "utf8");
    for (const [, code] of text.matchAll(/apiError\(\s*"[A-Z_]+",\s*"([A-Z0-9_]+)"/g)) {
      if (code) codes.add(code);
    }
    for (const [, key] of text.matchAll(/i18nKey:\s*"([\w.]+)"/g)) if (key) keys.add(key);
    for (const [, key] of text.matchAll(
      /new ApiServiceError\(\s*["'][A-Z_]+["'],\s*["']([\w.]+)["']/g,
    )) {
      if (key) keys.add(key);
    }
  }
  return { codes, keys };
}

const sorted = (set: ReadonlySet<string>) => [...set].sort();

/**
 * The lines of `text` that call `apiError(` with a code that is not a
 * literal string: a code built at run time (`"PREFIX_" + x`, a template
 * with an expression, a variable) could not be in the registry.
 */
function computedCodeLines(text: string): number[] {
  const lines: number[] = [];
  for (const call of text.matchAll(/(?<!function )\bapiError\(/g)) {
    // A comment names the function, it does not call it.
    const lineStart = text.lastIndexOf("\n", call.index) + 1;
    if (/^\s*(?:\*|\/\/|\/\*)/.test(text.slice(lineStart, call.index))) continue;
    const rest = text.slice(call.index, call.index + 300);
    if (!/^apiError\(\s*"[A-Z_]+",\s*"[A-Z0-9_]+"\s*,/.test(rest)) {
      lines.push(text.slice(0, call.index).split("\n").length);
    }
  }
  return lines;
}

describe("Louez's error registry", () => {
  test("every apiError names its code as a literal string", () => {
    const found = sources.flatMap((file) =>
      computedCodeLines(readFileSync(`${root}${file}`, "utf8")).map((line) => `${file}:${line}`),
    );
    assert.deepEqual(found, [], "apiError codes must be literal strings");
  });

  test("a code built at run time is caught", () => {
    const calls = [
      'apiError("BAD_REQUEST", "PREFIX_" + kind, { message: "x" });',
      'apiError("BAD_REQUEST", `PREFIX_${kind}`, { message: "x" });',
      'apiError("BAD_REQUEST", code, { message: "x" });',
      'apiError(status, "LITERAL_CODE", { message: "x" });',
    ];
    assert.deepEqual(computedCodeLines(calls.join("\n")), [1, 2, 3, 4]);
    assert.deepEqual(
      computedCodeLines('apiError("NOT_FOUND", "PRODUCT_NOT_FOUND", {\n  message: "x" });'),
      [],
    );
    assert.deepEqual(computedCodeLines(" * apiError(status, CODE)\n// apiError(x)"), []);
  });

  test("lists every code and translation key Louez's code writes, and nothing else", () => {
    assert.ok(sources.length > 50, "the packages' sources were not found");
    const { codes, keys } = written();
    assert.deepEqual(
      sorted(LOUEZ_ERROR_CODES),
      sorted(codes),
      "platform/error-registry.ts is out of step with the apiError codes: update LOUEZ_ERROR_CODES",
    );
    assert.deepEqual(
      sorted(LOUEZ_ERROR_I18N_KEYS),
      sorted(keys),
      "platform/error-registry.ts is out of step with the translation keys: update LOUEZ_ERROR_I18N_KEYS",
    );
  });
});
