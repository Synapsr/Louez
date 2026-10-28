/**
 * No price in the public repository (louez-billing docs/plans/design.md §1, "Done
 * means" 7; contract Q33). Rates and prices live in the billing service and reach
 * Louez as policy data only.
 *
 * Code: in apps/web/lib/billing/ and packages/db/src/billing-*, a number given to a
 * fee field, or to rhu as its rate, is 0. A fee field is a name with the word fee,
 * rate, bps, price, commission, tariff, cents, percent or pct in it, or minMinor,
 * maxMinor or amountMinor, but not a reservation item's unitPrice or totalPrice, which
 * the store sets. A number is a literal, `BigInt(n)`, `Number(n)`, `parseInt`,
 * `parseFloat`, or a string of digits, since apps/web writes BigInts with `BigInt(n)`
 * and Louez stores money as decimal strings. Tests may also use the public test values
 * of fees.md §12: 123 and 250 bps, a marketplace fee of 150, a per-reservation fee of
 * 90, a minimum of 50 and a maximum of 300.
 *
 * Copy: the messages (apps/web/messages/, packages/email/src/messages/) hold no
 * percentage or amount of money outside KNOWN_FIGURES, which lists every key that has
 * one today and why. A listed key with no figure left fails too, so the list stays
 * exact. The email templates' own text holds none.
 *
 * It reads syntax only: a number computed, or passed to a call other than rhu, is not seen.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ROOT,
  isCall,
  isMember,
  memberName,
  parseSource,
  propertyKey,
  unwrap,
  walk,
} from "./source-scan.mjs";

const PUBLIC_TEST_VALUES = new Set([0, 50, 90, 123, 150, 250, 300]);
const FEE_WORDS = new Set([
  "fee",
  "fees",
  "rate",
  "rates",
  "bps",
  "price",
  "prices",
  "commission",
  "tariff",
  "cents",
  "percent",
  "pct",
]);
const FEE_FIELDS = new Set(["minMinor", "maxMinor", "amountMinor"]);
/** A reservation item's prices: the store's own, which the billing tests write. */
const ITEM_PRICE_FIELDS = new Set(["unitPrice", "totalPrice"]);

/** A percentage, or an amount next to a currency sign or code. */
const FIGURE = /\d+(?:[.,]\d+)?\s?[%％]|[€$£¥₩₹]\s?\d|\d\s?€|\d\s?(?:EUR|USD|euros?)\b/u;

const REEENT =
  "the reeent marketplace fee and its launch waiver, today Louez's MARKETPLACE_FEE_CENTS";
const PLANS = "the Pro and Ultra discount; Louez keeps those plans until after B (design Q10)";
const NOT_A_FEE = "not a platform fee";

/** Message keys that hold a figure today, in every locale that has the key. */
const KNOWN_FIGURES = new Map([
  ["apps/web/messages:dashboard.home.reeentStripe.description", REEENT],
  ["apps/web/messages:dashboard.settings.salesChannels.cohort.incentiveLine", REEENT],
  ["apps/web/messages:dashboard.settings.salesChannels.cohort.memberTitle", REEENT],
  ["apps/web/messages:onboarding.reeent.panel.offer.body", REEENT],
  ["apps/web/messages:onboarding.reeent.panel.pricing.amount", REEENT],
  ["apps/web/messages:dashboard.settings.subscription.earlyBird.badge", PLANS],
  ["apps/web/messages:dashboard.settings.subscription.earlyBird.description", PLANS],
  ["apps/web/messages:dashboard.settings.subscriptionSettings.earlyBadge", PLANS],
  ["apps/web/messages:dashboard.settings.subscriptionSettings.earlyBird", PLANS],
  ["apps/web/messages:upgradeModal.earlyBird", PLANS],
  // The statutory late-payment compensation in a store's rental contract.
  ["apps/web/messages:contract.legal.text2", NOT_A_FEE],
  // A product's price tiers, as an example.
  [
    "apps/web/messages:dashboard.products.form.pricingTiers.progressive.modal.withExample",
    NOT_A_FEE,
  ],
  [
    "apps/web/messages:dashboard.products.form.pricingTiers.progressive.modal.withoutExample",
    NOT_A_FEE,
  ],
  ["apps/web/messages:dashboard.settings.admin.discountPercentDescription", NOT_A_FEE],
  ["apps/web/messages:dashboard.settings.promoCodes.validation.maxPercentage", NOT_A_FEE],
  ["apps/web/messages:storefront.hero.securePaymentDesc", NOT_A_FEE],
]);

