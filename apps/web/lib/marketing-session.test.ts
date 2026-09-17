import assert from "node:assert/strict";
import test from "node:test";
import { marketingOrigins, marketingSessionResponse } from "./marketing-session";

const origins = marketingOrigins("https://app.louez.io");
const noError = () => assert.fail("Unexpected error");
const request = (origin = "https://louez.io", method = "GET") =>
  new Request("https://app.louez.io/api/marketing/session", { method, headers: { origin } });

test("production and preproduction session origins remain separate", () => {
  assert.deepEqual(origins, ["https://louez.io", "https://www.louez.io"]);
  assert.deepEqual(marketingOrigins("https://app.louez.app"), [
    "https://louez.app",
    "https://www.louez.app",
  ]);
  assert.deepEqual(marketingOrigins("https://app.louez.localify"), []);
  assert.deepEqual(
    marketingOrigins("https://app.louez.localify", ["https://landing.louez-website.localify"]),
    ["https://landing.louez-website.localify"],
  );
});

for (const authenticated of [true, false]) {
  test(`session status ${authenticated} exposes only a boolean with private CORS`, async () => {
    const response = await marketingSessionResponse(
      request(),
      origins,
      async () => authenticated,
      noError,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "https://louez.io");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.equal(response.headers.get("vary"), "Origin");
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("untrusted, missing, malformed and other-environment origins never read a session", async () => {
  for (const origin of [
    "",
    "null",
    "https://louez.io.evil.test",
    "https://louez.io/",
    "https://louez.app",
  ]) {
    const response = await marketingSessionResponse(
      request(origin),
      origins,
      async () => assert.fail("Session must not be read"),
      noError,
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

test("preflight does not read or refresh the session", async () => {
  const response = await marketingSessionResponse(
    request("https://louez.io", "OPTIONS"),
    origins,
    async () => assert.fail("Session must not be read"),
    noError,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
});

test("database failure stays unknown rather than claiming an anonymous visitor", async () => {
  let logged = false;
  const response = await marketingSessionResponse(
    request(),
    origins,
    async () => {
      throw new Error("unavailable");
    },
    () => {
      logged = true;
    },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "session_unavailable" });
  assert.equal(logged, true);
});
