import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// The inventory of the places that ask for a confirmation, read from the
// source text of apps/ and packages/ (`.ts`, `.tsx`, `.js`, `.mjs`…, outside
// tests): each call to an asking function with the consequences it declares,
// as written, compared with the tables below, so that a new place, or a
// changed declaration, fails here until the table says what it does and shows
// in review. It is an inventory, not the enforcement: the compiler refuses a
// check without its consequences (`ConfirmationCheck`,
// confirmation-types.test.ts), and confirmation-sites.db.test.ts pins what
// each branch emits when it runs.
//
// A text scan sees what is written by name, in ordinary code: it does not
// follow a call built inside a template string, a module re-exported whole, or
// a helper imported from a test file, and it is not a proof that nothing else
// reaches an asking function. What it guards against is forgetting, not a
// determined detour: a value forced past the types is refused when it runs
// (`checkConfirmation` checks every consequence). To keep the ordinary detours
// out of the inventory's blind spots, it also refuses, in the same files: an asking
// function named but neither defined, imported by its own name, called by it,
// nor read as a type (no alias, no `x.requireConfirmation(…)`, no value passed
// around); its name as a string (`obj["requireConfirmation"]`); a namespace,
// default or dynamic import of a module that defines one; a spread in an
// object that declares consequences (a spread's keys could replace them,
// unseen by the types). And every procedure that declares `sensitive` calls an
// asking function, directly or through a helper of its file, or is listed with
// why it does not; a call the code never makes is beyond it. No hand-written
// MCP tool asks: `legacyTool` takes no confirmation, and the tools that move
// money or delete are procedures.

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SELF = relative(REPO, fileURLToPath(import.meta.url));
const ROOTS = ["apps", "packages"];
const SKIPPED_FOLDERS = new Set(["node_modules", ".next", ".turbo", "dist", "build", "coverage"]);

/** The functions that ask: each takes the consequences with the preview. */
const ASKING = [
  "checkConfirmation",
  "requireConfirmation",
  "confirmUnderLock",
  "confirmTeamChange",
];

/** The files outside tests that name an asking function. None under apps/. */
const FILES = [
  "packages/api/src/platform/confirmation.ts",
  "packages/api/src/platform/testing.ts",
  "packages/api/src/routers/dashboard/categories.ts",
  "packages/api/src/routers/dashboard/online-store.ts",
  "packages/api/src/routers/dashboard/payments.ts",
  "packages/api/src/routers/dashboard/product-context.ts",
  "packages/api/src/routers/dashboard/product-units.ts",
  "packages/api/src/routers/dashboard/product-variants.ts",
  "packages/api/src/routers/dashboard/products.ts",
  "packages/api/src/routers/dashboard/reservation-follow-up.ts",
  "packages/api/src/routers/dashboard/settings.ts",
  "packages/api/src/routers/dashboard/stores.ts",
  "packages/api/src/routers/dashboard/team.ts",
  "packages/api/src/services/product-images.ts",
];

/**
 * Each place that asks, by file and the top-level declaration it sits in,
 * with the consequences it declares as written, branch by branch.
 */
