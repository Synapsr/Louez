import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";

import {
  MAX_RESPONSE_HEADER_BYTES,
  bufferedTransport,
  createDnsResolve,
  createPinnedTransport,
  type ResolveHost,
  guardedGet,
  type GuardedFetch,
  type GuardedGetOptions,
} from "./guarded-fetch";
import { createLocalHostTransport, eventually } from "./testing";

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

/**
 * How long `work` takes to settle, in milliseconds, and whether it rejected;
 * after 3 seconds, unsettled.
 */
async function timed(work: () => unknown) {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"unsettled">((resolve) => {
    timer = setTimeout(() => resolve("unsettled"), 3_000);
  });
  const settled = Promise.resolve()
    .then(work)
    .then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
  const outcome = await Promise.race([settled, limit]).finally(() => clearTimeout(timer));
  return { ms: Date.now() - start, rejected: outcome === "rejected" };
}

/** A resolver that never answers, and says whether it was told to stop. */
const hangingResolver = () => {
  const state = { aborted: false };
  const resolve: ResolveHost = (_hostname, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        state.aborted = true;
        reject(signal.reason);
      });
    });
  return { state, resolve };
};

describe("what a refused answer or a slow lookup leaves behind", () => {
  // Each path answers its status and headers, part of a body, then stalls.
  let local: Awaited<ReturnType<typeof createLocalHostTransport>>;
  const at = (path: string) => `https://metadata.example.org${path}`;

  before(async () => {
    local = await createLocalHostTransport((request, response) => {
      const path = request.url ?? "/";
      if (path === "/redirect") {
        response.writeHead(302, { location: at("/elsewhere") });
      } else if (path === "/html") {
        response.writeHead(200, { "content-type": "text/html" });
      } else if (path === "/error") {
        response.writeHead(500, { "content-type": "application/json" });
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        if (path === "/large") response.write("x".repeat(8 * 1024));
      }
      response.write("{");
    });
  });
  after(() => local.close());

  const closed = (what: string) =>
    eventually(async () => (await local.openConnections()) === 0, 1_000, what);

  test("the buffered transport closes the connection of every answer it hands on", async () => {
    const transport = bufferedTransport(local.transport(), 5 * 1024);
    for (const [path, status] of [
      ["/redirect", 302],
      ["/html", 200],
      ["/error", 500],
    ] as const) {
      const response = await transport(at(path), { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, status, path);
      assert.equal(response.body, null, `${path}: nothing of the body is read`);
      await closed(path);
    }
    // Too large: the cap plus one byte, so the caller refuses it itself.
    const large = await transport(at("/large"), { signal: AbortSignal.timeout(5_000) });
    assert.equal((await large.arrayBuffer()).byteLength, 5 * 1024 + 1);
    await closed("/large");
    // A JSON body still coming when the caller gives up.
    const stalled = await timed(() =>
      transport(at("/stalled"), { signal: AbortSignal.timeout(150) }),
    );
    assert.ok(stalled.rejected);
    assert.ok(stalled.ms < 1_000, `rejected after ${stalled.ms} ms`);
    await closed("/stalled");
  });

  test("a guarded GET closes the connection of an answer it refuses or gives up on", async () => {
    const get = (path: string) =>
      guardedGet(at(path), {
        accept: "application/json",
        maxBytes: 5 * 1024,
        timeoutMs: 150,
        maxRedirects: 0,
        fetchResource: local.transport(),
      });
    assert.deepEqual(await get("/redirect"), { ok: false, reason: "too_many_redirects" });
    await closed("redirect");
    assert.deepEqual(await get("/error"), { ok: false, reason: "status", status: 500 });
    await closed("error");
    assert.deepEqual(await get("/large"), { ok: false, reason: "too_large" });
    await closed("too large");
    assert.deepEqual(await get("/stalled"), { ok: false, reason: "timeout" });
    await closed("timeout");
  });

  test("a lookup that never answers stops with the fetch, on time", async () => {
    const direct = hangingResolver();
    const transport = local.transport({ resolve: direct.resolve });
    const call = await timed(() => transport(at("/x"), { signal: AbortSignal.timeout(100) }));
    assert.ok(call.rejected);
    assert.ok(call.ms < 1_000, `rejected after ${call.ms} ms`);
    assert.ok(direct.state.aborted, "the lookup was told to stop");

    // A guarded GET stops its lookup at its own deadline.
    const viaGet = hangingResolver();
    const result = await guardedGet(at("/x"), {
      accept: "application/json",
      maxBytes: 16,
      timeoutMs: 100,
      maxRedirects: 0,
      fetchResource: local.transport({ resolve: viaGet.resolve }),
    });
    assert.deepEqual(result, { ok: false, reason: "timeout" });
    await eventually(async () => viaGet.state.aborted, 1_000, "the lookup was told to stop");
  });

  test("the DNS resolver cancels its queries on abort and at its own deadline", async () => {
    // A name server that never answers.
    const silent = createSocket("udp4");
    await new Promise<void>((resolve) => silent.bind(0, "127.0.0.1", resolve));
    const servers = [`127.0.0.1:${(silent.address() as AddressInfo).port}`];
    try {
      const patient = createDnsResolve({ servers, timeoutMs: 30_000 });
      const aborted = await timed(() => patient("cursor.com", AbortSignal.timeout(100)));
      assert.ok(aborted.rejected);
      assert.ok(aborted.ms < 1_000, `rejected after ${aborted.ms} ms`);

      const bounded = createDnsResolve({ servers, timeoutMs: 200 });
      const expired = await timed(() => bounded("cursor.com", new AbortController().signal));
      assert.ok(expired.rejected);
      assert.ok(expired.ms < 1_500, `rejected after ${expired.ms} ms`);

      // An address needs no query.
      assert.deepEqual(await bounded("93.184.215.14", new AbortController().signal), [
        { address: "93.184.215.14", family: 4 },
      ]);
    } finally {
      silent.close();
    }
  });
});
