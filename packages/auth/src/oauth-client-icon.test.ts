import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  MAX_ICON_BYTES,
  clientIconOrigin,
  createSiteIconCache,
  fetchSiteIcon,
  iconLinks,
  sniffIconType,
  toSiteIcon,
  type IconFetch,
} from "./oauth-client-icon";

// The deadlines unref their timers, so a hung lookup never keeps a server
// alive. A test that waits on one needs something else to hold the event loop
// open: Node 22's runner otherwise cancels it.
const keepAlive = setInterval(() => {}, 1_000);
after(() => clearInterval(keepAlive));

// The icon of a CIMD client, with a fake transport: nothing leaves the process.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

type Route = {
  status?: number;
  body?: Uint8Array<ArrayBuffer> | string;
  headers?: Record<string, string>;
};

/** A transport answering from a table of URLs, and recording what was asked. */
const fakeTransport = (routes: Record<string, Route>) => {
  const asked: string[] = [];
  const fetchResource: IconFetch = async (input) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url];
    if (!route) return new Response(null, { status: 404 });
    return new Response(route.body ?? null, {
      status: route.status ?? 200,
      headers: route.headers,
    });
  };
  return { asked, fetchResource };
};

describe("clientIconOrigin", () => {
  test("is the origin of an HTTPS client id", () => {
    assert.equal(
      clientIconOrigin("https://claude.ai/oauth/mcp-oauth-client-metadata"),
      "https://claude.ai",
    );
    assert.equal(
      clientIconOrigin("https://agent.example.org:8443/c.json"),
      "https://agent.example.org:8443",
    );
  });

  test("is null for anything that is not a plain HTTPS URL", () => {
    assert.equal(clientIconOrigin("dcr-registered-client"), null);
    assert.equal(clientIconOrigin("http://agent.example.org/c.json"), null);
    assert.equal(clientIconOrigin("https://user:pass@agent.example.org/c.json"), null);
    assert.equal(clientIconOrigin("javascript:alert(1)"), null);
  });
});