function listFiles(pathspecs) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(output.split("\0"))]
    .filter((file) => file !== "" && existsSync(path.join(ROOT, file)))
    .sort();
}

const isTest = (file) => path.basename(file).includes(".test.");

function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const isFeeName = (name) =>
  name !== null &&
  !ITEM_PRICE_FIELDS.has(name) &&
  (FEE_FIELDS.has(name) || words(name).some((word) => FEE_WORDS.has(word)));

const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;
/** Calls that turn their first argument into a number. */
const NUMBER_CALLS = new Set(["BigInt", "Number", "parseInt", "parseFloat"]);

function numberOfText(text) {
  return text !== null && NUMERIC_TEXT.test(text) ? Number(text) : null;
}

/** `BigInt` for `BigInt(n)`, `parseInt` for `Number.parseInt(n)`. */
function calleeName(callee) {
  const node = unwrap(callee);
  if (node?.type === "Identifier") return node.name;
  const object = isMember(node) ? unwrap(node.object) : null;
  return object?.type === "Identifier" && object.name === "Number" ? memberName(node) : null;
}

function numberOf(node) {
  const value = unwrap(node);
  if (value?.type === "NumericLiteral") return value.value;
  if (value?.type === "BigIntLiteral") return Number(value.value);
  if (value?.type === "StringLiteral") return numberOfText(value.value);
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0)
    return numberOfText(value.quasis[0].value.cooked ?? null);
  if (value?.type === "UnaryExpression" && (value.operator === "-" || value.operator === "+")) {
    const inner = numberOf(value.argument);
    return inner === null ? null : value.operator === "-" ? -inner : inner;
  }
  if (isCall(value) && value.arguments.length > 0 && NUMBER_CALLS.has(calleeName(value.callee)))
    return numberOf(value.arguments[0]);
  return null;
}

function targetName(node) {
  if (node.type === "Identifier") return node.name;
  if (isMember(node)) return memberName(node);
  return null;
}

/** Every number a source gives to a fee field or to rhu's rate, with its line. */
function feeNumbersIn(code, file) {
  const ast = parseSource(code, file);
  const found = [];
  const record = (name, value, node) => {
    const number = numberOf(value);
    if (number !== null) found.push({ line: node.loc.start.line, name, number });
  };
  const check = (name, value, node) => {
    if (isFeeName(name)) record(name, value, node);
  };
  walk(ast.program, (node) => {
    if (node.type === "ObjectProperty") check(propertyKey(node), node.value, node);
    if (node.type === "VariableDeclarator") check(targetName(node.id), node.init, node);
    if (node.type === "AssignmentPattern") check(targetName(node.left), node.right, node);
    if (node.type === "AssignmentExpression") check(targetName(node.left), node.right, node);
    if (node.type === "ClassProperty") check(propertyKey(node), node.value, node);
    // fees.md §2: rhu(x, bps).
    if (isCall(node) && calleeName(node.callee) === "rhu") record("rhu bps", node.arguments[1], node);
  });
  return found;
}

const feeNumbers = (file) => feeNumbersIn(readFileSync(path.join(ROOT, file), "utf8"), file);

function* strings(value, key = "") {
  if (typeof value === "string") yield [key, value];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, `${key}[${index}]`);
  } else if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value))
      yield* strings(item, key ? `${key}.${name}` : name);
  }
}

/** `group:key` of every message with a figure, the group being its folder. */
function messageFigures() {
  const figures = new Map();
  const files = listFiles(["apps/web/messages", "packages/email/src/messages"]).filter((file) =>
    file.endsWith(".json"),
  );
  for (const file of files) {
    const group = path.dirname(file);
    for (const [key, text] of strings(JSON.parse(readFileSync(path.join(ROOT, file), "utf8")))) {
      if (!FIGURE.test(text)) continue;
      const id = `${group}:${key}`;
      figures.set(id, [...(figures.get(id) ?? []), `${path.basename(file)}: ${text}`]);
    }
  }
  return figures;
}

