import assert from "node:assert/strict";
import { test } from "node:test";

import { readAtMost } from "./read-at-most";

// How the API's storage reads an object's body: at most the bytes asked, the
// body always cancelled, a cut body refused.

/** A body of these chunks, then `end`: closed, or errored. */
const body = (chunks: Uint8Array[], end: "close" | Error = "close") => {
  const cancelled = { count: 0 };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (end === "close") controller.close();
      else controller.error(end);
    },
    cancel() {
      cancelled.count++;
    },
  });
  return { stream, cancelled };
};
const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);

test("a body larger than asked, as from a store that ignores the range, is read up to the limit and cancelled", async () => {
  const chunk = bytes(1000, 7);
  const { stream, cancelled } = body([chunk, bytes(1000, 8), bytes(1000, 9)]);
  const read = await readAtMost(stream, 13, 3000);
  assert.deepEqual(read, bytes(13, 7));
  assert.equal(cancelled.count, 1);
  assert.notEqual(read.buffer, chunk.buffer, "copied: the larger chunk is not kept");
  assert.equal(read.buffer.byteLength, 13);
});

test("a body within the limit is read whole", async () => {
  const { stream } = body([bytes(12, 1), bytes(8, 2)]);
  assert.deepEqual(
    await readAtMost(stream, 100, 20),
    new Uint8Array([...bytes(12, 1), ...bytes(8, 2)]),
  );
});

test("a body that ends before what it announced is refused", async () => {
  const { stream, cancelled } = body([bytes(30, 1)]);
  await assert.rejects(readAtMost(stream, 100, 64), /ended after 30 of 64 bytes/);
  assert.equal(cancelled.count, 0, "already closed: nothing left to cancel");
});

test("a read error is raised as it is", async () => {
  const failure = new Error("connection reset");
  const { stream } = body([bytes(10, 1)], failure);
  await assert.rejects(readAtMost(stream, 100, 64), failure);
});

test("a cancel that fails does not lose the bytes read", async () => {
  // Still open after the bytes asked: the reader cancels it, and the cancel fails.
  const open = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(bytes(50, 1));
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
  assert.deepEqual(await readAtMost(open, 13, 1000), bytes(13, 1));
});
