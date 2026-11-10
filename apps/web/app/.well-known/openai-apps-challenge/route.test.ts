import assert from "node:assert/strict";
import { mock, test } from "node:test";

// The route serves the deployment's OPENAI_APPS_CHALLENGE; the token rules are
// tested in lib/openai-apps-challenge.test.ts. connection() needs a request
// scope, which a test has not: it is replaced by one that counts its calls.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.OPENAI_APPS_CHALLENGE = "  route-token-42\n";

let connections = 0;
mock.module("next/server", {
  namedExports: {
    connection: async () => {
      connections += 1;
    },
  },
});

test("GET waits for the request, then serves the deployment's token as plain text", async () => {
  const { GET } = await import("./route");
  const response = await GET();
  assert.equal(connections, 1, "read at request time, never prerendered");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "route-token-42");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
