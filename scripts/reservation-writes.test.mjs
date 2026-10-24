/**
 * Reservation status writes and reservation inserts go through the helpers of
 * packages/db: `changeReservationStatus` and `insertReservation`. They return
 * the pay-as-you-go fee effects, and a write that skips them skips the fee.
 * The rule is DL-12 in docs/code-review/04-data-layer.md.
 *
 * The test parses every source file under apps/ and packages/ and looks for
 * the forms in RULES. It reads syntax only, with no types and no tsconfig.
 * A table counts when the file binds it: an import of a schema table, a
 * local alias of one, or a member of a schema namespace.
 *
 * Not covered, because no syntax rule can see the table or the SQL:
 * - packages/db/src/scripts/store-clone.ts inserts rows into a table whose
 *   name it reads at run time.
 * - packages/db/src/scripts/reservations-backfill-billable-at.ts writes
 *   billable_at and withdrawn_at with SQL it reads from migration 0083.
 * - `sql.raw` of a variable, and SQL built by string concatenation.
 * - A split write (`const q = tx.update(t); q.set(…)`) on a table the file
 *   gets some other way, such as a parameter: R3 sees the chained form only.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_FILES = ["packages/db/src/schema.ts", "packages/db/src/schema.voice.ts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JSX_EXTENSIONS = new Set([".tsx", ".js", ".mjs"]);

const RULES = {
  R1: "inserts a reservation without insertReservation",
  R2: "updates reservations in a way that may write status, billableAt or withdrawnAt",
  R3: "inserts or updates a table that is not named directly",
  R4: "writes reservations in raw SQL",
  R5: "calls a reservation helper but never runs its effects with runReservationEffects",
};

const FORBIDDEN_KEYS = new Set(["status", "billableAt", "withdrawnAt"]);
const STATUS_HELPERS = new Set(["changeReservationStatus", "insertReservation"]);
// A Drizzle write method → the call it chains on, which receives the table.
const WRITE_CHAINS = new Map([
  ["set", "update"],
  ["values", "insert"],
  ["select", "insert"],
]);

/** The helpers themselves may break the rule they enforce. */
const HELPER_FILES = {
  R1: "packages/db/src/reservation-insert.ts",
  R2: "packages/db/src/reservation-status.ts",
};

/**
 * Each entry allows `count` violations of one rule, in one file, on one
 * expression. The test fails when an entry matches any other number, so the
 * list cannot go stale.
 */
const ALLOWLIST = [
  {
    rule: "R1",
    file: "apps/web/scripts/seed/index.ts",
    expression: "schema.reservations",
    count: 1,
    reason: "dev seed with backdated rows; sets billableAt with initialBillableAt",
  },
  {
    rule: "R1",
    file: "apps/web/scripts/storefront-qa/seed.ts",
    expression: "schema.reservations",
    count: 2,
    reason:
      "QA fixtures on the isolated QA database; billable rows set billableAt with " +
      "initialBillableAt, the second insert is pending only",
  },
  {
    rule: "R3",
    file: "apps/web/scripts/seed/demo/index.ts",
    expression: "table",
    count: 1,
    reason: "insertAll of the demo seed, which refuses production; rows set billableAt",
  },
  {
    rule: "R3",
    file: "packages/db/src/scripts/slugs-backfill.ts",
    expression: "table",
    count: 1,
    reason: "products and categories only",
  },
  {
    rule: "R2",
    file: "apps/web/app/(dashboard)/dashboard/reservations/actions.ts",
    expression: "...deliveryUpdateFields",
    count: 1,
    reason: "typed to the delivery columns only",
  },
  {
    rule: "R2",
    file: "apps/web/lib/reservations/extension-service.ts",
    expression: "...totals",
    count: 1,
    reason: "the totals of a zod-parsed extension plan, which has no status key",
  },
  {
    rule: "R5",
    file: "apps/web/lib/reservations/store-status-change.ts",
    expression: "changeReservationStatus",
    count: 1,
    reason: "returns the effects; its callers in status-change.ts run them",
  },
];

const SKIPPED_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);
const WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

// `reservations`, `louez.reservations` or the same in backticks, as a whole name.
const RESERVATIONS_SQL = "(?<![\\w`])(?:`?\\w+`?\\.)?`?reservations`?(?![\\w`])";
const INSERT_SQL =
  "\\b(?:INSERT|REPLACE)(?:\\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\\s+";