/** The text a template renders itself: JSX text and string children. */
function templateTexts(file) {
  const ast = parseSource(readFileSync(path.join(ROOT, file), "utf8"), file);
  const texts = [];
  walk(ast.program, (node) => {
    if (node.type !== "JSXElement" && node.type !== "JSXFragment") return;
    for (const child of node.children) {
      const expression = child.type === "JSXExpressionContainer" ? unwrap(child.expression) : null;
      if (child.type === "JSXText") texts.push({ line: child.loc.start.line, text: child.value });
      else if (expression?.type === "StringLiteral")
        texts.push({ line: child.loc.start.line, text: expression.value });
      else if (expression?.type === "TemplateLiteral") {
        for (const quasi of expression.quasis)
          texts.push({ line: child.loc.start.line, text: quasi.value.cooked ?? "" });
      }
    }
  });
  return texts;
}

test("the scan sees a fee number in each form it can take", () => {
  const seen = (code) => feeNumbersIn(code, "probe.ts").map(({ name, number }) => [name, number]);
  for (const [code, expected] of [
    ["const launch = { rateBps: 400 };", ["rateBps", 400]],
    ["export const LAUNCH_RATE_BPS = BigInt(400);", ["LAUNCH_RATE_BPS", 400]],
    ["const rate = Number('400');", ["rate", 400]],
    ["const launch = { rateBps: Number.parseInt('400', 10) };", ["rateBps", 400]],
    ["let commission = parseFloat(`4.5`);", ["commission", 4.5]],
    ["export const MARKETPLACE_CENTS = 100;", ["MARKETPLACE_CENTS", 100]],
    ["const discountPercent = 4;", ["discountPercent", 4]],
    ["const feePct = -4n;", ["feePct", -4]],
    ['export const marketplaceFee = "1.00";', ["marketplaceFee", 1]],
    ["const f = (b: bigint) => rhu(b, BigInt(400));", ["rhu bps", 400]],
  ]) {
    assert.deepEqual(seen(code), [expected], code);
  }
  for (const code of [
    "const fee = rhu(base, BigInt(terms.rateBps));",
    'const kind = { kind: "percent" };',
    "const total = BigInt(400);",
    'const label = { fee: "1.00 EUR" };',
    'const item = { unitPrice: "10.00", totalPrice: "10.00" };',
  ]) {
    assert.deepEqual(seen(code), [], code);
  }
});

test("the billing code gives no fee field a number of its own", () => {
  const files = listFiles(["apps/web/lib/billing", "packages/db/src"]).filter(
    (file) =>
      /\.(?:ts|tsx|mts|cts|js|mjs)$/.test(file) &&
      !file.endsWith(".d.ts") &&
      (file.startsWith("apps/web/lib/billing/") ||
        (path.dirname(file) === "packages/db/src" && path.basename(file).startsWith("billing-"))),
  );
  assert.ok(files.includes("apps/web/lib/billing/fees.ts"), "the scan found the fee planner");
  const violations = files.flatMap((file) =>
    feeNumbers(file)
      .filter(({ number }) => (isTest(file) ? !PUBLIC_TEST_VALUES.has(number) : number !== 0))
      .map(({ line, name, number }) => `${file}:${line} ${name} = ${number}`),
  );
  assert.deepEqual(
    violations,
    [],
    "A fee value belongs in the billing service's policies. Tests use fees.md §12's public values.",
  );
});

test("the messages hold no fee figure outside the known list", () => {
  const unknown = [...messageFigures()]
    .filter(([id]) => !KNOWN_FIGURES.has(id))
    .map(([id, texts]) => `${id}\n    ${texts.join("\n    ")}`);
  assert.deepEqual(
    unknown,
    [],
    "Show a fee from the policy's labels, or add the key to KNOWN_FIGURES with its reason.",
  );
});

test("every key of the known list still holds a figure", () => {
  const figures = messageFigures();
  assert.deepEqual(
    [...KNOWN_FIGURES.keys()].filter((id) => !figures.has(id)),
    [],
    "Remove the key from KNOWN_FIGURES.",
  );
});

test("the email templates' own text holds no figure", () => {
  const files = listFiles(["packages/email/src/templates", "apps/web/lib/email/templates"]).filter(
    (file) => file.endsWith(".tsx") && !isTest(file),
  );
  assert.ok(files.length > 0, "the scan found the email templates");
  const figures = files.flatMap((file) =>
    templateTexts(file)
      .filter(({ text }) => FIGURE.test(text))
      .map(({ line, text }) => `${file}:${line} ${text.trim()}`),
  );
  assert.deepEqual(figures, [], "Email copy comes from the messages, which the list covers.");
});
