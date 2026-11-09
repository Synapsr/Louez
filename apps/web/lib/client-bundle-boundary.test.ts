import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// TypeScript 7 (the app's compiler) has no JavaScript parser API yet: the
// classic compiler, 5.9, parses here, as it does for apps/voice-relay.
import ts from "typescript-5";

// The rich-text sanitiser parses HTML with sanitize-html (htmlparser2,
// postcss): server code only. This walks the imports of every client module
// ("use client"), through the app and the workspace packages, the way the
// bundler would follow them, and fails when one reaches the sanitiser.
// Type-only imports are erased and not followed, and neither is a server
// action module ("use server"): the client gets references, not its code.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(webRoot, "../..");
const SKIPPED_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);

/** What no client module may reach. */
const FORBIDDEN_SPECIFIERS = new Set(["sanitize-html", "@louez/utils/sanitize-rich-text"]);
const FORBIDDEN_FILES = new Set([join(repoRoot, "packages/utils/src/html/sanitize-rich-text.ts")]);

const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

const listSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** The directive prologue of a module: its leading string statements, comments aside. */
function directivesOf(source: ts.SourceFile): string[] {
  const directives: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  return directives;
}

/** Whether an import only brings types, so the compiler erases it. */
const isTypeOnlyImport = (node: ts.ImportDeclaration) => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  // `import { type A, type B } from "x"`: every binding is a type, nothing is loaded.
  const bindings = clause.namedBindings;
  return (
    !clause.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
};

/** A module specifier as written, or a dynamic template's fixed head ending in `*`. */
const specifierText = (node: ts.Node | undefined): string | null => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return `${node.head.text}*`;
  return null;
};

