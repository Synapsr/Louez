import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { capabilities, outOfScopeServerModules } from "./inventory";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webRoot = join(repoRoot, "apps/web");
const SKIPPED_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** Leading comments and blank lines removed, so the first statement comes first. */
const stripLeadingTrivia = (source: string): string => {
  let rest = source.replace(/^\uFEFF/, "");
  for (;;) {
    const trimmed = rest.trimStart();
    if (trimmed.startsWith("//")) {
      const end = trimmed.indexOf("\n");
      rest = end === -1 ? "" : trimmed.slice(end + 1);
    } else if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      rest = end === -1 ? "" : trimmed.slice(end + 2);
    } else {
      return trimmed;
    }
  }
};

const isServerModule = (source: string): boolean =>
  /^(['"])use server\1/.test(stripLeadingTrivia(source));

/** Every runtime export: in a `"use server"` module, each one is a callable action. */
const exportedNames = (source: string): string[] => {
  const names = new Set<string>();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)) {
    names.add(match[1] ?? "");
  }
  for (const match of source.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) {
    names.add(match[1] ?? "");
  }
  for (const match of source.matchAll(/^export\s+(?!type\b)\{([^}]*)\}/gm)) {
    for (const part of (match[1] ?? "").split(",")) {
      const spec = part.trim();
      if (!spec || spec.startsWith("type ")) continue;
      names.add(
        spec
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? "",
      );
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add("default");
  names.delete("");
  return [...names];
};

const serverModules = listSourceFiles(webRoot)
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => isServerModule(source))
  .map(({ file, source }) => ({
    path: relative(repoRoot, file).split("\\").join("/"),
    exports: exportedNames(source),
  }));

const allSources = capabilities.flatMap((capability) =>
  capability.sources.map((source) => ({ id: capability.id, ...source })),
);

test("finds the dashboard's server modules", () => {
  // Guards the scanner itself: a broken directive check would pass everything.
  assert.ok(serverModules.length >= 40, `only ${serverModules.length} "use server" modules found`);
});

test('every "use server" export is in the inventory', () => {
  const outOfScope = new Set<string>(outOfScopeServerModules.map((module) => module.path));
  const inventoried = new Set(
    allSources
      .filter((source) => source.kind === "server-action")
      .map((source) => `${source.path}#${source.name}`),
  );

  const missing = serverModules
    .filter((module) => !outOfScope.has(module.path))
    .flatMap((module) => module.exports.map((name) => `${module.path}#${name}`))
    .filter((key) => !inventoried.has(key));

  assert.deepEqual(missing, [], `Add these exports to packages/api/src/platform/inventory.ts`);
});

test("server-action sources and out-of-scope modules point at real exports", () => {
  const modules = new Map(serverModules.map((module) => [module.path, new Set(module.exports)]));

  const stale = allSources
    .filter((source) => source.kind === "server-action")
    .filter((source) => !modules.get(source.path)?.has(source.name))
    .map((source) => `${source.id}: ${source.path}#${source.name}`);
  assert.deepEqual(stale, [], 'Server-action sources that are not a "use server" export');

  const notServer = outOfScopeServerModules
    .filter((module) => !modules.has(module.path))
    .map((module) => module.path);
  assert.deepEqual(notServer, [], 'Out-of-scope modules that are not "use server" modules');
});

test("capability ids are unique", () => {
  const seen = new Set<string>();
  const duplicates = capabilities
    .map((capability) => capability.id)
    .filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, []);
});

test("every source file exists and names something in it", () => {
  const missingFiles: string[] = [];
  const missingNames: string[] = [];

  for (const source of allSources) {
    const file = join(repoRoot, source.path);
    if (!existsSync(file)) {
      missingFiles.push(`${source.id}: ${source.path}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const needle =
      source.kind === "route"
        ? new RegExp(`export\\s+(?:async\\s+function|const)\\s+${source.name.split(" ")[0]}\\b`)
        : source.kind === "orpc"
          ? new RegExp(`\\b${source.name.split(".").pop()}\\b`)
          : source.kind === "mcp-tool"
            ? new RegExp(`['"]${source.name}['"]`)
            : null;
    if (needle && !needle.test(text))
      missingNames.push(`${source.id}: ${source.path} ${source.name}`);
  }

  assert.deepEqual(missingFiles, [], "Source files that do not exist");
  assert.deepEqual(missingNames, [], "Sources whose name is not in the file");
});
