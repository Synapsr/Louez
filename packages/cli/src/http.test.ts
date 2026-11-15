import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { UsageError } from "./args.js";
import { buildHeaders, requestUrl, resolveBaseUrl, send } from "./http.js";
import { startFakeApi, type FakeApi } from "./testing/fake-api.js";

const servers: FakeApi[] = [];
after(() => Promise.all(servers.map((server) => server.close())));

describe("headers", () => {
  test("carry the key, and the idempotency key and confirmation when given", () => {
    const headers = buildHeaders({
      apiKey: "lz_test",
      userAgent: "louez-cli/0",
      idempotencyKey: "k1",
      confirmation: "apr_1",
      hasBody: true,
    });
    assert.equal(headers.get("Authorization"), "Bearer lz_test");
    assert.equal(headers.get("Idempotency-Key"), "k1");
    assert.equal(headers.get("Louez-Confirmation"), "apr_1");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Accept"), "application/json");
  });

  test("leave out what was not given", () => {
    const headers = buildHeaders({ apiKey: "lz_test", userAgent: "louez-cli/0", hasBody: false });
    assert.equal(headers.get("Idempotency-Key"), null);
    assert.equal(headers.get("Louez-Confirmation"), null);
    assert.equal(headers.get("Content-Type"), null);
  });
});

describe("the base URL", () => {
  test("is https, or http on this machine or a Localify host", () => {
    assert.equal(
      resolveBaseUrl("https://app.louez.io/api/v1/", false).href,
      "https://app.louez.io/api/v1",
    );
    for (const local of [
      "http://localhost:3000/api/v1",
      "http://127.0.0.1:3000/api/v1",
      "http://[::1]:3000/api/v1",
      "http://louez.localify/api/v1",
    ]) {
      assert.doesNotThrow(() => resolveBaseUrl(local, false), local);
    }
  });

  test("refuses http elsewhere unless --insecure, and any other scheme", () => {
    assert.throws(() => resolveBaseUrl("http://louez.example/api/v1", false), /not https/);
    assert.equal(
      resolveBaseUrl("http://louez.example/api/v1", true).origin,
      "http://louez.example",
    );
    assert.throws(() => resolveBaseUrl("ftp://louez.example", true), /must be https/);
    // A name that only looks local.
    assert.throws(() => resolveBaseUrl("http://localhost.example.com/api/v1", false), /not https/);
  });

  test("refuses credentials, a query or a fragment in it", () => {
    assert.throws(() => resolveBaseUrl("https://user:pass@app.louez.io", false), /user name/);
    assert.throws(() => resolveBaseUrl("https://app.louez.io/api/v1?key=lz_x", false), /query/);
    assert.throws(() => resolveBaseUrl("not a url", false), UsageError);
  });

  test("only ever has paths under it on its own origin", () => {
    const base = resolveBaseUrl("https://app.louez.io/api/v1", false);
    assert.equal(
      requestUrl(base, "/reservations?status=pending", new URLSearchParams({ limit: "2" })).href,
      "https://app.louez.io/api/v1/reservations?status=pending&limit=2",
    );
    for (const path of [
      "//evil.example/x",
      "https://evil.example/x",
      "reservations",
      "/a b",
      "/\\evil",
    ]) {
      assert.throws(() => requestUrl(base, path), UsageError, path);
    }
  });
});

describe("sending", () => {
  test("never follows a redirect: the next server gets nothing, the key least of all", async () => {
    const elsewhere = await startFakeApi((_, response) => response.end("{}"));
    servers.push(elsewhere);
    const api = await startFakeApi((_, response) => {
      response.writeHead(302, { Location: `${elsewhere.origin}/steal` });
      response.end();
    });
    servers.push(api);

    const result = await send(globalThis.fetch, {
      method: "GET",
      url: new URL(`${api.url}/stores`),
      headers: buildHeaders({ apiKey: "lz_secret", userAgent: "t", hasBody: false }),
      timeoutMs: 5000,
    });
    assert.ok(result.ok);
    assert.equal(result.answer.status, 302);
    assert.equal(elsewhere.received.length, 0);
    assert.equal(api.received[0]?.headers.authorization, "Bearer lz_secret");
  });

  test("answers a network failure as such", async () => {
    const api = await startFakeApi(() => {});
    await api.close();
    const result = await send(globalThis.fetch, {
      method: "GET",
      url: new URL(`${api.url}/stores`),
      headers: new Headers(),
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
  });
});
