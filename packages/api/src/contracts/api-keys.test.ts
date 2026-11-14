import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import {
  API_KEY_DOMAINS,
  API_KEY_PERMISSION_PRESETS,
  apiKeyPermissionsSchema,
} from "./api-keys";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/utils/sanitize-rich-text"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const { API_DOMAINS } = await import("../platform/permissions");

// The domains the dashboard's form offers are API_KEY_DOMAINS, and its presets
// are API_KEY_PERMISSION_PRESETS: a domain a key may hold is in the form and in
// "full access", or this fails.

describe("API key domains", () => {
  test("are the schema's, in the form's order", () => {
    assert.deepEqual(API_KEY_DOMAINS, Object.keys(apiKeyPermissionsSchema.shape));
    assert.deepEqual(API_KEY_DOMAINS, [
      "reservations",
      "products",
      "customers",
      "categories",
      "payments",
      "analytics",
      "settings",
      "online_store",
      "team",
      "billing",
      "integrations",
    ]);
  });

  test("are every domain a connection may hold, but stores: a key is bound to its store", () => {
    assert.deepEqual(
      [...API_KEY_DOMAINS].sort(),
      API_DOMAINS.filter((domain) => domain !== "stores").sort(),
    );
  });

  test("each preset sets every domain, and the schema accepts it", () => {
    for (const [name, preset] of Object.entries(API_KEY_PERMISSION_PRESETS)) {
      assert.deepEqual(Object.keys(preset).sort(), [...API_KEY_DOMAINS].sort(), name);
      assert.deepEqual(apiKeyPermissionsSchema.parse(preset), preset, name);
    }
  });

  test("full access writes every domain, analytics read-only", () => {
    for (const domain of API_KEY_DOMAINS) {
      assert.equal(
        API_KEY_PERMISSION_PRESETS.full[domain],
        domain === "analytics" ? "read" : "write",
        domain,
      );
    }
  });

  test("read only reads every domain", () => {
    for (const domain of API_KEY_DOMAINS) {
      assert.equal(API_KEY_PERMISSION_PRESETS.readOnly[domain], "read", domain);
    }
  });
});
