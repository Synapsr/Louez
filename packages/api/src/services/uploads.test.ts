import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, mock, test } from "node:test";

import { createMemoryStorage, type MemoryStorage } from "../platform/memory-storage";
import type { LogPort } from "../platform/ports";
import { createTestImageFetch } from "../platform/test-image-fetch";

// The upload service on its own, in memory: staging, the check and the
// publication of an upload through its URL, the cron's purge, the single-call
// upload's place limit for imports, its cleanup after a failure and its
// base64 bounds. Nothing leaves the process.

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

/** A PNG of `size` bytes, the bytes after its signature set to `fill`. */
const png = (size: number, fill = 0) => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(PNG);
  return bytes;
};

const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

/** A log port that keeps the events it is given (the app's is evlog). */
const recordingLog = () => {
  const events: Array<Record<string, unknown>> = [];
  const log: LogPort = { error: (event) => events.push(event) };
  return { log, events };
};

describe("createImageUpload", () => {
  let uploads: typeof import("./uploads");

  before(async () => {
    uploads = await import("./uploads");
  });

  const start = (storage: MemoryStorage) =>
    uploads.createImageUpload(storage, {
      storeId: STORE,
      kind: "category",
      contentType: "image/png",
      size: 64,
    });

  test("a presigned upload targets a staging key, never an image's key", async () => {
    const storage = createMemoryStorage({ direct: true });
    const signed: string[] = [];
    const sign = storage.signUpload;
    storage.signUpload = async (key, options) => {
      signed.push(key);
      return sign(key, options);
    };
    const started = await start(storage);
    assert.match(started.key, new RegExp(`^uploads-staging/${STORE}/categories/[\\w-]{21}\\.png$`));
    assert.deepEqual(signed, [started.key]);
  });

  test("so does the app's upload endpoint, for a bucket served through the app", async () => {
    const started = await start(createMemoryStorage());
    const token = new URL(started.upload.url).pathname.split("/").at(-1) ?? "";
    assert.equal(uploads.verifyUploadGrant(token)?.key, started.key);
    assert.ok(started.key.startsWith(`uploads-staging/${STORE}/categories/`));
  });
});

