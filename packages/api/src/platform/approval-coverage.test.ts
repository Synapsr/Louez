import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Every place that can ask for a confirmation declares the consequences of
// the branch it is about to run (docs/architecture/api-and-agents.md, "Which
// actions need a person"), read from the code: each call to an asking
// function in packages/api and packages/mcp, outside tests. A new place, one
// that declares nothing, or a declaration that changes fails here until this
// table says what it does. And every procedure that declares `sensitive`
// either asks or is listed below with why it does not.

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ROOTS = ["packages/api/src", "packages/mcp/src"];

/** The functions that ask: each takes the consequences with the preview. */
const ASKING = [
  "checkConfirmation",
  "requireConfirmation",
  "confirmUnderLock",
  "confirmTeamChange",
];

/**
 * Each place that asks, by file and the top-level declaration it sits in,
 * with the consequences it declares as written, branch by branch.
 */
const DECLARED: Record<string, readonly string[]> = {
  "packages/api/src/platform/testing.ts#createFixtureRouter": ['["deletion"]'],
  "packages/api/src/routers/dashboard/categories.ts#remove": ['["deletion"]'],
  "packages/api/src/routers/dashboard/online-store.ts#updateSlug": [
    'preview.online ? ["deletion"] : ["change"]',
  ],
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

/**
 * The one call that declares nothing: the hand-written payment tools say
 * `always`, read as money, until they become procedures (pull request 6).
 */
const UNDECLARED = ["packages/mcp/src/utils/legacy-tool.ts#legacyTool"];

/** Sensitive procedures that never ask, and why. */
const NEVER_ASKS: Record<string, string> = {
  "reservations.resolveDepositAttempt": "a dashboard session only: the user clicked",
  "team.resendInvitation": "a dashboard session only: the user clicked",
};

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(join(REPO, root), { recursive: true, encoding: "utf8" })
      .filter(
        (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"),
      )
      .map((file) => join(root, file)),
  );
}

/**
 * The source with its comments blanked and its strings' contents blanked
 * (quotes kept), same length: brackets and names are then the code's own.
 */
function codeOnly(text: string): string {
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
      blank(index + 1, end);
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

/** The top-level declarations of a file: each name and where its text runs. */
function declarations(code: string): Array<{ name: string; from: number; to: number }> {
  const starts = [
    ...code.matchAll(
      /^(?:export\s+)?(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => ({ name: match[1], from: match.index }));
  return starts.map((start, index) => ({
    ...start,
    to: starts[index + 1]?.from ?? code.length,
  }));
}

/** The consequences declared in a call's arguments, as written. */
function declaredIn(text: string, code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/\bconsequences\b(\s*:)?/g)) {
    if (!match[1]) {
      // `{ consequences }`: passed on as it came.
      if (
        /[{,]\s*$/.test(code.slice(0, match.index)) &&
        /^\s*[,}]/.test(code.slice(match.index + 12))
      ) {
        found.push("consequences");
      }
      continue;
    }
    // The value runs to the next comma or closing bracket at its own depth.
    let index = match.index + match[0].length;
    const start = index;
    let depth = 0;
    for (; index < code.length; index += 1) {
      if ("([{".includes(code[index])) depth += 1;
      else if (")]}".includes(code[index])) {
        if (depth === 0) break;
        depth -= 1;
      } else if (code[index] === "," && depth === 0) break;
    }
    found.push(
      text
        .slice(start, index)
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\s+/g, " ")
        .replace(/,\s*\]/g, "]")
        .trim(),
    );
  }
  return found;
}

interface Scan {
  /** Each asking call: its place, and what it declares. */
  places: Array<{ place: string; declared: string[] }>;
  /** The helpers (not procedures) that hold an asking call: a procedure that calls one asks. */
  askers: Set<string>;
  /** Each sensitive procedure, and the names of the functions its declaration calls. */
  sensitive: Array<{ capability: string; place: string; calls: Set<string> }>;
}

function scan(): Scan {
  const result: Scan = { places: [], askers: new Set(), sensitive: [] };
  const asking = new RegExp(`\\b(${ASKING.join("|")})\\s*(?:<[^()]*>)?\\(`, "g");
  for (const file of sourceFiles()) {
    const text = readFileSync(join(REPO, file), "utf8");
    const code = codeOnly(text);
    for (const declaration of declarations(code)) {
      const body = code.slice(declaration.from, declaration.to);
      const place = `${file}#${declaration.name}`;
      const procedure = /\.meta\(/.test(body);
      // The asking functions' own definitions hand the declaration on.
      if (!ASKING.includes(declaration.name)) {
        for (const match of body.matchAll(asking)) {
          // A definition or an import names the function without calling it.
          if (/(?:function|import|type)\s+$/.test(body.slice(0, match.index))) continue;
          const open = declaration.from + match.index + match[0].length - 1;
          const close = closing(code, open);
          result.places.push({
            place,
            declared: declaredIn(text.slice(open + 1, close), code.slice(open + 1, close)),
          });
          if (!procedure) result.askers.add(declaration.name);
        }
      }
      const capability = /\bcapability:\s*"([^"]*)"/.exec(
        text.slice(declaration.from, declaration.to),
      );
      if (procedure && capability && /\bsensitive:/.test(body)) {
        const calls = new Set(
          [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\(/g)].map((call) => call[1]),
        );
        result.sensitive.push({ capability: capability[1], place, calls });
      }
    }
  }
  return result;
}

describe("every place that asks for a confirmation declares its consequences", () => {
  const { places, askers, sensitive } = scan();

  test("the code has places that ask", () => {
    assert.ok(places.length > 20, `${places.length} places found`);
  });

  test("each place declares the consequences of the branch it asks for", () => {
    for (const { place, declared } of places) {
      if (UNDECLARED.includes(place)) continue;
      assert.ok(declared.length > 0, `${place} declares no consequences`);
    }
  });

  test("what each place declares is what this table says", () => {
    const found: Record<string, string[]> = {};
    for (const { place, declared } of places) {
      if (UNDECLARED.includes(place)) continue;
      (found[place] ??= []).push(...declared);
    }
    assert.deepEqual(found, DECLARED);
  });

  test("the call that declares nothing is the hand-written payment tools' alone", () => {
    const undeclared = places
      .filter(({ declared }) => declared.length === 0)
      .map(({ place }) => place);
    assert.deepEqual(undeclared, UNDECLARED);
  });

  test("every sensitive procedure asks, or says why it does not", () => {
    assert.ok(sensitive.length > 20, `${sensitive.length} sensitive procedures found`);
    for (const { capability, place, calls } of sensitive) {
      const asks = [...calls].some((name) => ASKING.includes(name) || askers.has(name));
      if (capability in NEVER_ASKS) {
        assert.equal(asks, false, `${capability} (${place}) asks: take it out of NEVER_ASKS`);
      } else {
        assert.ok(asks, `${capability} (${place}) is sensitive and never asks`);
      }
    }
  });
});