// A column assignment, so "update reservations, then set a reminder" is not SQL.
const ASSIGNMENT_SQL = "\\bSET\\s+(?:[`\\w.]+|\\?)\\s*=";
const NOT_SET = "(?:(?!\\bSET\\b)[^;])*";
const RAW_WRITES = [
  // Single-table, multi-table and JOIN updates.
  new RegExp(`\\bUPDATE\\b${NOT_SET}?${RESERVATIONS_SQL}${NOT_SET}${ASSIGNMENT_SQL}`, "i"),
  new RegExp(`${INSERT_SQL}INTO\\s+${RESERVATIONS_SQL}`, "i"),
  // MySQL accepts INSERT without INTO.
  new RegExp(
    `${INSERT_SQL}${RESERVATIONS_SQL}\\s*(?:\\(|\\bVALUES?\\b|\\bSELECT\\b|${ASSIGNMENT_SQL})`,
    "i",
  ),
];

function parseSource(code, file) {
  const extension = path.extname(file);
  const plugins = [];
  if (TYPESCRIPT_EXTENSIONS.has(extension)) plugins.push("typescript");
  if (JSX_EXTENSIONS.has(extension)) plugins.push("jsx");
  try {
    return parse(code, { sourceType: "module", plugins });
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/** Visits a node before its children. */
function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") walk(child, visit);
      }
    } else if (value && typeof value.type === "string") {
      walk(value, visit);
    }
  }
}

function unwrap(node) {
  let current = node;
  while (current && WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

function isCall(node) {
  return node?.type === "CallExpression" || node?.type === "OptionalCallExpression";
}

function isMember(node) {
  return node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression";
}

function memberName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "StringLiteral") return member.property.value;
  return null;
}

/** `update` for `tx.update(t)`. */
function calledMethod(call) {
  const callee = unwrap(call.callee);
  return isMember(callee) ? memberName(callee) : null;
}

/** The call a method is chained on: `tx.update(t)` in `tx.update(t).set(…)`. */
function receiverCall(call) {
  const receiver = unwrap(unwrap(call.callee).object);
  return isCall(receiver) ? receiver : null;
}

function propertyKey(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "StringLiteral") return property.key.value;
  if (property.key.type === "NumericLiteral") return String(property.key.value);
  return null;
}

function readKnownTables() {
  const tables = new Set();
  for (const file of SCHEMA_FILES) {
    const ast = parseSource(readFileSync(path.join(ROOT, file), "utf8"), file);
    for (const statement of ast.program.body) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      if (statement.declaration?.type !== "VariableDeclaration") continue;
      for (const declarator of statement.declaration.declarations) {
        const init = unwrap(declarator.init);
        if (
          declarator.id.type === "Identifier" &&
          isCall(init) &&
          init.callee.type === "Identifier" &&
          init.callee.name === "mysqlTable"
        ) {
          tables.add(declarator.id.name);
        }
      }
    }
  }
  return tables;
}

/**
 * The names a file binds to schema tables and namespaces. An import of a
 * table name counts from any module, so a re-export cannot hide a table.
 * Bindings hold for the whole file, not per scope: a local that shadows a
 * table still counts. `tableOf(node)` gives the table a node names, or null.
 */