describe("completeImageUpload", () => {
  let uploads: typeof import("./uploads");
  let storage: MemoryStorage;

  const ID = "aaaaaaaaaaaaaaaaaaaaa";
  const STAGED = `uploads-staging/${STORE}/categories/${ID}.png`;
  const IMAGE = `${STORE}/categories/${ID}-category.png`;

  before(async () => {
    uploads = await import("./uploads");
  });

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  /** What the caller sent through the upload URL, as often as it likes until it expires. */
  const send = (bytes: Uint8Array, contentType = "image/png") => {
    storage.objects.set(STAGED, { bytes, contentType, public: false });
  };
  const complete = (key = STAGED, log?: LogPort) =>
    uploads.completeImageUpload(storage, { storeId: STORE, kind: "category", key }, log);
  /** Records the storage's reads: each key, with the bytes asked at most. */
  const recordReads = () => {
    const read = storage.read;
    const asked: Array<[string, number]> = [];
    storage.read = async (key, maxBytes) => {
      asked.push([key, maxBytes]);
      return read(key, maxBytes);
    };
    return asked;
  };

  test("a valid upload publishes exactly the bytes checked, under the image's key", async () => {
    const sent = png(64, 1);
    send(sent);
    assert.deepEqual(await complete(), {
      key: IMAGE,
      url: `https://files.louez.test/${IMAGE}`,
      contentType: "image/png",
      size: 64,
    });
    assert.deepEqual(storage.content(IMAGE), {
      bytes: sent,
      contentType: "image/png",
      public: true,
    });
    assert.equal(storage.objects.has(STAGED), false, "the staging file went");
  });

  test("a file sent again while the upload is checked is never published: the bytes checked are", async () => {
    const checked = png(64, 1);
    send(checked);
    const read = storage.read;
    storage.read = async (key, maxBytes) => {
      const bytes = await read(key, maxBytes);
      // Sent again through the upload URL, still valid, once Louez has read the first file.
      send(HTML);
      return bytes;
    };
    const completed = await complete();
    assert.equal(completed.size, 64);
    assert.deepEqual(storage.content(IMAGE), {
      bytes: checked,
      contentType: "image/png",
      public: true,
    });
  });

  test("a refused upload is never published and stays private in staging", async () => {
    for (const [bytes, contentType, code] of [
      [HTML, "image/png", "UPLOAD_CONTENT_INVALID"],
      [
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0]),
        "image/png",
        "UPLOAD_CONTENT_INVALID",
      ],
      [png(64), "text/html", "UPLOAD_TYPE_NOT_ALLOWED"],
    ] as const) {
      send(bytes, contentType);
      assert.equal(await codeOf(complete()), code);
      assert.equal(storage.objects.get(STAGED)?.public, false, "private");
      assert.equal(storage.objects.has(IMAGE), false, "nothing published");
    }
    assert.equal(
      await codeOf(complete(`uploads-staging/${STORE}/categories/bbbbbbbbbbbbbbbbbbbbb.png`)),
      "UPLOAD_NOT_FOUND",
    );
  });

  test("a file over the limit is refused before it is read, and the read stops past the limit", async () => {
    const asked = recordReads();
    send(png(MAX + 1));
    assert.equal(await codeOf(complete()), "UPLOAD_TOO_LARGE");
    assert.deepEqual(asked, [], "refused before reading");

    // The file grows between its size and its read: only the limit and a byte are read.
    send(png(64));
    const read = storage.read;
    storage.read = async (key, maxBytes) => {
      send(png(MAX + 1024));
      return read(key, maxBytes);
    };
    assert.equal(await codeOf(complete()), "UPLOAD_TOO_LARGE");
    assert.deepEqual(asked, [[STAGED, MAX + 1]]);
    assert.equal(storage.objects.has(IMAGE), false, "nothing published");
  });

  test("completing again answers the same and never publishes a second version", async () => {
    const first = png(64, 1);
    send(first);
    const completed = await complete();
    const asked = recordReads();
    for (const again of [png(80, 2), HTML]) {
      send(again);
      assert.deepEqual(await complete(), completed);
      assert.deepEqual(storage.objects.get(IMAGE)?.bytes, first);
    }
    assert.ok(
      asked.every(([key]) => key === IMAGE),
      "the image in place is checked again; staging is never read again",
    );
  });

  test("an object under the upload's own name, as an upload URL could write it, is never published", async () => {
    // Before staging, presigned uploads went to `<id>.<ext>` in the store's folder.
    const old = `${STORE}/categories/${ID}.png`;
    storage.objects.set(old, { bytes: png(64, 9), contentType: "image/png", public: false });
    assert.equal(await codeOf(complete()), "UPLOAD_NOT_FOUND");
    send(png(64, 1));
    assert.equal((await complete()).key, IMAGE);
    assert.deepEqual(storage.objects.get(IMAGE)?.bytes, png(64, 1), "the staging file's bytes");
    assert.deepEqual(storage.content(old), {
      bytes: png(64, 9),
      contentType: "image/png",
      public: false,
    });
  });

  test("the image in place is checked again before it is published", async () => {
    storage.objects.set(IMAGE, { bytes: HTML, contentType: "image/png", public: false });
    send(png(64));
    assert.equal(await codeOf(complete()), "UPLOAD_CONTENT_INVALID");
    assert.equal(storage.objects.get(IMAGE)?.public, false, "left private");
  });

  test("a banner then a logo completed from one upload write two keys, each held to its limit", async () => {
    // Logos and banners share the store's logo folder; a logo is 2 MB at most, a banner 5 MB.
    const staged = `uploads-staging/${STORE}/logo/${ID}.png`;
    const sendLogoFolder = (bytes: Uint8Array) =>
      storage.objects.set(staged, { bytes, contentType: "image/png", public: false });
    const asKind = (kind: "logo" | "hero") =>
      uploads.completeImageUpload(storage, { storeId: STORE, kind, key: staged });
    const banner = png(3 * 1024 * 1024, 1);

    sendLogoFolder(banner);
    assert.equal((await asKind("hero")).key, `${STORE}/logo/${ID}-hero.png`);
    sendLogoFolder(banner);
    assert.equal(await codeOf(asKind("logo")), "UPLOAD_TOO_LARGE");
    assert.equal(storage.objects.has(`${STORE}/logo/${ID}-logo.png`), false, "no logo past 2 MB");

    sendLogoFolder(png(1024, 2));
    assert.equal((await asKind("logo")).size, 1024);
    assert.deepEqual(storage.objects.get(`${STORE}/logo/${ID}-logo.png`)?.bytes, png(1024, 2));
    assert.deepEqual(storage.objects.get(`${STORE}/logo/${ID}-hero.png`)?.bytes, banner);
  });

  test("simultaneous completions each write bytes they checked, and both answers describe what stays", async () => {
    const first = png(64, 1);
    const second = png(80, 2);
    send(first);
    // The first completion reads the first file; the caller then sends the second,
    // which another completion, started then, reads before either writes.
    const read = storage.read;
    let reads = 0;
    let firstRead = () => {};
    const firstReadDone = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    let secondRead = () => {};
    const bothRead = new Promise<void>((resolve) => {
      secondRead = resolve;
    });
    storage.read = async (key, maxBytes) => {
      const bytes = await read(key, maxBytes);
      if (++reads === 1) {
        send(second);
        firstRead();
        await bothRead;
      } else {
        secondRead();
      }
      return bytes;
    };
    // Neither publishes before both have written.
    const put = storage.put;
    const written: Uint8Array[] = [];
    let secondPut = () => {};
    const bothPut = new Promise<void>((resolve) => {
      secondPut = resolve;
    });
    storage.put = async (key, body, contentType) => {
      await put(key, body, contentType);
      written.push(body);
      if (written.length === 2) secondPut();
      await bothPut;
    };

    const one = complete();
    await firstReadDone;
    const answers = await Promise.all([one, complete()]);
    assert.deepEqual(
      written.map((bytes) => bytes.byteLength).sort(),
      [64, 80],
      "each wrote what it checked",
    );
    const kept = storage.objects.get(IMAGE)?.bytes;
    assert.ok(kept && [first, second].some((bytes) => Buffer.from(bytes).equals(kept)));
    for (const answer of answers) {
      assert.deepEqual(answer, {
        key: IMAGE,
        url: `https://files.louez.test/${IMAGE}`,
        contentType: "image/png",
        size: kept.byteLength,
      });
    }
  });

  test("a staging file whose delete fails is logged and left to the cron; the image is in place", async (t) => {
    const stderr = t.mock.method(console, "error", () => {});
    storage.delete = async () => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied" });
    };
    const { log, events } = recordingLog();
    send(png(64));
    await complete(STAGED, log);
    assert.equal(storage.objects.get(IMAGE)?.public, true);
    assert.equal(storage.objects.has(STAGED), true);
    assert.deepEqual(
      events.map(({ event, kind }) => ({ event, kind })),
      [{ event: "image_upload.cleanup_failed", kind: "category" }],
    );
    assert.equal(stderr.mock.callCount(), 0, "through the log port");

    // Without a log port: the same event, as one JSON line on stderr.
    storage.objects.delete(IMAGE);
    await complete();
    assert.equal(stderr.mock.callCount(), 1);
    const [line] = stderr.mock.calls[0]?.arguments ?? [];
    assert.deepEqual(JSON.parse(String(line)), events[0]);
  });
});

