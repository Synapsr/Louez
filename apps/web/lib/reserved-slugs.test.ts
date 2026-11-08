import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isReservedSlug } from "@louez/validations";

// A store's web address is also a first path segment: `/<slug>` on a local
// domain, and every request the proxy does not route elsewhere. An address
// that is one of the app's own first segments would shadow that page, or be
// shadowed by it, so each one must be reserved.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/** An interception marker, `(.)`, `(..)` or `(...)`, maybe repeated: `(..)(..)photo`. */
const INTERCEPTION_MARKER = /^(?:\(\.{1,3}\))+/;

/**
 * First path segments of the app router, as Next.js reads its folders: a
 * route group `(name)` and a parallel route slot `@name` add no segment, so
 * the walk goes through them; an intercepting route `(.)name` serves `name`;
 * a dynamic segment `[name]` and a private folder `_name` are no fixed root.
 */
function routeRoots(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const name = entry.name;
    if (
      (name.startsWith("(") && name.endsWith(")") && !INTERCEPTION_MARKER.test(name)) ||
      name.startsWith("@")
    ) {
      return routeRoots(join(dir, name));
    }
    const segment = name.replace(INTERCEPTION_MARKER, "");
    if (!segment || segment.startsWith("_") || segment.startsWith("[")) return [];
    return [segment];
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

test("the walk reads route groups, parallel slots and intercepting routes as Next.js does", () => {
  const root = mkdtempSync(join(tmpdir(), "louez-route-roots-"));
  try {
    for (const path of [
      "(marketing)/pricing",
      "(marketing)/(nested)/about",
      "@modal/(.)photos",
      "@modal/default-slot-page",
      "(..)(..)gallery",
      "(...)login-modal",
      "[slug]/shop",
      "[...rest]",
      "_components/x",
      "plain",
    ]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    writeFileSync(join(root, "layout.tsx"), "");
    assert.deepEqual(routeRoots(root).sort(), [
      "about",
      "default-slot-page",
      "gallery",
      "login-modal",
      "photos",
      "plain",
      "pricing",
    ]);
  } finally {
    rmSync(root, { recursive: true });
  }
});
