import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "./util.cart-line-input";
import {
  type CartLineIntent,
  type CartResolutionLine,
  addCartLine,
  buildCartResolveInput,
  buildSelectionSignature,
  deriveCartItems,
  getDefaultCartPeriod,
  hasUnavailableCartLines,
  removeCartLine,
  removeCartLinesByProduct,
  restoreCartLines,
  setCartLineQuantity,
  summarizeCart,
} from "./util.cart-lines";

const period = {
  startDate: "2026-09-10T08:00:00.000Z",
  endDate: "2026-09-12T08:00:00.000Z",
};

const kayakInput = (overrides: Partial<CartLineInput> = {}): CartLineInput => ({
  productId: "kayak",
  productName: "Kayak",
  productImage: null,
  price: 30,
  deposit: 100,
  quantity: 1,
  maxQuantity: 3,
  pricingKind: "duration",
  stockKind: "returnable",
  pricingMode: "day",
  requiredAccessories: [
    {
      productId: "paddle",
      productName: "Paddle",
      productImage: null,
      price: 0,
      deposit: 0,
      maxQuantity: 6,
      requiredQuantity: 2,
      pricingKind: "fixed",
      pricingMode: "day",
      productPricingMode: "day",
      basePeriodMinutes: null,
    },
  ],
  ...overrides,
});

const findParent = (lines: CartLineIntent[]) =>
  lines.find((line) => !line.parentLineId && line.productId === "kayak");
const findChild = (lines: CartLineIntent[]) => lines.find((line) => line.parentLineId);

test("buildSelectionSignature normalises keys and order", () => {
  assert.equal(buildSelectionSignature(undefined), "__default");
  assert.equal(
    buildSelectionSignature({ Size: " M ", color: "red" }),
    buildSelectionSignature({ color: "red", size: "M" }),
  );
});

test("addCartLine attaches required accessories at requiredQuantity x quantity", () => {
  const lines = addCartLine([], kayakInput({ quantity: 2 }));

  const parent = findParent(lines);
  const child = findChild(lines);
  assert.ok(parent);
  assert.ok(child);
  assert.equal(parent.quantity, 2);
  assert.equal(child.parentLineId, parent.lineId);
  assert.equal(child.quantity, 4);
});

test("addCartLine merges the same product and selection, capped at stock", () => {
  const once = addCartLine([], kayakInput({ quantity: 2 }));
  const twice = addCartLine(once, kayakInput({ quantity: 2 }));

  const parent = findParent(twice);
  assert.ok(parent);
  assert.equal(twice.filter((line) => !line.parentLineId).length, 1);
  assert.equal(parent.quantity, 3);
  assert.equal(findChild(twice)?.quantity, 6);
});

test("addCartLine keeps different selections as separate lines", () => {
  const lines = addCartLine(
    addCartLine([], kayakInput({ selectedAttributes: { size: "M" }, requiredAccessories: [] })),
    kayakInput({ selectedAttributes: { size: "L" }, requiredAccessories: [] }),
  );

  assert.equal(lines.length, 2);
});

test("addCartLine drops a line nothing is left for", () => {
  const full = addCartLine([], kayakInput({ quantity: 3, requiredAccessories: [] }));
  const lines = addCartLine(full, kayakInput({ quantity: 1, requiredAccessories: [] }));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 3);
});

test("removeCartLine removes the parent with its accessories and reports them", () => {
  const lines = addCartLine([], kayakInput());
  const parent = findParent(lines);
  assert.ok(parent);

  const result = removeCartLine(lines, parent.lineId);

  assert.deepEqual(result.lines, []);
  assert.equal(result.removed.length, 2);
});

test("removeCartLine refuses to remove a required accessory alone", () => {
  const lines = addCartLine([], kayakInput());
  const child = findChild(lines);
  assert.ok(child);

  const result = removeCartLine(lines, child.lineId);

  assert.equal(result.lines, lines);
  assert.deepEqual(result.removed, []);
});

test("restoreCartLines puts removed lines back once", () => {
  const lines = addCartLine([], kayakInput());
  const parent = findParent(lines);
  assert.ok(parent);
  const { lines: without, removed } = removeCartLine(lines, parent.lineId);

  const restored = restoreCartLines(without, removed);

  assert.equal(restored.length, 2);
  assert.equal(restoreCartLines(restored, removed).length, 2);
});

test("removeCartLinesByProduct drops every line of the product and its children", () => {
  const lines = addCartLine([], kayakInput());

  assert.deepEqual(removeCartLinesByProduct(lines, "kayak"), []);
});

test("setCartLineQuantity realigns required accessories and caps at stock", () => {
  const lines = addCartLine([], kayakInput());
  const parent = findParent(lines);
  assert.ok(parent);

  const updated = setCartLineQuantity(lines, parent.lineId, 10);

  assert.equal(findParent(updated)?.quantity, 3);
  assert.equal(findChild(updated)?.quantity, 6);
});

