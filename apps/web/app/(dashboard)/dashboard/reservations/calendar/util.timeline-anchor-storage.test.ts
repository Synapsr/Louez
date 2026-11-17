import assert from "node:assert/strict";
import test, { beforeEach, describe } from "node:test";

import {
  clearTimelineAnchor,
  getTimelineAnchor,
  saveTimelineAnchor,
} from "./util.timeline-anchor-storage";

describe("util.timeline-anchor-storage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const mockStorage: Partial<Storage> = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };

    globalThis.window = {
      sessionStorage: mockStorage as Storage,
    } as unknown as Window & typeof globalThis;
  });

  test("saves and gets timeline anchor date and scroll", () => {
    const testDate = new Date("2026-11-25T00:00:00Z");
    saveTimelineAnchor("store_1", testDate, 450);

    const anchor = getTimelineAnchor("store_1");
    assert.ok(anchor);
    assert.equal(anchor.date.getFullYear(), 2026);
    assert.equal(anchor.date.getMonth(), 10); // November
    assert.equal(anchor.date.getDate(), 25);
    assert.equal(anchor.scrollLeft, 450);
  });

  test("clears timeline anchor for specific store and all stores", () => {
    saveTimelineAnchor("store_1", new Date("2026-11-25T00:00:00Z"), 100);
    saveTimelineAnchor("store_2", new Date("2026-11-26T00:00:00Z"), 200);

    clearTimelineAnchor("store_1");
    assert.equal(getTimelineAnchor("store_1"), null);
    assert.ok(getTimelineAnchor("store_2"));

    clearTimelineAnchor();
    assert.equal(getTimelineAnchor("store_2"), null);
  });
});