function readBindings(ast, tables) {
  const tableNames = new Map();
  const namespaces = new Set();

  // `schema` for `import * as schema`, and `await import("@louez/db")`.
  const isNamespace = (node) => {
    let target = unwrap(node);
    if (target?.type === "AwaitExpression") target = unwrap(target.argument);
    if (target?.type === "Identifier") return namespaces.has(target.name);
    return (
      target?.type === "ImportExpression" || (isCall(target) && target.callee.type === "Import")
    );
  };
  const tableOf = (node) => {
    const target = unwrap(node);
    if (target?.type === "Identifier") return tableNames.get(target.name) ?? null;
    if (isMember(target) && isNamespace(target.object)) {
      const name = memberName(target);
      return tables.has(name) ? name : null;
    }
    return null;
  };
  // `[a, b]` for `[a, b]` and `await Promise.all([a, b])`.
  const arrayElements = (node) => {
    let target = unwrap(node);
    if (target?.type === "AwaitExpression") target = unwrap(target.argument);
    const callee = isCall(target) ? unwrap(target.callee) : null;
    if (isMember(callee) && callee.object.name === "Promise" && memberName(callee) === "all") {
      target = unwrap(target.arguments[0]);
    }
    return target?.type === "ArrayExpression" ? target.elements : [];
  };
  // `const r = reservations`, `const { reservations: r } = schema`, `const s = schema`,
  // `const [{ reservations: r }] = await Promise.all([import("@louez/db")])`.
  const bind = (target, value) => {
    if (target.type === "Identifier") {
      const table = tableOf(value);
      if (table) tableNames.set(target.name, table);
      else if (isNamespace(value)) namespaces.add(target.name);
      return;
    }
    if (target.type === "ArrayPattern") {
      const elements = arrayElements(value);
      target.elements.forEach((element, index) => {
        if (element && elements[index]) bind(element, elements[index]);
      });
      return;
    }
    if (target.type !== "ObjectPattern" || !isNamespace(value)) return;
    for (const property of target.properties) {
      if (property.type !== "ObjectProperty") continue;
      const key = propertyKey(property);
      const local =
        property.value.type === "AssignmentPattern" ? property.value.left : property.value;
      if (tables.has(key) && local.type === "Identifier") tableNames.set(local.name, key);
    }
  };

  walk(ast.program, (node) => {
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
        if (specifier.type !== "ImportSpecifier") continue;
        const imported = specifier.imported.name ?? specifier.imported.value;
        if (tables.has(imported)) tableNames.set(specifier.local.name, imported);
      }
    }
    if (node.type === "VariableDeclarator" && node.init) bind(node.id, node.init);
    if (node.type === "AssignmentExpression" && node.operator === "=") bind(node.left, node.right);
  });
  return { tableOf, isNamespace };
}

/** Every rule break in one file, the helper files included. */
function findViolations(code, file, tables) {
  const ast = parseSource(code, file);
  const { tableOf, isNamespace } = readBindings(ast, tables);
  const violations = [];
  const text = (node) => (node ? code.slice(node.start, node.end).replace(/\s+/g, " ") : "");
  const report = (rule, node, expression) => {
    violations.push({ rule, file, line: node.loc.start.line, expression });
  };

  // `.update(t)` call → the `.set(…)` call chained on it.
  const setCalls = new Map();
  const helperNames = new Set(STATUS_HELPERS);
  const calls = [];
  let runsEffects = false;

  const checkSet = (update, set) => {
    if (!set) return report("R2", update, text(update));
    const values = unwrap(set.arguments[0]);
    if (values?.type !== "ObjectExpression") return report("R2", update, text(values ?? set));
    for (const property of values.properties) {
      if (property.type === "SpreadElement") {
        report("R2", property, `...${text(property.argument)}`);
        continue;
      }
      const key = propertyKey(property);
      if (key === null || FORBIDDEN_KEYS.has(key)) report("R2", property, text(property));
    }
  };

  const checkRawSql = (node, sqlText) => {
    if (RAW_WRITES.some((pattern) => pattern.test(sqlText))) {
      report("R4", node, text(node).slice(0, 80));
    }
  };

  walk(ast.program, (node) => {
    if (node.type === "Identifier" && node.name === "runReservationEffects") runsEffects = true;

    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        if (specifier.type !== "ImportSpecifier") continue;
        const imported = specifier.imported.name ?? specifier.imported.value;
        if (STATUS_HELPERS.has(imported)) helperNames.add(specifier.local.name);
      }
    }

    if (node.type === "StringLiteral") checkRawSql(node, node.value);
    if (node.type === "TemplateLiteral") {
      // An interpolated reservations table reads as its name, any other value as `?`.
      const sqlText = node.quasis
        .map((quasi, index) => {
          const value = quasi.value.cooked ?? quasi.value.raw;
          const expression = node.expressions[index];
          if (!expression) return value;
          return `${value} ${tableOf(expression) === "reservations" ? "reservations" : "?"} `;
        })
        .join("");
      checkRawSql(node, sqlText);
    }

    if (!isCall(node)) return;
    calls.push(node);
    const method = calledMethod(node);

    // R3: the table of a Drizzle write is a table the file binds.
    const receiver = WRITE_CHAINS.has(method) ? receiverCall(node) : null;
    if (receiver && calledMethod(receiver) === WRITE_CHAINS.get(method)) {
      if (method === "set") setCalls.set(receiver, node);
      const table = receiver.arguments[0];
      if (!tableOf(table)) report("R3", receiver, text(table));
    }

    const target = node.arguments[0];
    if (method === "insert" && tableOf(target) === "reservations") {
      report("R1", node, text(target));
    }
    if (method === "update" && tableOf(target) === "reservations") {
      checkSet(node, setCalls.get(node));
    }
  });

  // R5: a file that calls a helper also runs the effects it returns.
  const helperCall = calls.find((call) => {
    const callee = unwrap(call.callee);
    if (callee.type === "Identifier") return helperNames.has(callee.name);
    return isMember(callee) && isNamespace(callee.object) && STATUS_HELPERS.has(memberName(callee));
  });
  if (helperCall && !runsEffects) report("R5", helperCall, text(helperCall.callee));

  return violations;
}

