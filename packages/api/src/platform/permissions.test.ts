import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const { allows, normalizeScopes } = await import("./permissions");

describe("normalizeScopes", () => {
  test("a domain missing from a key created before it existed is none", () => {
    const scopes = normalizeScopes({
      reservations: "write",
      products: "read",
      customers: "none",
      categories: "write",
      payments: "read",
      analytics: "read",
      settings: "none",
    });
    assert.equal(scopes.team, "none");
    assert.equal(scopes.billing, "none");
    assert.equal(scopes.integrations, "none");
    assert.equal(scopes.online_store, "none");
    assert.equal(scopes.reservations, "write");
  });

  test("an unknown value is none, and analytics never goes above read", () => {
    const scopes = normalizeScopes({ reservations: "admin", analytics: "write" } as never);
    assert.equal(scopes.reservations, "none");
    assert.equal(scopes.analytics, "read");
    assert.equal(normalizeScopes(null).products, "none");
  });
});

describe("allows: the member's role cut down to the connection", () => {
  const full = normalizeScopes({
    reservations: "write",
    products: "write",
    customers: "write",
    categories: "write",
    payments: "write",
    analytics: "read",
    settings: "write",
    team: "write",
  });
  const readOnly = normalizeScopes({ categories: "read", settings: "read" });

  test("a session has only its role", () => {
    assert.equal(
      allows("owner", null, { domain: "categories", level: "write", role: "delete" }),
      true,
    );
    assert.equal(allows("member", null, { domain: "categories", level: "write" }), true);
    assert.equal(
      allows("member", null, { domain: "categories", level: "write", role: "delete" }),
      false,
    );
    assert.equal(
      allows("member", null, { domain: "settings", level: "write", role: "manage_settings" }),
      false,
    );
  });

  test("a connection never goes beyond the role, whatever it was granted", () => {
    assert.equal(
      allows("member", full, { domain: "team", level: "write", role: "manage_members" }),
      false,
    );
    assert.equal(
      allows("owner", full, { domain: "team", level: "write", role: "manage_members" }),
      true,
    );
  });

  test("a role never goes beyond the connection", () => {
    assert.equal(allows("owner", readOnly, { domain: "categories", level: "read" }), true);
    assert.equal(allows("owner", readOnly, { domain: "categories", level: "write" }), false);
    assert.equal(allows("owner", readOnly, { domain: "products", level: "read" }), false);
  });
});
