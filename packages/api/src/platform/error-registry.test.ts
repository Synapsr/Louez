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

describe("Louez's error registry", () => {
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