/** Splits violations into allowed and not, and lists entries that matched the wrong count. */
function applyAllowlist(violations, allowlist) {
  const matched = new Map(allowlist.map((entry) => [entry, 0]));
  const helperMatches = new Map(Object.values(HELPER_FILES).map((file) => [file, 0]));
  const remaining = [];
  for (const violation of violations) {
    if (HELPER_FILES[violation.rule] === violation.file) {
      helperMatches.set(violation.file, helperMatches.get(violation.file) + 1);
      continue;
    }
    const entry = allowlist.find(
      (candidate) =>
        candidate.rule === violation.rule &&
        candidate.file === violation.file &&
        candidate.expression === violation.expression,
    );
    if (entry) matched.set(entry, matched.get(entry) + 1);
    else remaining.push(violation);
  }
  const stale = allowlist
    .filter((entry) => matched.get(entry) !== entry.count)
    .map((entry) => ({ ...entry, matched: matched.get(entry) }));
  const missingHelpers = [...helperMatches].filter(([, count]) => count === 0).map(([f]) => f);
  return { remaining, stale, missingHelpers };
}

function listSourceFiles() {
  // Tracked and new files, never ignored ones, so a local build folder cannot
  // change the result.
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps", "packages"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(output.split("\0"))]
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !file.startsWith("packages/db/src/migrations/"))
    .filter((file) => !file.endsWith(".d.ts"))
    .filter((file) => !path.basename(file).includes(".test."))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .sort();
}

const tables = readKnownTables();

// The snippets below run after these imports, as a file that writes to the database does.
const SNIPPET_IMPORTS = `import { products, reservations } from "@louez/db";
import * as schema from "@louez/db/schema";
`;
const rulesIn = (code) =>
  findViolations(SNIPPET_IMPORTS + code, "snippet.ts", tables).map(({ rule }) => rule);

test("the schema tables are known", () => {
  for (const name of ["reservations", "reservationActivity", "products", "voiceSessionsTable"]) {
    assert.ok(tables.has(name), name);
  }
});

