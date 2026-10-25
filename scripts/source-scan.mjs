/**
 * Syntax helpers shared by the guard tests that scan the source for database
 * writes (reservation-writes.test.mjs, billing-marks.test.mjs). They read
 * syntax only, with no types and no tsconfig.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_FILES = ["packages/db/src/schema.ts", "packages/db/src/schema.voice.ts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JSX_EXTENSIONS = new Set([".tsx", ".js", ".mjs"]);

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

export function parseSource(code, file) {
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
export function walk(node, visit) {
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

export function unwrap(node) {
  let current = node;
  while (current && WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

export function isCall(node) {
  return node?.type === "CallExpression" || node?.type === "OptionalCallExpression";
}

export function isMember(node) {
  return node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression";
}

export function memberName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "StringLiteral") return member.property.value;
  return null;
}

/** `update` for `tx.update(t)`. */
export function calledMethod(call) {
  const callee = unwrap(call.callee);
  return isMember(callee) ? memberName(callee) : null;
}

/** The call a method is chained on: `tx.update(t)` in `tx.update(t).set(…)`. */
export function receiverCall(call) {
  const receiver = unwrap(unwrap(call.callee).object);
  return isCall(receiver) ? receiver : null;
}

export function propertyKey(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "StringLiteral") return property.key.value;
  if (property.key.type === "NumericLiteral") return String(property.key.value);
  return null;
}

/** The schema tables: export name → SQL name. */
export function readKnownTables() {
  const tables = new Map();
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
          const sqlName = init.arguments[0];
          tables.set(
            declarator.id.name,
            sqlName?.type === "StringLiteral" ? sqlName.value : declarator.id.name,
          );
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
export function readBindings(ast, tables) {
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

/** Source files under apps/ and packages/, without migrations, declarations and tests. */
export function listSourceFiles() {
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