test("setCartLineQuantity keeps a required accessory at its minimum", () => {
  const lines = addCartLine([], kayakInput({ quantity: 2 }));
  const child = findChild(lines);
  assert.ok(child);

  const updated = setCartLineQuantity(lines, child.lineId, 1);

  assert.equal(findChild(updated)?.quantity, 4);
});

test("setCartLineQuantity at zero removes the parent and its accessories", () => {
  const lines = addCartLine([], kayakInput());
  const parent = findParent(lines);
  assert.ok(parent);

  assert.deepEqual(setCartLineQuantity(lines, parent.lineId, 0), []);
});

test("buildCartResolveInput gives every line the cart period", () => {
  const lines = addCartLine([], kayakInput());

  const input = buildCartResolveInput(lines, period);

  assert.equal(input.lines.length, 2);
  assert.ok(input.lines.every((line) => line.startDate === period.startDate));
  assert.equal(input.lines[1].parentLineId, input.lines[0].lineId);
});

const resolvedLine = (
  line: CartLineIntent,
  overrides: Partial<Extract<CartResolutionLine, { status: "resolved" }>> = {},
): CartResolutionLine => ({
  status: "resolved",
  lineId: line.lineId,
  parentLineId: line.parentLineId,
  productId: line.productId,
  productName: `${line.productName} (server)`,
  productImage: null,
  price: 42,
  deposit: 10,
  maxQuantity: 5,
  quantity: line.quantity,
  pricingKind: "duration",
  stockKind: "returnable",
  required: Boolean(line.parentLineId),
  requiredQuantity: line.requiredQuantity ?? null,
  requiredAccessories: [],
  pricingMode: "day",
  productPricingMode: "day",
  basePeriodMinutes: null,
  enforceStrictTiers: false,
  pricingTiers: [],
  combination: null,
  ...overrides,
});

test("deriveCartItems overrides the snapshot with the resolution and applies the period", () => {
  const lines = addCartLine([], kayakInput({ requiredAccessories: [] }));

  const items = deriveCartItems({
    lines,
    resolution: { lines: [resolvedLine(lines[0])] },
    period,
    pricingMode: "day",
  });

  assert.equal(items[0].productName, "Kayak (server)");
  assert.equal(items[0].price, 42);
  assert.equal(items[0].startDate, period.startDate);
  assert.equal(items[0].pricingMode, "day");
  assert.equal(items[0].unavailableReason, undefined);
});

test("deriveCartItems keeps the snapshot for lines the resolution does not know", () => {
  const lines = addCartLine([], kayakInput({ requiredAccessories: [] }));

  const items = deriveCartItems({ lines, resolution: undefined, period, pricingMode: "day" });

  assert.equal(items[0].productName, "Kayak");
  assert.equal(items[0].price, 30);
});

test("deriveCartItems flags an unavailable line and lowers its maximum", () => {
  const lines = addCartLine([], kayakInput({ quantity: 3, requiredAccessories: [] }));

  const items = deriveCartItems({
    lines,
    resolution: {
      lines: [
        {
          status: "unavailable",
          lineId: lines[0].lineId,
          productId: "kayak",
          reason: "insufficient_stock",
          maxQuantity: 1,
        },
      ],
    },
    period,
    pricingMode: "day",
  });

  assert.equal(items[0].unavailableReason, "insufficient_stock");
  assert.equal(items[0].maxQuantity, 1);
  assert.equal(hasUnavailableCartLines(items), true);
});

test("deriveCartItems frees a child the store no longer requires", () => {
  const lines = addCartLine([], kayakInput());
  const child = findChild(lines);
  assert.ok(child);

  const items = deriveCartItems({
    lines,
    resolution: {
      lines: [resolvedLine(lines[0]), resolvedLine(child, { required: false })],
    },
    period,
    pricingMode: "day",
  });

  const derivedChild = items.find((item) => item.productId === "paddle");
  assert.equal(derivedChild?.parentLineId, undefined);
  assert.equal(derivedChild?.requiredQuantity, undefined);
});

test("summarizeCart excludes the deposit from the total", () => {
  const lines = addCartLine([], kayakInput({ quantity: 2, requiredAccessories: [] }));
  const items = deriveCartItems({ lines, resolution: undefined, period, pricingMode: "day" });

  const summary = summarizeCart(items, period, null);

  assert.equal(summary.count, 2);
  assert.equal(summary.subtotal, 120);
  assert.equal(summary.deposit, 200);
  assert.equal(summary.total, 120);
  assert.equal(summary.totalSavings, 0);
});

test("getDefaultCartPeriod runs from tomorrow to the day after", () => {
  const now = new Date(2026, 8, 7, 15, 30);

  const result = getDefaultCartPeriod(now);

  assert.equal(new Date(result.startDate).getDate(), 8);
  assert.equal(new Date(result.endDate).getDate(), 9);
  assert.equal(new Date(result.startDate).getHours(), 0);
});