test("each forbidden form gives exactly one violation", () => {
  const forbidden = {
    // The three historical bypasses: dashboard, AI tool and MCP tool.
    dashboardUpdateData: [
      "R2",
      `const updateData: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
       await tx.update(reservations).set(updateData).where(eq(reservations.id, reservationId));`,
    ],
    aiToolUpdateData: [
      "R2",
      `const updateData: Record<string, unknown> = { status: newStatus };
       if (newStatus === "ongoing") updateData.pickedUpAt = new Date();
       await tx
         .update(reservations)
         .set(updateData)
         .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, ctx.storeId)));`,
    ],
    mcpToolUpdateData: ["R2", `await tx.update(schema.reservations).set(updateData as never);`],
    shorthandKey: ["R2", `await db.update(reservations).set({ status, updatedAt: new Date() });`],
    quotedKey: ["R2", `await db.update(reservations).set({ "status": "cancelled" });`],
    computedKey: ["R2", `await db.update(reservations).set({ [column]: "cancelled" });`],
    billableAtKey: ["R2", `await db.update(reservations).set({ billableAt: null });`],
    withdrawnAtKey: ["R2", `await db.update(reservations).set({ withdrawnAt: new Date() });`],
    spread: ["R2", `await db.update(reservations).set({ ...changes, updatedAt: new Date() });`],
    splitChain: [
      "R2",
      `const query = tx.update(reservations);
       await query.set({ status: "confirmed" });`,
    ],
    insert: ["R1", `await tx.insert(reservations).values({ id, storeId, status: "pending" });`],
    insertWithoutValues: ["R1", `const query = db.insert(schema.reservations);`],
    insertSelect: ["R1", `await tx.insert(reservations).select(rows);`],
    insertTable: ["R3", `await db.insert(table).values(rows);`],
    updateTable: ["R3", `await db.update(table).set({ status: "cancelled" });`],
    insertSelectTable: ["R3", `await db.insert(deps.table).select(rows);`],
    // A table under another name.
    aliasedImport: [
      "R2",
      `import { reservations as r } from "@louez/db";
       await db.update(r).set({ status: "cancelled" });`,
    ],
    aliasNamedLikeAnotherTable: [
      "R2",
      `import { reservations as stores } from "@louez/db";
       await tx.update(stores).set({ status: "cancelled" });`,
    ],
    aliasInSplitUpdate: [
      "R2",
      `import { reservations as r } from "@louez/db/schema";
       const query = tx.update(r);
       await query.set({ status: "cancelled" });`,
    ],
    aliasInSplitInsert: [
      "R1",
      `import { reservations as r } from "./schema";
       const query = tx.insert(r);
       await query.values(row);`,
    ],
    localAlias: [
      "R2",
      `const table = reservations;
       const query = tx.update(table);
       await query.set({ status });`,
    ],
    localAliasOfMember: [
      "R1",
      `const table = schema.reservations; await tx.insert(table).select(q);`,
    ],
    destructured: [
      "R1",
      `const { reservations: rows } = schema; await tx.insert(rows).values(row);`,
    ],
    dynamicImport: [
      "R2",
      `const { reservations: table } = await import("@louez/db");
       await db.update(table).set({ status });`,
    ],
    dynamicImports: [
      "R1",
      `const [{ reservations: table }] = await Promise.all([import("@louez/db")]);
       await db.insert(table).values(row);`,
    ],
    computedMember: [
      "R2",
      `const query = tx.update(schema["reservations"]);
       await query.set({ status });`,
    ],
    rawUpdate: [
      "R4",
      "await db.execute(sql.raw(\"UPDATE `reservations` SET reservation_status = 'cancelled'\"));",
    ],
    rawUpdateOnTwoLines: [
      "R4",
      "await db.execute(sql`UPDATE reservations r\n  SET r.reservation_status = ${status}`);",
    ],
    rawJoinUpdate: [
      "R4",
      `const s = "UPDATE reservation_items ri JOIN reservations r ON r.id = ri.reservation_id SET r.reservation_status = 1";`,
    ],
    rawMultiTableUpdate: ["R4", `const s = "UPDATE products p, reservations r SET p.x = 1";`],
    rawQualifiedUpdate: ["R4", `const s = "UPDATE louez.reservations SET reservation_status = 1";`],
    rawQualifiedBackticks: ["R4", "const s = 'UPDATE `louez`.`reservations` SET a = 1';"],
    rawInsert: ["R4", `const statement = "INSERT INTO reservations (id) VALUES (?)";`],
    rawReplace: ["R4", `const statement = "REPLACE INTO reservations (id) VALUES (?)";`],
    rawInsertWithoutInto: ["R4", `const statement = "INSERT reservations SET id = ?";`],
    rawInsertLowPriority: [
      "R4",
      `const s = "INSERT LOW_PRIORITY INTO reservations (id) VALUES (1)";`,
    ],
    interpolatedTable: [
      "R4",
      "await db.execute(sql`UPDATE ${reservations} SET ${reservations.status} = 'cancelled'`);",
    ],
    interpolatedInsert: ["R4", "await db.execute(sql`INSERT INTO ${schema.reservations} VALUES`);"],
    interpolatedJoin: [
      "R4",
      "await db.execute(sql`UPDATE ${reservationItems} JOIN ${reservations} ON ${on} SET ${reservations.status} = 'x'`);",
    ],
    interpolatedAlias: [
      "R4",
      `import { reservations as r } from "@louez/db";
       await db.execute(sql\`UPDATE \${r} SET \${r.status} = 'cancelled'\`);`,
    ],
    helperWithoutEffects: [
      "R5",
      `import { insertReservation } from "@louez/db";
       await db.transaction((tx) => insertReservation(tx, values));`,
    ],
    aliasedHelperWithoutEffects: [
      "R5",
      `import { changeReservationStatus as change } from "@louez/db";
       await change(tx, { reservationId, storeId, to: "confirmed", actor: "store_user" });`,
    ],
    namespacedHelperWithoutEffects: [
      "R5",
      `import * as db from "@louez/db";
       await db.changeReservationStatus(tx, input);`,
    ],
  };
  for (const [name, [rule, code]] of Object.entries(forbidden)) {
    assert.deepEqual(rulesIn(code), [rule], name);
  }
});

