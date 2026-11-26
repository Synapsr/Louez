import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

closeNetworkForSuite();

// The dashboard's file route, through the real files-sdk router over an
// in-memory bucket: an upload takes the key the router mints, never one the
// caller names, such as a name only an API upload's completion writes.

const APP = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_URL = APP;
process.env.AUTH_SECRET ??= "image-files-router-test-secret";

const directory = mkdtempSync(join(tmpdir(), "louez-image-files-router-"));
const stub = (name: string, source: string) => {
  const path = join(directory, name);
  writeFileSync(path, source);
  return pathToFileURL(path).href;
};
const filesStub = stub(
  "files.mjs",
  `import { createFiles } from "files-sdk";
import { memory } from "files-sdk/memory";
export const files = createFiles({ adapter: memory() });
export const getImageFiles = () => files;`,
);
const stubs: Record<string, string> = {
  "@/lib/storage/files": filesStub,
  "@/lib/auth": stub("auth.mjs", "export const auth = async () => null;"),
  "@/lib/store-context": stub(
    "store-context.mjs",
    'export const getCurrentStore = async () => ({ id: "store_a" });',
  ),
};
// Its real path, where pnpm puts its own dependencies beside it.
const FILES_SDK = pathToFileURL(
  `${realpathSync(fileURLToPath(new URL("../../node_modules/files-sdk", import.meta.url)))}/dist/`,
);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const stubbed = stubs[specifier];
    if (stubbed) return { url: stubbed, shortCircuit: true };
    // files-sdk exports ESM only, through an "import" condition the test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { url: new URL(entry, FILES_SDK).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const png = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

test("a dashboard upload to a key it names is refused, and nothing is stored", async () => {
  const { getImageFilesRouter } = await import("./image-files-router");
  const { files } = (await import(filesStub)) as {
    files: { list: () => Promise<{ items: unknown[] }> };
  };
  // A 3 MB banner under a logo's image key, in the folder logos and banners share.
  for (const key of ["aaaaaaaaaaaaaaaaaaaaa-logo.png", "banner.png"]) {
    const response = await getImageFilesRouter("hero").handle(
      new Request(`${APP}/api/files/hero?op=upload&key=${key}`, {
        method: "PUT",
        headers: { origin: APP, "content-type": "image/png" },
        body: png(3 * 1024 * 1024),
      }),
    );
    assert.equal(response.status, 401, key);
  }
  assert.deepEqual((await files.list()).items, []);
});

test("a dashboard upload under the key the router mints is still taken", async () => {
  const { getImageFilesRouter } = await import("./image-files-router");
  const response = await getImageFilesRouter("hero").handle(
    new Request(`${APP}/api/files/hero`, {
      method: "POST",
      headers: { origin: APP, "content-type": "application/json" },
      body: JSON.stringify({
        op: "presign",
        files: [{ name: "banner.png", type: "image/png", size: 1024 }],
      }),
    }),
  );
  assert.equal(response.status, 200);
  const { uploads } = (await response.json()) as { uploads: Array<{ key: string }> };
  assert.match(uploads[0]?.key ?? "", /^[0-9a-f-]{36}\.png$/);
});
