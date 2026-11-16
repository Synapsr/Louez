import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { InboxItem } from "@louez/api/contracts/inbox";

import {
  NEEDS_A_LOOK_TYPES,
  acknowledgeNeedsALook,
  loadNeedsALook,
  loadNeedsALookWithin,
} from "./needs-a-look";

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

describe("the bell never waits on the inbox", () => {
  test("a read that never answers is given up after the timeout, its request aborted", async () => {
    let signal: AbortSignal | undefined;
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
});
