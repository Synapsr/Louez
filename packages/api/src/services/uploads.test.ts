import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, mock, test } from "node:test";

import { createMemoryStorage, type MemoryStorage } from "../platform/memory-storage";
import { createTestImageFetch } from "../platform/test-image-fetch";

// The upload service on its own, in memory: its place limit for imports, its
// cleanup after a failure and its base64 bounds. Nothing leaves the process.

process.env.AUTH_SECRET ??= "uploads-test-secret";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const imageFetch = createTestImageFetch();
mock.module("@louez/auth/guarded-fetch", { namedExports: imageFetch.namedExports });

const STORE = "up_store_a_000000001";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MAX = 5 * 1024 * 1024;

/** A PNG of `size` bytes, base64. */
const pngBase64 = (size: number) => {
  const bytes = Buffer.alloc(size);
  bytes.set(PNG);
  return bytes.toString("base64");
};

/** The `data.code` of what `promise` rejects with. */
async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code;
  }
  return undefined;
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

describe("uploadImage", () => {
  let uploads: typeof import("./uploads");
  let storage: MemoryStorage;

  before(async () => {
    uploads = await import("./uploads");
  });

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  const upload = (source: { contentBase64?: string; imageUrl?: string }) =>
    uploads.uploadImage(storage, { storeId: STORE, kind: "category", source });

  test("an import keeps its place until its hung lookup settles, past its deadline", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const hung: Array<(reason: Error) => void> = [];
    imageFetch.serve({
      "https://slow.example.org/a.png": () =>
        new Promise<Response>((_, reject) => {
          hung.push(reject);
        }),
      "https://cdn.example.org/a.png": () => new Response(PNG),
    });

    const slow = Array.from({ length: uploads.MAX_IMPORTS_IN_FLIGHT }, () =>
      upload({ imageUrl: "https://slow.example.org/a.png" }),
    );
    assert.equal(hung.length, uploads.MAX_IMPORTS_IN_FLIGHT);
    assert.equal(
      await codeOf(upload({ imageUrl: "https://cdn.example.org/a.png" })),
      "UPLOAD_IMPORT_BUSY",
    );

    // Their deadline passes: each caller gets its answer, a retryable one.
    t.mock.timers.tick(10_000);
    for (const result of await Promise.allSettled(slow)) {
      assert.equal(result.status, "rejected");
      const data = (result as PromiseRejectedResult).reason.data;
      assert.equal(data.code, "UPLOAD_URL_UNREACHABLE");
      assert.equal(data.retryable, true);
    }

    // The lookups still run: no new import starts, so none piles up behind them.
    await nextTurn();
    assert.equal(
      await codeOf(upload({ imageUrl: "https://cdn.example.org/a.png" })),
      "UPLOAD_IMPORT_BUSY",
    );
    assert.equal(hung.length, uploads.MAX_IMPORTS_IN_FLIGHT, "no transport call started");

    for (const reject of hung) reject(new TypeError("getaddrinfo ETIMEDOUT"));
    await nextTurn();
    const imported = await upload({ imageUrl: "https://cdn.example.org/a.png" });
    assert.equal(imported.contentType, "image/png");
  });

  test("a host's transient answers are retryable; a refused address is not", async () => {
    const transient = [408, 425, 429, 500, 502, 503, 504, 522, 524, 599];
    imageFetch.serve({
      ...Object.fromEntries(
        transient.map((status) => [
          `https://cdn.example.org/${status}.png`,
          () => new Response(null, { status }),
        ]),
      ),
      "https://cdn.example.org/gone.png": () => new Response(null, { status: 404 }),
      "https://cdn.example.org/forbidden.png": () => new Response(null, { status: 403 }),
    });
    const retryable = async (imageUrl: string) => {
      try {
        await upload({ imageUrl });
      } catch (error) {
        return (error as { data: { retryable: boolean } }).data.retryable;
      }
      assert.fail("the import succeeded");
    };
    for (const status of transient) {
      assert.equal(await retryable(`https://cdn.example.org/${status}.png`), true, String(status));
    }
    assert.equal(await retryable("https://cdn.example.org/gone.png"), false);
    assert.equal(await retryable("https://cdn.example.org/forbidden.png"), false);
    assert.equal(await retryable("https://db.internal/a.png"), false);
    assert.equal(await retryable("http://cdn.example.org/a.png"), false);
  });

  test("a failure after the bytes are stored deletes them, and keeps the first error", async (t) => {
    const failure = new Error("publish failed");
    storage.publish = async () => {
      throw failure;
    };
    await assert.rejects(upload({ contentBase64: pngBase64(64) }), failure);
    assert.equal(storage.objects.size, 0, "nothing left behind");

    // A cleanup that fails too is logged as an event: an opaque reference to
    // the object and the error's name, code and status, never the key or
    // the provider's message. The caller still gets the first error.
    const logged = t.mock.method(console, "error", () => {});
    let deleted = "";
    storage.delete = async (key) => {
      deleted = key;
      throw Object.assign(new Error(`AccessDenied on ${key} for arn:aws:iam::123:user/x`), {
        name: "AccessDenied",
        Code: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });
    };
    await assert.rejects(upload({ contentBase64: pngBase64(64) }), failure);
    assert.equal(logged.mock.callCount(), 1);
    const args = logged.mock.calls[0]?.arguments ?? [];
    assert.equal(args.length, 1);
    const event = args[0] as { objectRef: string };
    assert.deepEqual(event, {
      event: "image_upload.cleanup_failed",
      objectRef: event.objectRef,
      kind: "category",
      error: { name: "AccessDenied", code: "AccessDenied", status: 403 },
    });
    assert.match(event.objectRef, /^[0-9a-f]{16}$/);
    const written = JSON.stringify(args);
    assert.ok(!written.includes(deleted), "no key");
    assert.ok(!written.includes(STORE), "no store folder");
    assert.ok(!written.includes("arn:aws"), "no provider message");
  });

  test("base64 is sized from its data, with padding only where it belongs", async () => {
    // 5,242,880 bytes: the limit, with its padding or without.
    const atLimit = pngBase64(MAX);
    assert.ok(atLimit.endsWith("="));
    assert.equal((await upload({ contentBase64: atLimit })).size, MAX);
    assert.equal((await upload({ contentBase64: atLimit.replace(/=+$/, "") })).size, MAX);

    // One byte more: a full last group, refused by its size.
    const overLimit = pngBase64(MAX + 1);
    assert.ok(!overLimit.endsWith("="));
    assert.equal(await codeOf(upload({ contentBase64: overLimit })), "UPLOAD_TOO_LARGE");
    // Padding after a full group does not make it smaller: it is no base64.
    assert.equal(
      await codeOf(upload({ contentBase64: `${overLimit}==` })),
      "UPLOAD_BASE64_INVALID",
    );
    // Two bytes over a group take `==`; a single `=` there is no base64.
    const twoOver = pngBase64(16);
    assert.ok(twoOver.endsWith("=="));
    assert.equal(
      await codeOf(upload({ contentBase64: twoOver.slice(0, -1) })),
      "UPLOAD_BASE64_INVALID",
    );
    assert.equal(await codeOf(upload({ contentBase64: `${atLimit}=` })), "UPLOAD_BASE64_INVALID");
  });
});
