import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

const isClientModule = (source: string) => /^\s*(['"])use client\1/.test(source);
/** A server action module: a client gets references to it, never its code. */
const isServerActionModule = (source: string) => /^\s*(['"])use server\1/.test(source);

/** Leaves comments out, so an import named in one is not followed. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The specifiers a module loads at run time: no `import type`, no `export type`. */
function runtimeSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  const statement = /\b(import|export)\s+(type\s+)?([^;]*?)\bfrom\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(statement)) {
    if (match[2]) continue;
    specifiers.push(match[4] ?? "");
  }
  for (const match of code.matchAll(/\bimport\s*["']([^"']+)["']/g))
    specifiers.push(match[1] ?? "");
  for (const match of code.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1] ?? "");
  }
  return specifiers;
}

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
  const sources = listSources(webRoot);
  const clientModules = sources.filter((file) => isClientModule(readFileSync(file, "utf8")));
  assert.ok(clientModules.length > 50, `only ${clientModules.length} client modules found`);

  const cache = new Map<string, string[]>();
  const importsOf = (file: string) => {
    let specifiers = cache.get(file);
    if (!specifiers) {
      specifiers = runtimeSpecifiers(readFileSync(file, "utf8"));
      cache.set(file, specifiers);
    }
    return specifiers;
  };

  const offenders: string[] = [];
  const visited = new Set<string>();
  for (const entry of clientModules) {
    const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
    while (queue.length > 0) {
      const { file, chain } = queue.shift() ?? { file: "", chain: [] };
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of importsOf(file)) {
        const target = resolveSpecifier(specifier, file);
        if (FORBIDDEN_SPECIFIERS.has(specifier) || (target && FORBIDDEN_FILES.has(target))) {
          offenders.push([...chain.map((step) => relative(repoRoot, step)), specifier].join(" → "));
          continue;
        }
        if (!target || visited.has(target)) continue;
        if (isServerActionModule(readFileSync(target, "utf8"))) continue;
        queue.push({ file: target, chain: [...chain, target] });
      }
    }
  }
  assert.deepEqual(offenders, [], "These client imports pull the sanitiser into the browser");
});

test("the walk sees a value import and skips a type-only one", () => {
  assert.deepEqual(
    runtimeSpecifiers(
      [
        'import type { A } from "@louez/utils/sanitize-rich-text";',
        'import { type B, c } from "./c";',
        'export * from "./d";',
        'export type { E } from "./e";',
        'import "./f";',
        "// import { x } from './commented';",
        'const g = await import("./g");',
      ].join("\n"),
    ),
    ["./c", "./d", "./f", "./g"],
  );
});
