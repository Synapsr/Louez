import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { InboxItem } from "@louez/api/contracts/inbox";

import {
  NEEDS_A_LOOK_TYPES,
  acknowledgeNeedsALook,
  loadNeedsALook,
  loadNeedsALookWithin,
  needsALookCount,
  needsALookWaiting,
  type NeedsALookItem,
} from "./needs-a-look";

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `refund_undone:${index}` }) as NeedsALookItem);

describe("the count of what needs a look", () => {
  test("the number up to 99, then 99+, and 99+ whenever more wait past the page", () => {
    assert.deepEqual(needsALookCount({ items: items(0), more: false }), {
      count: 0,
      capped: false,
    });
    assert.deepEqual(needsALookCount({ items: items(3), more: false }), {
      count: 3,
      capped: false,
    });
    assert.deepEqual(needsALookCount({ items: items(99), more: false }), {
      count: 99,
      capped: false,
    });
    assert.deepEqual(needsALookCount({ items: items(100), more: false }), {
      count: 99,
      capped: true,
    });
    assert.deepEqual(needsALookCount({ items: items(3), more: true }), { count: 99, capped: true });
  });
});

describe("the loader and the acknowledgement", () => {
  test("the loader asks for the page's kinds only, a page at a time, and keeps no other kind", async () => {
    let asked: unknown;
    const loaded = await loadNeedsALook({
      list: async (input) => {
        asked = input;
        return {
          items: [
            { id: "refund_undone:a", type: "refund_undone" },
            { id: "booking_request:b", type: "booking_request" },
          ] as InboxItem[],
          hasMore: true,
          unavailable: ["dispute_open"],
        };
      },
    });
    assert.deepEqual(asked, { types: [...NEEDS_A_LOOK_TYPES], limit: 100 });
    assert.deepEqual(
      loaded.items.map((item) => item.id),
      ["refund_undone:a"],
    );
    assert.equal(loaded.more, true);
    assert.equal(loaded.incomplete, true);
  });

  test("handled when the API marked it, now or before; changed when it holds another occurrence", async () => {
    const answer = (acknowledged: number, alreadyAcknowledged: number) => ({
      acknowledge: async () => ({ acknowledged, alreadyAcknowledged }),
    });
    const item = { id: "refund_undone:a", occurredAt: new Date() };
    assert.equal(await acknowledgeNeedsALook(answer(1, 0), item), "handled");
    assert.equal(await acknowledgeNeedsALook(answer(0, 1), item), "handled");
    assert.equal(await acknowledgeNeedsALook(answer(0, 0), item), "changed");
  });
});

describe("the sidebar's marker and the home's line never wait on the inbox", () => {
  test("a read that never answers is given up after the timeout, its request aborted", async () => {
    let signal: AbortSignal | undefined;
    const started = Date.now();
    await assert.rejects(
      loadNeedsALookWithin(
        {
          list: (_input, options) => {
            signal = options?.signal;
            return new Promise(() => {});
          },
        },
        { timeoutMs: 20 },
      ),
      /did not answer in time/,
    );
    assert.ok(Date.now() - started < 1_000);
    assert.equal(signal?.aborted, true);
  });

  test("a read that answers in time gives what needs a look", async () => {
    const loaded = await loadNeedsALookWithin(
      {
        list: async () => ({
          items: [{ id: "refund_undone:a", type: "refund_undone" }] as InboxItem[],
          hasMore: false,
        }),
      },
      { timeoutMs: 1_000 },
    );
    assert.equal(loaded.items.length, 1);
  });

  test("the marker shows only for something read and waiting: not while loading, not after a failure", () => {
    assert.equal(needsALookWaiting(undefined), false);
    assert.equal(needsALookWaiting({ items: [], more: false, incomplete: false }), false);
    assert.equal(needsALookWaiting({ items: items(1), more: false, incomplete: false }), true);
  });
});