describe("sniffIconType", () => {
  test("reads the raster types from their bytes", () => {
    assert.equal(sniffIconType(PNG), "png");
    assert.equal(sniffIconType(ICO), "ico");
    assert.equal(sniffIconType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
    assert.equal(sniffIconType(new TextEncoder().encode("GIF89a....")), "gif");
    assert.equal(sniffIconType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  });

  test("refuses SVG, HTML and anything else", () => {
    assert.equal(sniffIconType(SVG), null);
    assert.equal(sniffIconType(new TextEncoder().encode("<!doctype html><html>")), null);
    assert.equal(sniffIconType(new Uint8Array([0, 0, 1, 0, 0, 0])), null, "an ICO with no image");
    assert.equal(sniffIconType(new Uint8Array()), null);
  });
});

describe("toSiteIcon", () => {
  test("serves a raster icon with the type of its bytes", () => {
    assert.deepEqual(toSiteIcon(ICO), { contentType: "image/x-icon", body: ICO });
  });

  test("refuses an icon over the size cap", () => {
    const big = new Uint8Array(MAX_ICON_BYTES + 1);
    big.set(PNG);
    assert.equal(toSiteIcon(big), null);
    assert.notEqual(toSiteIcon(big.subarray(0, MAX_ICON_BYTES)), null);
  });
});

describe("iconLinks", () => {
  test("lists icon links, then touch icons, without SVG or plain HTTP", () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/app.css">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link href='https://cdn.example.org/icon-32.png' rel='shortcut icon' sizes=32x32>
      <link rel="icon" href="http://example.org/plain.png">
      <link rel=icon href=/icon.ico>
    </head><body><link rel="icon" href="/body.png"></body></html>`;
    assert.deepEqual(iconLinks(html, "https://example.org/"), [
      "https://cdn.example.org/icon-32.png",
      "https://example.org/icon.ico",
      "https://example.org/touch.png",
    ]);
  });
});

describe("fetchSiteIcon", () => {
  test("takes /favicon.ico first", async () => {
    const { asked, fetchResource } = fakeTransport({
      "https://claude.ai/favicon.ico": {
        body: ICO,
        headers: { "content-type": "image/vnd.microsoft.icon" },
      },
    });
    const icon = await fetchSiteIcon("https://claude.ai", fetchResource);
    assert.equal(icon?.contentType, "image/x-icon");
    assert.deepEqual(asked, ["https://claude.ai/favicon.ico"]);
  });

  test("falls back to the icon links of the home page", async () => {
    const { asked, fetchResource } = fakeTransport({
      "https://agent.example.org/": {
        body: '<head><link rel="icon" href="/missing.png"><link rel="icon" href="/i.png"></head>',
      },
      "https://agent.example.org/i.png": { body: PNG },
    });
    const icon = await fetchSiteIcon("https://agent.example.org", fetchResource);
    assert.equal(icon?.contentType, "image/png");
    assert.deepEqual(asked, [
      "https://agent.example.org/favicon.ico",
      "https://agent.example.org/",
      "https://agent.example.org/missing.png",
      "https://agent.example.org/i.png",
    ]);
  });

  test("never keeps an SVG, even served as an icon", async () => {
    const { fetchResource } = fakeTransport({
      "https://agent.example.org/favicon.ico": {
        body: SVG,
        headers: { "content-type": "image/x-icon" },
      },
    });
    assert.equal(await fetchSiteIcon("https://agent.example.org", fetchResource), null);
  });

  test("stops reading past the size cap", async () => {
    // An endless body in 1 KiB chunks, with no Content-Length: the reader
    // must give up while streaming, not after buffering it all.
    let pulled = 0;
    let cancelled = false;
    const fetchResource: IconFetch = async (input) => {
      if (!String(input).endsWith("/favicon.ico")) return new Response(null, { status: 404 });
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          const chunk = new Uint8Array(1024);
          if (pulled === 1) chunk.set(PNG);
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    };
    assert.equal(await fetchSiteIcon("https://agent.example.org", fetchResource), null);
    assert.ok(cancelled, "the body is cancelled");
    assert.ok(pulled <= MAX_ICON_BYTES / 1024 + 3, `stopped after ${pulled} chunks`);
  });

  test("follows HTTPS redirects only", async () => {
    const { asked, fetchResource } = fakeTransport({
      "https://example.org/favicon.ico": {
        status: 301,
        headers: { location: "https://www.example.org/favicon.ico" },
      },
      "https://www.example.org/favicon.ico": { body: ICO },
      "https://plain.example.org/favicon.ico": {
        status: 302,
        headers: { location: "http://plain.example.org/favicon.ico" },
      },
    });
    assert.notEqual(await fetchSiteIcon("https://example.org", fetchResource), null);
    assert.equal(await fetchSiteIcon("https://plain.example.org", fetchResource), null);
    assert.ok(!asked.some((url) => url.startsWith("http:")), "never asks for a plain HTTP URL");
  });

  test("a transport failure is a missing icon", async () => {
    const failing: IconFetch = async () => {
      throw new TypeError("metadata hostname must resolve only to public-routable addresses");
    };
    assert.equal(await fetchSiteIcon("https://internal.example.org", failing), null);
  });
});

describe("createSiteIconCache", () => {
  test("keeps found and missing icons, and fetches again once they expire", async () => {
    let clock = 0;
    const { asked, fetchResource } = fakeTransport({
      "https://claude.ai/favicon.ico": { body: ICO },
    });
    const siteIcon = createSiteIconCache({ fetchResource, now: () => clock });

    const [first, second] = await Promise.all([
      siteIcon("https://claude.ai"),
      siteIcon("https://claude.ai"),
    ]);
    assert.equal(first?.contentType, "image/x-icon");
    assert.equal(second, first);
    assert.equal(asked.length, 1, "concurrent asks share one fetch");

    assert.equal(await siteIcon("https://none.example.org"), null);
    const afterMissing = asked.length;
    clock += 30 * 60 * 1000;
    assert.equal(await siteIcon("https://none.example.org"), null);
    assert.equal(asked.length, afterMissing, "a missing icon is kept for a while");
    await siteIcon("https://claude.ai");
    assert.equal(asked.filter((url) => url.startsWith("https://claude.ai")).length, 1);

    clock += 60 * 60 * 1000;
    await siteIcon("https://none.example.org");
    assert.ok(asked.length > afterMissing, "a missing icon is asked again after an hour");

    clock += 24 * 60 * 60 * 1000;
    await siteIcon("https://claude.ai");
    assert.equal(asked.filter((url) => url.startsWith("https://claude.ai")).length, 2);
  });

  test("gives up at its budget, even when the transport never answers", async () => {
    // A transport that ignores its abort signal must not hold the asker.
    const hung: IconFetch = () => new Promise<Response>(() => {});
    const siteIcon = createSiteIconCache({ fetchResource: hung, resolveBudgetMs: 20 });
    assert.equal(await siteIcon("https://slow.example.org"), null);
  });

  test("runs at most 8 lookups at once, and caches nothing it refused", async () => {
    let calls = 0;
    const hung: IconFetch = () => {
      calls++;
      return new Promise<Response>(() => {});
    };
    const siteIcon = createSiteIconCache({ fetchResource: hung, resolveBudgetMs: 20 });
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => siteIcon(`https://slow${index}.example.org`)),
    );
    assert.equal(calls, 8);

    // The 8 hung lookups still hold their places after their budget.
    assert.equal(await siteIcon("https://other.example.org"), null);
    assert.equal(calls, 8, "a ninth lookup does not start");
  });

  test("a lookup keeps its place while a request it started runs past its deadline", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const hung: Array<() => void> = [];
    let calls = 0;
    const fetchResource: IconFetch = (input) => {
      calls++;
      if (String(input).startsWith("https://later.example.org")) {
        return Promise.resolve(new Response(ICO));
      }
      return new Promise<Response>((_, reject) => {
        hung.push(() => reject(new TypeError("getaddrinfo ETIMEDOUT")));
      });
    };
    const siteIcon = createSiteIconCache({ fetchResource });
    const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

    const asks = Array.from({ length: 8 }, (_, index) =>
      siteIcon(`https://slow${index}.example.org`),
    );
    // Each request's 4-second deadline, then the 10-second budget: every
    // asker gets no icon while the lookups' DNS answers never come.
    for (let second = 0; second < 12; second++) {
      t.mock.timers.tick(1000);
      await nextTurn();
    }
    assert.deepEqual(await Promise.all(asks), Array(8).fill(null));
    const started = calls;

    assert.equal(await siteIcon("https://later.example.org"), null);
    assert.equal(calls, started, "a ninth lookup does not start");

    for (const settle of hung) settle();
    await nextTurn();
    await nextTurn();
    assert.equal((await siteIcon("https://later.example.org"))?.contentType, "image/x-icon");
  });
});