/** What a module is, from the TypeScript parser: its directives and its run-time imports. */
function readModule(file: string, text: string) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  /** Dynamic loads whose module is not written out: the walk cannot follow them. */
  const unresolved: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node)) {
        const text = specifierText(node.moduleSpecifier);
        if (text) specifiers.push(text);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) {
        const text = specifierText(node.moduleSpecifier);
        if (text) specifiers.push(text);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        const text = specifierText(node.moduleReference.expression);
        if (text) specifiers.push(text);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isLoad =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require");
      if (isLoad) {
        const argument = node.arguments[0];
        const text = specifierText(argument);
        if (text && !text.endsWith("*")) specifiers.push(text);
        else {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          unresolved.push(`${line + 1}: ${node.getText(source).slice(0, 80)}`);
          if (text) specifiers.push(text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const directives = directivesOf(source);
  return {
    client: directives.includes("use client"),
    serverActions: directives.includes("use server"),
    specifiers,
    unresolved,
  };
}

/**
 * Client-reachable modules allowed a dynamic load the walk cannot follow,
 * each with why it cannot reach the sanitiser. Empty: add one only with its
 * reason.
 */
const UNRESOLVED_ALLOWED = new Map<string, string>([]);

/** Whether a specifier names, or (a template's head) may name, a forbidden module. */
const isForbidden = (specifier: string) =>
  specifier.endsWith("*")
    ? [...FORBIDDEN_SPECIFIERS].some((forbidden) => forbidden.startsWith(specifier.slice(0, -1)))
    : FORBIDDEN_SPECIFIERS.has(specifier);

const withExtension = (base: string): string | null => {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension;
  }
  return null;
};

/** A workspace package's file for a subpath, from its `exports`. */
function resolveWorkspace(specifier: string): string | null {
  const [, scope, rest = ""] = /^@louez\/([^/]+)\/?(.*)$/.exec(specifier) ?? [];
  if (!scope) return null;
  const packageDir = join(repoRoot, "packages", scope);
  const manifestPath = join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    main?: string;
    exports?: Record<string, string | { default?: string; import?: string }>;
  };
  const subpath = rest ? `./${rest}` : ".";
  const exportsMap = manifest.exports ?? {};
  const pick = (target: string | { default?: string; import?: string } | undefined) =>
    typeof target === "string" ? target : (target?.import ?? target?.default);
  let target = pick(exportsMap[subpath]);
  if (!target) {
    for (const [pattern, value] of Object.entries(exportsMap)) {
      if (!pattern.endsWith("/*")) continue;
      const prefix = pattern.slice(0, -1);
      const resolved = pick(value);
      if (subpath.startsWith(prefix) && resolved) {
        target = resolved.replace("*", subpath.slice(prefix.length));
        break;
      }
    }
  }
  if (!target && subpath === "." && manifest.main) target = manifest.main;
  return target ? withExtension(join(packageDir, target)) : null;
}

function resolveSpecifier(specifier: string, from: string): string | null {
  if (specifier.startsWith("@/")) return withExtension(join(webRoot, specifier.slice(2)));
  if (specifier.startsWith(".")) return withExtension(resolve(dirname(from), specifier));
  if (specifier.startsWith("@louez/")) return resolveWorkspace(specifier);
  return null;
}

test("no client module reaches the rich-text sanitiser", () => {
  const modules = new Map<string, ReturnType<typeof readModule>>();
  const moduleOf = (file: string) => {
    let module = modules.get(file);
    if (!module) {
      module = readModule(file, readFileSync(file, "utf8"));
      modules.set(file, module);
    }
    return module;
  };
  const clientModules = listSources(webRoot).filter((file) => moduleOf(file).client);
  assert.ok(clientModules.length > 50, `only ${clientModules.length} client modules found`);

  const offenders: string[] = [];
  const visited = new Set<string>();
  for (const entry of clientModules) {
    const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
    while (queue.length > 0) {
      const { file, chain } = queue.shift() ?? { file: "", chain: [] };
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of moduleOf(file).specifiers) {
        const target = resolveSpecifier(specifier, file);
        if (isForbidden(specifier) || (target && FORBIDDEN_FILES.has(target))) {
          offenders.push([...chain.map((step) => relative(repoRoot, step)), specifier].join(" → "));
          continue;
        }
        if (!target || visited.has(target)) continue;
        if (moduleOf(target).serverActions) continue;
        queue.push({ file: target, chain: [...chain, target] });
      }
    }
  }
  assert.deepEqual(offenders, [], "These client imports pull the sanitiser into the browser");

  // A load the walk cannot follow could reach the sanitiser unseen.
  const unfollowed = [...visited].flatMap((file) => {
    const path = relative(repoRoot, file);
    if (UNRESOLVED_ALLOWED.has(path)) return [];
    return moduleOf(file).unresolved.map((load) => `${path}:${load}`);
  });
  assert.deepEqual(
    unfollowed,
    [],
    "Client-reachable dynamic loads the walk cannot follow: write the module out, or allow it in UNRESOLVED_ALLOWED with the reason",
  );
});

test("the parser reads directives and every kind of import", () => {
  const module = readModule(
    "fixture.tsx",
    [
      "/** A comment first. */",
      "// And another.",
      '"use client";',
      'import type { A } from "@louez/utils/sanitize-rich-text";',
      'import { type B } from "./only-types";',
      'import { type C, d } from "./c";',
      'export * from "./d";',
      'export type { E } from "./e";',
      'import "./f";',
      "// import { x } from './commented';",
      'const g = await import ("./g");',
      "const h = await import(`./h`);",
      "const i = await import(`./locales/${locale}`);",
      'const j = require("./j");',
      'const k = <p>Don\'t stop: "./not-an-import"</p>;',
    ].join("\n"),
  );
  assert.equal(module.client, true);
  assert.deepEqual(module.specifiers, ["./c", "./d", "./f", "./g", "./h", "./locales/*", "./j"]);
  assert.deepEqual(module.unresolved, ["13: import(`./locales/${locale}`)"]);
  assert.deepEqual(
    readModule("b.ts", "const load = (name: string) => import(`./util.${name}`);\nrequire(name);")
      .unresolved,
    ["1: import(`./util.${name}`)", "2: require(name)"],
  );
  assert.equal(readModule("a.ts", '"use server";\nexport const x = 1;').serverActions, true);
  assert.equal(readModule("a.ts", 'const x = "use client";').client, false);
  assert.equal(isForbidden("@louez/utils/*"), true);
  assert.equal(isForbidden("./locales/*"), false);
});
