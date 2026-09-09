import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CartStorageLike,
  LEGACY_CART_STORAGE_KEY,
  getCartStorageKey,
  parseStoredCart,
  readCartFromStorage,
  writeCartToStorage,
} from "./util.cart-storage";

const createStorage = (
  entries: Record<string, string> = {},
): CartStorageLike & {
  entries: Map<string, string>;
} => {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

const legacyCart = {
  storeSlug: "ar-mor",
  items: [
    {
      lineId: "l1",
      selectionSignature: "__default",
      productId: "p1",
      productName: "Kayak",
      productImage: null,
      quantity: 2,
      maxQuantity: 4,
      pricingKind: "duration",
      stockKind: "returnable",
      startDate: "2026-09-10T08:00:00.000Z",
      endDate: "2026-09-12T16:00:00.000Z",
    },
    {
      lineId: "l2",
      selectionSignature: "__default",
      productId: "p2",
      quantity: 2,
      parentLineId: "l1",
      requiredQuantity: 1,
      startDate: "2026-09-10T08:00:00.000Z",
      endDate: "2026-09-12T16:00:00.000Z",
    },
  ],
  globalStartDate: "2026-09-10T08:00:00.000Z",
  globalEndDate: "2026-09-12T16:00:00.000Z",
  pricingMode: "day",
};

test("getCartStorageKey scopes the key per store", () => {
  assert.equal(getCartStorageKey("ar-mor"), "louez_cart:ar-mor");
});

test("parseStoredCart reads the legacy shape and its global period", () => {
  const parsed = parseStoredCart(JSON.stringify(legacyCart));
  assert.ok(parsed);
  assert.equal(parsed.storeSlug, "ar-mor");
  assert.equal(parsed.lines.length, 2);
  assert.deepEqual(parsed.period, {
    startDate: "2026-09-10T08:00:00.000Z",
    endDate: "2026-09-12T16:00:00.000Z",
  });
  assert.equal(parsed.pricingMode, "day");
});

test("parseStoredCart rejects malformed values", () => {
  assert.equal(parseStoredCart(null), null);
  assert.equal(parseStoredCart("not json"), null);
  assert.equal(parseStoredCart(JSON.stringify({ lines: [{ quantity: 1 }] })), null);
});

test("readCartFromStorage migrates the legacy key when it belongs to the store", () => {
  const storage = createStorage({
    [LEGACY_CART_STORAGE_KEY]: JSON.stringify(legacyCart),
  });

  const restored = readCartFromStorage(storage, "ar-mor");

  assert.equal(restored.lines.length, 2);
  assert.equal(restored.lines[0].productName, "Kayak");
  assert.equal(restored.lines[0].maxQuantity, 4);
  assert.equal(restored.lines[1].parentLineId, "l1");
  assert.equal(restored.period?.startDate, "2026-09-10T08:00:00.000Z");
  assert.equal(storage.getItem(LEGACY_CART_STORAGE_KEY), null);
});

test("readCartFromStorage drops a legacy cart of another store", () => {
  const storage = createStorage({
    [LEGACY_CART_STORAGE_KEY]: JSON.stringify({ ...legacyCart, storeSlug: "other" }),
  });

  const restored = readCartFromStorage(storage, "ar-mor");

  assert.deepEqual(restored.lines, []);
  assert.equal(restored.period, null);
  assert.equal(storage.getItem(LEGACY_CART_STORAGE_KEY), null);
});

test("readCartFromStorage prefers the scoped key over the legacy one", () => {
  const storage = createStorage({
    [LEGACY_CART_STORAGE_KEY]: JSON.stringify(legacyCart),
    [getCartStorageKey("ar-mor")]: JSON.stringify({
      storeSlug: "ar-mor",
      lines: [{ productId: "p9", quantity: 1 }],
      period: null,
      pricingMode: "hour",
    }),
  });

  const restored = readCartFromStorage(storage, "ar-mor");

  assert.equal(restored.lines.length, 1);
  assert.equal(restored.lines[0].productId, "p9");
  assert.equal(restored.pricingMode, "hour");
  assert.equal(storage.getItem(LEGACY_CART_STORAGE_KEY), null);
});

test("readCartFromStorage frees a child whose parent is gone", () => {
  const storage = createStorage({
    [getCartStorageKey("ar-mor")]: JSON.stringify({
      storeSlug: "ar-mor",
      lines: [{ productId: "p2", quantity: 1, parentLineId: "missing", requiredQuantity: 1 }],
    }),
  });

  const restored = readCartFromStorage(storage, "ar-mor");

  assert.equal(restored.lines[0].parentLineId, undefined);
  assert.equal(restored.lines[0].requiredQuantity, undefined);
});

test("writeCartToStorage round-trips through readCartFromStorage", () => {
  const storage = createStorage();
  const restored = readCartFromStorage(
    createStorage({ [LEGACY_CART_STORAGE_KEY]: JSON.stringify(legacyCart) }),
    "ar-mor",
  );

  writeCartToStorage(storage, "ar-mor", restored);
  const again = readCartFromStorage(storage, "ar-mor");

  assert.deepEqual(again, restored);
  assert.ok(storage.entries.has(getCartStorageKey("ar-mor")));
});