const DECLARED: Record<string, readonly string[]> = {
  // `remove`, then `erase`, whose test input names the consequences it runs with.
  "packages/api/src/platform/testing.ts#createFixtureRouter": [
    '["deletion"]',
    "input.consequences",
  ],
  "packages/api/src/routers/dashboard/categories.ts#remove": ['["deletion"]'],
  "packages/api/src/routers/dashboard/online-store.ts#updateSlug": [
    'preview.online ? ["deletion"] : ["change"]',
  ],
  // The three payment writes, the deletion included: money, whatever the option.
  "packages/api/src/routers/dashboard/payments.ts#paymentRecordsCaller": ['["money"]'],
  "packages/api/src/routers/dashboard/product-units.ts#declareDowntime": ['["change"]'],
  "packages/api/src/routers/dashboard/product-units.ts#deleteDowntime": ['["change"]'],
  "packages/api/src/routers/dashboard/product-units.ts#retireUnit": ['["change"]'],
  "packages/api/src/routers/dashboard/product-units.ts#updateDowntime": ['["change"]'],
  "packages/api/src/routers/dashboard/product-variants.ts#deleteVariantDefinition": ['["change"]'],
  "packages/api/src/routers/dashboard/product-variants.ts#deleteVariantValue": ['["change"]'],
  "packages/api/src/routers/dashboard/product-variants.ts#withdrawVariantFromProducts": [
    'preview.products.length > 0 ? ["deletion"] : ["change"]',
  ],
  "packages/api/src/routers/dashboard/products.ts#deleteSeasonalPricingProcedure": ['["deletion"]'],
  "packages/api/src/routers/dashboard/products.ts#remove": ['["deletion"]'],
  "packages/api/src/routers/dashboard/products.ts#update": [
    'preview.deletedUnits.length + preview.deletedTierCount + preview.deletedSeasonalPricingCount > 0 ? ["deletion"] : ["change"]',
  ],
  "packages/api/src/routers/dashboard/products.ts#updateStatus": ['["change"]'],
  // Its branches (overrides, a message, both, neither) are in that function.
  "packages/api/src/routers/dashboard/reservation-follow-up.ts#statusConfirmation": [
    "statusChangeConsequences(preview)",
  ],
  "packages/api/src/routers/dashboard/settings.ts#confirmChanges": ['["change"]'],
  "packages/api/src/routers/dashboard/settings.ts#upsertLegalProfileProcedure": ['["change"]'],
  "packages/api/src/routers/dashboard/stores.ts#completeOnboarding": ['["change"]'],
  "packages/api/src/routers/dashboard/stores.ts#create": ['["change"]'],
  "packages/api/src/routers/dashboard/team.ts#cancel": ['["access_removed"]'],
  "packages/api/src/routers/dashboard/team.ts#remove": ['["access_removed"]'],
  // A priced run only: a free one asks nothing.
  "packages/api/src/services/product-images.ts#startImageJob": ['["credits"]'],
};

/** Sensitive procedures that never ask, and why. */
const NEVER_ASKS: Record<string, string> = {
  "reservations.resolveDepositAttempt": "a dashboard session only: the user clicked",
  "team.resendInvitation": "a dashboard session only: the user clicked",
};

const SOURCE = /\.[cm]?[jt]sx?$/;
const isTest = (file: string) => /\.test\.[cm]?[jt]sx?$/.test(file);

/** Every source file under the roots, tests included, relative to the repository. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(join(REPO, folder), { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(path);
      } else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(path);
      }
    }
  };
  for (const root of ROOTS) walk(root);
  return files.sort();
}

/**
 * The source with its comments blanked and, unless `keepStrings`, its
 * strings' contents blanked (quotes kept), same length: brackets and names
 * are then the code's own.
 */
function codeOnly(text: string, keepStrings = false): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) if (out[index] !== "\n") out[index] = " ";
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === "/" && text[index + 1] === "*") {
      const stop = text.indexOf("*/", index + 2) + 2;
      blank(index, stop);
      index = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      let end = index + 1;
      while (end < text.length && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
      if (!keepStrings) blank(index + 1, end);
      index = end + 1;
    } else {
      index += 1;
    }
  }
  return out.join("");
}

/** Where the bracket opened at `open` closes. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if ("([{".includes(code[index])) depth += 1;
    if (")]}".includes(code[index])) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

/** Where the bracket that encloses `at` opens, or -1. */
function opening(code: string, at: number): number {
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    if (")]}".includes(code[index])) depth += 1;
    if ("([{".includes(code[index])) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/** The top-level declaration a position sits in, by name (`(module)` before the first). */
function declarationAt(code: string, at: number): string {
  let name = "(module)";
  for (const match of code.matchAll(
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    if (match.index > at) break;
    name = match[1];
  }
  return name;
}

/** Whether the object literal that holds `at` has a spread of its own (not in a nested value). */
function objectHasSpread(code: string, at: number): boolean {
  const open = opening(code, at);
  if (open === -1 || code[open] !== "{") return false;
  const close = closing(code, open);
  let depth = 0;
  for (let index = open + 1; index < close; index += 1) {
    if ("([{".includes(code[index])) depth += 1;
    else if (")]}".includes(code[index])) depth -= 1;
    else if (depth === 0 && code.startsWith("...", index)) return true;
  }
  return false;
}

/** The consequences declared in a call's arguments, as written, and whether one shares an object with a spread. */
function declaredIn(
  text: string,
  code: string,
  from: number,
  to: number,
): { declared: string[]; spread: boolean } {
  const declared: string[] = [];
  let spread = false;
  const args = code.slice(from, to);
  for (const match of args.matchAll(/\bconsequences\b(\s*:)?/g)) {
    const at = from + match.index;
    if (!match[1]) {
      // `{ consequences }`: passed on as it came.
      if (/[{,]\s*$/.test(code.slice(0, at)) && /^\s*[,}]/.test(code.slice(at + 12))) {
        declared.push("consequences");
        spread ||= objectHasSpread(code, at);
      }
      continue;
    }
    spread ||= objectHasSpread(code, at);
    // The value runs to the next comma or closing bracket at its own depth.
    let index = at + match[0].length;
    const start = index;
    let depth = 0;
    for (; index < to; index += 1) {
      if ("([{".includes(code[index])) depth += 1;
      else if (")]}".includes(code[index])) {
        if (depth === 0) break;
        depth -= 1;
      } else if (code[index] === "," && depth === 0) break;
    }
    declared.push(
      text
        .slice(start, index)
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\s+/g, " ")
        .replace(/,\s*\]/g, "]")
        .trim(),
    );
  }
  return { declared, spread };
}

