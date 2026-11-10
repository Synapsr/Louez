import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
  MAX_RESPONSE_HEADER_BYTES,
  createPinnedTransport,
  guardedGet,
  type GuardedFetch,
  type GuardedGetOptions,
} from "./guarded-fetch";
import { createLocalHostTransport } from "./testing";

// The deadlines unref their timers, so a hung lookup never keeps a server
// alive. A test that waits on one needs something else to hold the event loop
// open: Node 22's runner otherwise cancels it.
const keepAlive = setInterval(() => {}, 1_000);
after(() => clearInterval(keepAlive));

// The guarded GET with a fake transport: nothing leaves the process. The real
// transport (CIMD) refuses private addresses by throwing; the fakes do too.

const PRIVATE = new TypeError("metadata hostname must resolve only to public-routable addresses");

const options = (fetchResource: GuardedFetch): GuardedGetOptions => ({
  accept: "image/*",
  maxBytes: 16,
  timeoutMs: 50,
  maxRedirects: 2,
  fetchResource,
});

/** A transport answering from a table of URLs; a host named `internal` is private. */
const fakeTransport = (routes: Record<string, () => Response>) => {
  const asked: string[] = [];
  const fetchResource: GuardedFetch = async (input) => {
    const url = String(input);
    asked.push(url);
    if (new URL(url).hostname.includes("internal")) throw PRIVATE;
    return routes[url]?.() ?? new Response(null, { status: 404 });
  };
  return { asked, fetchResource };
};

describe("guardedGet", () => {
  test("reads a 200 answer within the cap", async () => {
    const { fetchResource } = fakeTransport({
      "https://cdn.example.org/a.png": () => new Response("small"),
    });
    const result = await guardedGet("https://cdn.example.org/a.png", options(fetchResource));
    assert.ok(result.ok);
    assert.equal(new TextDecoder().decode(result.body), "small");
  });

  test("refuses a private address, also behind a redirect", async () => {
    const { asked, fetchResource } = fakeTransport({
      "https://cdn.example.org/a.png": () =>
        new Response(null, { status: 302, headers: { location: "https://internal.lan/a.png" } }),
    });
    assert.deepEqual(await guardedGet("https://internal.lan/a.png", options(fetchResource)), {
      ok: false,
      reason: "unreachable",
    });
    assert.deepEqual(await guardedGet("https://cdn.example.org/a.png", options(fetchResource)), {
      ok: false,
      reason: "unreachable",
    });
    assert.deepEqual(asked, [
      "https://internal.lan/a.png",
      "https://cdn.example.org/a.png",
      "https://internal.lan/a.png",
    ]);
  });

  test("never asks for plain HTTP or a URL with credentials", async () => {
    const { asked, fetchResource } = fakeTransport({
      "https://cdn.example.org/a.png": () =>
        new Response(null, { status: 301, headers: { location: "http://cdn.example.org/a.png" } }),
    });
    for (const url of [
      "http://cdn.example.org/a.png",
      "https://user:pass@cdn.example.org/a.png",
      "file:///etc/passwd",
      "not a url",
      "https://cdn.example.org/a.png",
    ]) {
      const result = await guardedGet(url, options(fetchResource));
      assert.deepEqual(result, { ok: false, reason: "not_https" }, url);
    }
    assert.deepEqual(asked, ["https://cdn.example.org/a.png"]);
  });

  test("stops at the redirect limit, and on an answer other than 200", async () => {
    const loop = () =>
      new Response(null, { status: 307, headers: { location: "https://cdn.example.org/loop" } });
    const { asked, fetchResource } = fakeTransport({
      "https://cdn.example.org/loop": loop,
      "https://cdn.example.org/gone": () => new Response("no", { status: 410 }),
    });
    assert.deepEqual(await guardedGet("https://cdn.example.org/loop", options(fetchResource)), {
      ok: false,
      reason: "too_many_redirects",
    });
    assert.equal(asked.length, 3, "the first request and two redirects");
    assert.deepEqual(await guardedGet("https://cdn.example.org/gone", options(fetchResource)), {
      ok: false,
      reason: "status",
      status: 410,
    });
  });

  test("stops reading past the cap, declared or streamed", async () => {
    let cancelled = false;
    const { fetchResource } = fakeTransport({
      "https://cdn.example.org/declared": () =>
        new Response("x".repeat(17), { headers: { "content-length": "17" } }),
      "https://cdn.example.org/endless": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: (controller) => controller.enqueue(new Uint8Array(8)),
            cancel: () => {
              cancelled = true;
            },
          }),
        ),
    });
    for (const url of ["https://cdn.example.org/declared", "https://cdn.example.org/endless"]) {
      assert.deepEqual(await guardedGet(url, options(fetchResource)), {
        ok: false,
        reason: "too_large",
      });
    }
    assert.ok(cancelled, "the endless body is cancelled");
  });

  test("gives up at the timeout, even when the transport never answers", async () => {
    const hung: GuardedFetch = () => new Promise<Response>(() => {});
    assert.deepEqual(await guardedGet("https://slow.example.org/a.png", options(hung)), {
      ok: false,
      reason: "timeout",
    });
  });

  test("hands its caller the transport call it leaves running at the deadline", async () => {
    let settle: (response: Response) => void = () => {};
    const hung: GuardedFetch = () =>
      new Promise<Response>((resolve) => {
        settle = resolve;
      });
    const tracked: Promise<unknown>[] = [];
    const result = await guardedGet("https://slow.example.org/a.png", {
      ...options(hung),
      track: (work) => tracked.push(work),
    });
    assert.deepEqual(result, { ok: false, reason: "timeout" });
    assert.equal(tracked.length, 1);
    let settled = false;
    void Promise.allSettled(tracked).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the lookup still runs after the answer");
    settle(new Response(null, { status: 404 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, true);
  });
});