test("each allowed form gives no violation", () => {
  const allowed = {
    otherStatusColumns: `await db.update(reservations).set({
      tulipContractStatus: "signed",
      depositStatus: "authorized",
      "internalNotes": notes,
      updatedAt: new Date(),
    });`,
    typedLiteral: `await tx.update(reservations).set({ internalNotes } satisfies Patch).where(scope);`,
    otherTableStatus: `await db.update(products).set({ status: "archived" });`,
    otherTableInsert: `await db.insert(schema.reservationActivity).values(row);`,
    hash: `createHash("sha256").update(content).digest("hex");`,
    // A member named reservations on an object that is not a schema namespace.
    otherObjectMember: `planning.update(props.reservations); tree.insert(state.reservations);`,
    plainText: `const label = "Update reservations settings";`,
    prose: `const prompt = "Use this tool to update reservations, then set a reminder";`,
    proseInsert: `const prompt = "Insert reservations into the calendar (one per line)";`,
    otherTableSql: "await db.execute(sql`UPDATE reservation_items SET quantity = 0`);",
    readInSubquery: `const s = "UPDATE products SET stock = (SELECT COUNT(*) FROM reservations)";`,
    helperWithEffects: `import { changeReservationStatus } from "@louez/db";
      import { runReservationEffects } from "@/lib/billing/reservation-effects";
      const change = await db.transaction((tx) => changeReservationStatus(tx, input));
      if (change.changed) await runReservationEffects(change.effects);`,
    injectedWrapper: `const result = await deps.changeReservationStatus({ reservationId, to });`,
  };
  for (const [name, code] of Object.entries(allowed)) {
    assert.deepEqual(rulesIn(code), [], name);
  }
});

test("a local value named reservations is not the table", () => {
  const code = `const reservations = props.items;
    timeline.update(reservations);
    tree.insert(reservations);`;
  assert.deepEqual(findViolations(code, "snippet.ts", tables), []);
});

test("a file that does not parse is named in the error", () => {
  assert.throws(
    () => findViolations("@decorator class A {}", "broken.ts", tables),
    /^Error: broken\.ts: /,
  );
});

test("an allowlist entry that matches the wrong count is reported", () => {
  const entry = { rule: "R1", file: "snippet.ts", expression: "reservations", count: 1 };
  const one = findViolations(`${SNIPPET_IMPORTS}db.insert(reservations);`, "snippet.ts", tables);
  assert.deepEqual(applyAllowlist(one, [entry]).stale, []);
  assert.equal(applyAllowlist([...one, ...one], [entry]).stale[0].matched, 2);
  assert.equal(applyAllowlist([], [entry]).stale[0].matched, 0);
});

test("a helper file may break its own rule only, and is reported once it stops", () => {
  const violation = (rule, file) => ({ rule, file, line: 1, expression: "x" });
  const { remaining, missingHelpers } = applyAllowlist(
    [violation("R2", HELPER_FILES.R2), violation("R1", HELPER_FILES.R2)],
    [],
  );
  // The status helper may update reservations, not insert them.
  assert.deepEqual(remaining, [violation("R1", HELPER_FILES.R2)]);
  assert.deepEqual(missingHelpers, [HELPER_FILES.R1]);
});

test("reservation status writes and inserts go through the helpers", () => {
  const files = listSourceFiles();
  assert.ok(files.length > 1000, `only ${files.length} source files found`);

  const violations = files.flatMap((file) =>
    findViolations(readFileSync(path.join(ROOT, file), "utf8"), file, tables),
  );
  const { remaining, stale, missingHelpers } = applyAllowlist(violations, ALLOWLIST);

  const help =
    "See [DL-12] in docs/code-review/04-data-layer.md: change a status with " +
    "changeReservationStatus, insert with insertReservation, and run the returned " +
    "effects with runReservationEffects after commit. Fix or remove an allowlist " +
    "entry that matches the wrong count, and update HELPER_FILES when a helper file " +
    "has no write left.";
  assert.deepEqual(
    {
      violations: remaining.map(
        (v) => `${v.file}:${v.line} ${v.rule} ${RULES[v.rule]}: ${v.expression}`,
      ),
      allowlistEntriesWithWrongCount: stale.map(
        (e) => `${e.rule} ${e.file} ${e.expression}: ${e.matched} of ${e.count}`,
      ),
      helperFilesWithNoWrite: missingHelpers,
    },
    { violations: [], allowlistEntriesWithWrongCount: [], helperFilesWithNoWrite: [] },
    help,
  );
});
