import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isReservedSlug } from "@louez/validations";

// A store's web address is also a first path segment: `/<slug>` on a local
// domain, and every request the proxy does not route elsewhere. An address
// that is one of the app's own first segments would shadow that page, or be
// shadowed by it, so each one must be reserved.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/** First path segments of the app router: folders of `app`, through route groups. */
function routeRoots(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const { name } = entry;
    // A route group adds no segment; a private folder or a dynamic one is no root.
    if (name.startsWith("(") && name.endsWith(")")) return routeRoots(join(dir, name));
    if (name.startsWith("_") || name.startsWith("[")) return [];
    return [name];
  });
}

/** First segments the proxy routes itself: its dashboard routes and its prefix checks. */
function proxyRoots(): string[] {
  const source = readFileSync(join(webRoot, "proxy.ts"), "utf8");
  const routes = /const DASHBOARD_ROUTES = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
  assert.ok(routes, "proxy.ts declares DASHBOARD_ROUTES");
  const literals = [
    ...routes.matchAll(/"\/([^"/]*)/g),
    ...source.matchAll(/(?:startsWith\(|=== )"\/([a-z0-9-]+)/g),
  ];
  return literals.map((match) => match[1] ?? "");
}

/** Only what a store could take: the slug rules' letters, digits and hyphens, 3 to 50. */
const couldBeASlug = (segment: string) => /^[a-z0-9-]{3,50}$/.test(segment);

test("every first segment of the app and of the proxy is a reserved store address", () => {
  const roots = [...new Set([...routeRoots(join(webRoot, "app")), ...proxyRoots()])]
    .filter(couldBeASlug)
    .sort();
  assert.ok(roots.includes("dashboard") && roots.includes("online-store"), roots.join(", "));
  assert.deepEqual(
    roots.filter((root) => !isReservedSlug(root)),
    [],
    "Add these to RESERVED_SLUGS in packages/validations/src/onboarding.ts",
  );
});