describe("purgeStagedUploads", () => {
  let uploads: typeof import("./uploads");
  let storage: MemoryStorage;
  const now = new Date("2027-01-10T12:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const aged = (age: number, publicly = false) => ({
    bytes: PNG,
    contentType: "image/png",
    public: publicly,
    lastModified: new Date(now.getTime() - age),
  });

  before(async () => {
    uploads = await import("./uploads");
  });

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  test("deletes what waited in staging over a day, and nothing else", async () => {
    const old = `uploads-staging/${STORE}/categories/aaaaaaaaaaaaaaaaaaaaa.png`;
    const fresh = `uploads-staging/${STORE}/categories/bbbbbbbbbbbbbbbbbbbbb.png`;
    const image = `${STORE}/categories/aaaaaaaaaaaaaaaaaaaaa.png`;
    storage.objects.set(old, aged(DAY + 1000));
    storage.objects.set(fresh, aged(DAY - 1000));
    storage.objects.set(image, aged(30 * DAY, true));

    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now }), {
      deleted: 1,
      failed: 0,
    });
    assert.deepEqual([...storage.objects.keys()].sort(), [fresh, image].sort());
  });

  test("a run is bounded by its deletes: a backlog spreads over several runs", async () => {
    for (let index = 0; index <= uploads.PURGE_MAX_DELETES; index++) {
      storage.objects.set(`uploads-staging/${STORE}/categories/${index}.png`, aged(2 * DAY));
    }
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now }), {
      deleted: uploads.PURGE_MAX_DELETES,
      failed: 0,
    });
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now }), {
      deleted: 1,
      failed: 0,
    });
  });

  test("objects age from when they were written", async () => {
    const staged = `uploads-staging/${STORE}/categories/aaaaaaaaaaaaaaaaaaaaa.png`;
    await storage.put(staged, PNG, "image/png");
    const after = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now: after(23) }), {
      deleted: 0,
      failed: 0,
    });
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now: after(25) }), {
      deleted: 1,
      failed: 0,
    });
  });

  test("deletes that keep failing never use the run's budget, and a run stops after too many", async () => {
    const { log } = recordingLog();
    const failing = new Set<string>();
    const remove = storage.delete;
    storage.delete = async (key) => {
      if (failing.has(key)) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
      return remove(key);
    };
    const old = (name: string) => {
      const key = `uploads-staging/${STORE}/categories/${name}.png`;
      storage.objects.set(key, aged(2 * DAY));
      return key;
    };

    // A few that will not go, listed first: the run skips them and deletes its budget.
    for (let index = 0; index < 3; index++) failing.add(old(`stuck-${index}`));
    for (let index = 0; index < uploads.PURGE_MAX_DELETES + 10; index++) old(`old-${index}`);
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now, log }), {
      deleted: uploads.PURGE_MAX_DELETES,
      failed: 3,
    });

    // Every delete refused: the run stops after its failures.
    storage.objects.clear();
    failing.clear();
    for (let index = 0; index < uploads.PURGE_MAX_FAILURES + 10; index++) {
      failing.add(old(`refused-${index}`));
    }
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now, log }), {
      deleted: 0,
      failed: uploads.PURGE_MAX_FAILURES,
    });
  });

  test("a delete that fails is logged and skipped: the run goes on", async () => {
    const { log, events } = recordingLog();
    const keys = ["a", "b", "c"].map((name) => `uploads-staging/${STORE}/categories/${name}.png`);
    for (const key of keys) storage.objects.set(key, aged(2 * DAY));
    const remove = storage.delete;
    storage.delete = async (key) => {
      if (key === keys[0]) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
      return remove(key);
    };
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now, log }), {
      deleted: 2,
      failed: 1,
    });
    assert.deepEqual([...storage.objects.keys()], [keys[0]], "left for a later run");
    assert.equal(events.length, 1);
    const [event] = events;
    assert.deepEqual(event, {
      event: "image_upload.cleanup_failed",
      objectRef: (event as { objectRef: string }).objectRef,
      kind: null,
      error: { name: "AccessDenied", code: null, status: null },
    });
  });

  test("old objects past many pages of recent ones are reached; the listing has a safety cap", async () => {
    /** Pages of recent uploads, then one old upload on page `oldPage`, if any. */
    const pages = (oldPage: number | null) => {
      const listed: Array<string | undefined> = [];
      storage.list = async (_prefix, cursor) => {
        listed.push(cursor);
        const page = listed.length;
        const old = page === oldPage;
        return {
          items: [
            {
              key: `uploads-staging/${old ? "old" : "recent"}-${page}.png`,
              lastModified: old ? new Date(now.getTime() - 2 * DAY) : now,
            },
          ],
          cursor: page === oldPage ? null : `after-${page}`,
        };
      };
      return listed;
    };
    const deletedKeys: string[] = [];
    storage.delete = async (key) => {
      deletedKeys.push(key);
    };

    const listed = pages(30);
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now }), {
      deleted: 1,
      failed: 0,
    });
    assert.deepEqual(deletedKeys, ["uploads-staging/old-30.png"]);
    assert.equal(listed.length, 30);
    assert.deepEqual(listed.slice(0, 2), [undefined, "after-1"], "each page follows the last");

    const endless = pages(null);
    assert.deepEqual(await uploads.purgeStagedUploads(storage, { now }), {
      deleted: 0,
      failed: 0,
    });
    assert.equal(endless.length, uploads.PURGE_MAX_PAGES);
  });
});

