import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mock, test } from "node:test";

// The same-origin image route of a private bucket. An API upload waits in
// staging until Louez has checked it: the route never serves it, and never
// even asks the bucket for it.

const read: string[] = [];
mock.module("@/lib/storage/files", {
  namedExports: {
    isProxiedStorage: () => true,
    getStorageClient: () => ({
      send: async (command: { input: { Key: string } }) => {
        read.push(command.input.Key);
        return {
          Body: Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47])]),
          ContentType: "image/png",
        };
      },
    }),
  },
});

const get = async (key: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`https://app.louez.test/files/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  });
};

test("an upload still in staging is never served", async () => {
  const staged = await get("uploads-staging/store_a/categories/aaaaaaaaaaaaaaaaaaaaa.png");
  assert.equal(staged.status, 404);
  assert.deepEqual(read, [], "the bucket is not asked");
});

test("a published image is served", async () => {
  const served = await get("store_a/categories/aaaaaaaaaaaaaaaaaaaaa.png");
  assert.equal(served.status, 200);
  assert.deepEqual(read, ["store_a/categories/aaaaaaaaaaaaaaaaaaaaa.png"]);
});
