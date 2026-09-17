import assert from "node:assert/strict";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    origin: { type: "string" },
  },
});
if (!values["base-url"] || !values.origin) {
  throw new Error("Pass --base-url http(s)://app-host --origin https://marketing-host");
}
const endpoint = new URL("/api/marketing/session", values["base-url"]);
const origin = new URL(values.origin).origin;
const request = (method, requestOrigin) =>
  fetch(endpoint, {
    method,
    headers: { Origin: requestOrigin },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

for (const method of ["OPTIONS", "GET"]) {
  const response = await request(method, origin);
  assert.equal(response.status, method === "OPTIONS" ? 204 : 200, `${method} status`);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.match(response.headers.get("vary") ?? "", /Origin/i);
  assert.equal(response.headers.get("set-cookie"), null);
  if (method === "GET") assert.deepEqual(await response.json(), { authenticated: false });
}
for (const method of ["OPTIONS", "GET"]) {
  const response = await request(method, "https://untrusted.invalid");
  assert.equal(response.status, 403, `${method} rejects untrusted origin`);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
console.log("Marketing session HTTP checks passed: anonymous GET, preflight, private CORS, rejected origin.");
