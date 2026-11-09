import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { guardedGet, type GuardedFetch, type GuardedGetOptions } from "./guarded-fetch";

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
});