describe("uploadImage", () => {
  let uploads: typeof import("./uploads");
  let storage: MemoryStorage;

  before(async () => {
    uploads = await import("./uploads");
  });

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  const upload = (source: { contentBase64?: string; imageUrl?: string }, log?: LogPort) =>
    uploads.uploadImage(storage, { storeId: STORE, kind: "category", source }, log);

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

  test("a failure after the bytes are stored deletes them, and keeps the first error", async () => {
    const failure = new Error("publish failed");
    storage.publish = async () => {
      throw failure;
    };
    await assert.rejects(upload({ contentBase64: pngBase64(64) }), failure);
    assert.equal(storage.objects.size, 0, "nothing left behind");

    // A cleanup that fails too is logged as an event: an opaque reference to
    // the object and the error's name, code and status, never the key or
    // the provider's message. The caller still gets the first error.
    const { log, events } = recordingLog();
    let deleted = "";
    storage.delete = async (key) => {
      deleted = key;
      throw Object.assign(new Error(`AccessDenied on ${key} for arn:aws:iam::123:user/x`), {
        name: "AccessDenied",
        Code: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });
    };
    await assert.rejects(upload({ contentBase64: pngBase64(64) }, log), failure);
    assert.equal(events.length, 1);
    const event = events[0] as { objectRef: string };
    assert.deepEqual(event, {
      event: "image_upload.cleanup_failed",
      objectRef: event.objectRef,
      kind: "category",
      error: { name: "AccessDenied", code: "AccessDenied", status: 403 },
    });
    assert.match(event.objectRef, /^[0-9a-f]{16}$/);
    const written = JSON.stringify(events);
    assert.ok(!written.includes(deleted), "no key");
    assert.ok(!written.includes(STORE), "no store folder");
    assert.ok(!written.includes("arn:aws"), "no provider message");
  });

  test("the bytes are checked before anything is stored, then go straight to the image's key", async () => {
    const stored: string[] = [];
    const put = storage.put;
    storage.put = async (key, body, contentType) => {
      stored.push(key);
      return put(key, body, contentType);
    };
    imageFetch.serve({ "https://cdn.example.org/page.png": () => new Response(HTML) });
    for (const source of [
      { contentBase64: Buffer.from(HTML).toString("base64") },
      { contentBase64: `data:image/jpeg;base64,${pngBase64(64)}` },
      { contentBase64: pngBase64(MAX + 1) },
      { imageUrl: "https://cdn.example.org/page.png" },
    ]) {
      assert.ok(await codeOf(upload(source)), "refused");
    }
    assert.deepEqual(stored, [], "nothing stored");

    const sent = await upload({ contentBase64: pngBase64(64) });
    assert.match(sent.key, new RegExp(`^${STORE}/categories/[\\w-]{21}\\.png$`));
    assert.deepEqual(stored, [sent.key]);
    assert.equal(storage.objects.get(sent.key)?.public, true);
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