describe("the pinned transport", () => {
  // Cursor's metadata document, served as cursor.com serves it: with a long
  // content security policy (12.9 KB of its 13.6 KB of headers, 2026-11-10).
  const DOCUMENT = {
    client_id: "https://cursor.com/oauth/mcp-client.json",
    client_name: "Cursor",
    redirect_uris: ["https://www.cursor.com/agents/mcp/oauth/callback"],
    token_endpoint_auth_method: "none",
  };
  const servedWithHeaders = (bytes: number) =>
    `https://cursor.com/oauth/mcp-client.json?h=${bytes}`;
  let local: Awaited<ReturnType<typeof createLocalHostTransport>>;

  before(async () => {
    local = await createLocalHostTransport((request, response) => {
      const bytes = Number(new URL(request.url ?? "/", "http://local").searchParams.get("h"));
      response.writeHead(200, {
        "content-type": "application/json",
        "content-security-policy": `default-src 'self'; ${"x".repeat(bytes)}`,
      });
      response.end(JSON.stringify(DOCUMENT));
    });
  });
  after(() => local.close());

  test("reads a document whose headers pass Node's 16 KiB default", async () => {
    const url = servedWithHeaders(20 * 1024);
    const response = await local.transport()(url, { headers: { accept: "application/json" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), DOCUMENT);

    const read = await guardedGet(url, {
      accept: "application/json",
      maxBytes: 5120,
      timeoutMs: 2_000,
      maxRedirects: 0,
      fetchResource: local.transport(),
    });
    assert.ok(read.ok);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(read.body)), DOCUMENT);

    // Node's default limit refuses the same answer.
    await assert.rejects(async () => local.transport({ maxHeaderSize: 16 * 1024 })(url), {
      code: "HPE_HEADER_OVERFLOW",
    });
  });

  test("refuses headers past its limit, and the guarded GET fails cleanly", async () => {
    const url = servedWithHeaders(MAX_RESPONSE_HEADER_BYTES + 1024);
    await assert.rejects(async () => local.transport()(url), { code: "HPE_HEADER_OVERFLOW" });
    const read = await guardedGet(url, {
      accept: "application/json",
      maxBytes: 5120,
      timeoutMs: 2_000,
      maxRedirects: 0,
      fetchResource: local.transport(),
    });
    assert.deepEqual(read, { ok: false, reason: "unreachable" });
  });

  test("keeps its own guards: HTTPS, GET or HEAD, public addresses only", async () => {
    const privateHost = createPinnedTransport({
      resolve: async () => [
        { address: "93.184.215.14", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    });
    await assert.rejects(async () => privateHost("https://cursor.com/oauth/mcp-client.json"), {
      message: /public-routable/,
    });
    const transport = createPinnedTransport({ resolve: async () => [] });
    await assert.rejects(async () => transport("http://cursor.com/oauth/mcp-client.json"), {
      message: /HTTPS/,
    });
    await assert.rejects(
      async () => transport("https://cursor.com/oauth/mcp-client.json", { method: "POST" }),
      { message: /GET and HEAD/ },
    );
    await assert.rejects(async () => transport("https://cursor.com/oauth/mcp-client.json"), {
      message: /no DNS addresses/,
    });
  });
});