interface Scan {
  /** The non-test files that name an asking function. */
  files: string[];
  /** Each asking call: its place, what it declares, and whether a spread shares its object. */
  places: Array<{ place: string; declared: string[]; spread: boolean }>;
  /** Each name of an asking function used otherwise than defined, imported, called or read as a type. */
  misuses: string[];
  /** The helpers (not procedures) that hold an asking call: a procedure that calls one asks. */
  askers: Set<string>;
  /** Each sensitive procedure, and the names of the functions its declaration calls. */
  sensitive: Array<{ capability: string; place: string; calls: Set<string> }>;
}

function scan(): Scan {
  const result: Scan = {
    files: [],
    places: [],
    misuses: [],
    askers: new Set(),
    sensitive: [],
  };
  const watched = new RegExp(`\\b(${ASKING.join("|")})\\b`, "g");
  // The modules that define an asking function, by the end of their import path.
  const defining = /\/(?:confirmation|product-context|team)["']/;

  for (const file of sourceFiles()) {
    if (file === SELF) continue;
    const text = readFileSync(join(REPO, file), "utf8");
    if (isTest(file)) continue;
    const withStrings = codeOnly(text, true);
    if (!ASKING.some((name) => withStrings.includes(name))) continue;

    const code = codeOnly(text);
    const where = (at: number) => `${file}:${text.slice(0, at).split("\n").length}`;

    // An asking name as a string: a computed call or a lookup by name.
    for (const match of withStrings.matchAll(new RegExp(`(["'\`])(${ASKING.join("|")})\\1`, "g"))) {
      result.misuses.push(`${where(match.index)}: "${match[2]}" as a string`);
    }
    // A namespace, default or dynamic import, or a re-export, of a defining module.
    for (const match of withStrings.matchAll(
      /\bimport\s*\*\s*as\s+\w+\s+from\s*(["'][^"']*["'])|\bimport\s+[\w$]+\s*(?:,\s*\{[^}]*\})?\s+from\s*(["'][^"']*["'])|\bimport\s*\(\s*(["'][^"']*["'])|\brequire\s*\(\s*(["'][^"']*["'])|\bexport\s*\*\s*(?:as\s+\w+\s+)?from\s*(["'][^"']*["'])/g,
    )) {
      const specifier = match.slice(1).find(Boolean) ?? "";
      if (defining.test(specifier)) {
        result.misuses.push(`${where(match.index)}: ${match[0].replace(/\s+/g, " ")}`);
      }
    }

    // Named imports: by their own name, or refused.
    const imported = new Set<number>();
    for (const match of code.matchAll(/\b(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/g)) {
      const listStart = match.index + match[0].indexOf("{") + 1;
      for (const name of match[1].matchAll(watched)) {
        const at = listStart + name.index;
        const after = code.slice(at + name[0].length);
        if (match[0].startsWith("export") || /^\s+as\b/.test(after)) {
          result.misuses.push(`${where(at)}: ${name[0]} re-exported or renamed`);
        }
        imported.add(at);
      }
      // `import { x as requireConfirmation }`: something else under its name.
      for (const alias of match[1].matchAll(new RegExp(`\\bas\\s+(${ASKING.join("|")})\\b`, "g"))) {
        result.misuses.push(`${where(listStart + alias.index)}: imported as ${alias[1]}`);
      }
    }

    let named = false;
    for (const match of code.matchAll(watched)) {
      const name = match[1];
      const at = match.index;
      if (imported.has(at)) continue;
      named = true;
      const before = code.slice(0, at);
      const after = code.slice(at + name.length);
      if (/\b(?:function\*?)\s+$/.test(before)) continue;
      if (/\btypeof\s+$/.test(before)) continue;
      const call = /^\s*(?:<[^()]*>)?\(/.exec(after);
      if (!call || /\.\s*$/.test(before)) {
        result.misuses.push(`${where(at)}: ${name} used otherwise than called by its name`);
        continue;
      }
      // An asking function's own definition hands the declaration on.
      const declaration = declarationAt(code, at);
      const place = `${file}#${declaration}`;
      const open = at + name.length + call[0].length - 1;
      const close = closing(code, open);
      if (ASKING.includes(declaration)) continue;
      result.places.push({ place, ...declaredIn(text, code, open + 1, close) });
      if (!/\.meta\(/.test(code.slice(0, at).slice(code.lastIndexOf("\n", at)))) {
        result.askers.add(declaration);
      }
    }
    if (named) result.files.push(file);

    // The sensitive procedures, each with the names its declaration calls.
    const starts = [
      ...code.matchAll(
        /^(?:export\s+)?(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
      ),
    ];
    starts.forEach((start, index) => {
      const to = starts[index + 1]?.index ?? code.length;
      const body = code.slice(start.index, to);
      const capability = /\bcapability:\s*"([^"]*)"/.exec(text.slice(start.index, to));
      if (/\.meta\(/.test(body) && capability && /\bsensitive:/.test(body)) {
        const calls = new Set(
          [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\(/g)].map((call) => call[1]),
        );
        result.sensitive.push({ capability: capability[1], place: `${file}#${start[1]}`, calls });
      }
    });
  }
  return result;
}

describe("the inventory of the places that ask for a confirmation", () => {
  const found = scan();

  test("the files that name an asking function are these, none under apps/", () => {
    assert.deepEqual(found.files, FILES);
  });

  test("an asking function is reached by its own name only", () => {
    assert.deepEqual(found.misuses, []);
  });

  test("each place that asks, and the consequences it declares, are this table", () => {
    const places: Record<string, string[]> = {};
    for (const { place, declared } of found.places) (places[place] ??= []).push(...declared);
    assert.deepEqual(places, DECLARED);
  });

  test("each place writes its declaration in an object without a spread", () => {
    for (const { place, declared, spread } of found.places) {
      assert.ok(declared.length > 0, `${place}: the consequences are written at the call`);
      assert.equal(spread, false, `${place}: a spread shares the object of its consequences`);
    }
  });

  test("only the transport tests' fixture makes a consequence live", () => {
    // `checkConfirmation` reads `liveConsequences`, the fixture sets it, and
    // nothing else outside tests names it; the rule's live list reaches the
    // adapter from `checkConfirmation` alone.
    const naming = sourceFiles()
      .filter((file) => !isTest(file))
      .filter((file) =>
        /\bliveConsequences\b/.test(codeOnly(readFileSync(join(REPO, file), "utf8"))),
      );
    assert.deepEqual(naming, [
      "packages/api/src/platform/confirmation.ts",
      "packages/api/src/platform/testing.ts",
    ]);
    const stepping = sourceFiles()
      .filter((file) => !isTest(file))
      .filter((file) =>
        /\bconfirmationStep\s*\(/.test(codeOnly(readFileSync(join(REPO, file), "utf8"))),
      );
    assert.deepEqual(stepping, [
      "packages/api/src/platform/approval-rule.ts",
      "packages/api/src/platform/confirmation.ts",
    ]);
    // And the fixture is no module of the app's: only tests import it.
    const importing = sourceFiles()
      .filter((file) => !isTest(file))
      .filter((file) =>
        /["'](?:\.\/|@louez\/api\/platform\/|\.\.\/platform\/|\.\.\/\.\.\/platform\/)testing["']/.test(
          codeOnly(readFileSync(join(REPO, file), "utf8"), true),
        ),
      );
    assert.deepEqual(importing, []);
  });

  test("every sensitive procedure calls an asking function, or says why it does not", () => {
    assert.ok(found.sensitive.length > 20, `${found.sensitive.length} sensitive procedures found`);
    for (const { capability, place, calls } of found.sensitive) {
      const asks = [...calls].some((name) => ASKING.includes(name) || found.askers.has(name));
      if (capability in NEVER_ASKS) {
        assert.equal(asks, false, `${capability} (${place}) asks: take it out of NEVER_ASKS`);
      } else {
        assert.ok(asks, `${capability} (${place}) is sensitive and never asks`);
      }
    }
  });
});
