import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateReceiptCents, toCents } from "./util.receipt-allocation";

const sum = (allocation: Map<string, number>) =>
  [...allocation.values()].reduce((total, cents) => total + cents, 0);

test("€1 over three equal items gives 34, 33 and 33 cents, the extra cent to the first id", () => {
  const allocation = allocateReceiptCents(100, [
    { id: "c", weightCents: 1000 },
    { id: "a", weightCents: 1000 },
    { id: "b", weightCents: 1000 },
  ]);
  assert.deepEqual(Object.fromEntries(allocation), { a: 34, b: 33, c: 33 });
});

test("the cents left go to the largest remainders, then to the larger share", () => {
  // 10.00 split 2/3 – 1/3: 666.67 and 333.33 → 667 and 333.
  assert.deepEqual(
    Object.fromEntries(
      allocateReceiptCents(1000, [
        { id: "small", weightCents: 1 },
        { id: "large", weightCents: 2 },
      ]),
    ),
    { small: 333, large: 667 },
  );
  // Equal remainders: the larger share takes the cent.
  assert.deepEqual(
    Object.fromEntries(
      allocateReceiptCents(5, [
        { id: "a", weightCents: 1 },
        { id: "b", weightCents: 3 },
      ]),
    ),
    { a: 1, b: 4 },
  );
});

test("the parts always sum to the receipt", () => {
  const items = [
    { id: "i1", weightCents: 1999 },
    { id: "i2", weightCents: 1 },
    { id: "i3", weightCents: 7333 },
    { id: "i4", weightCents: 250 },
  ];
  for (const amount of [1, 2, 3, 99, 100, 101, 9583, 123_457, 9_999_999_999]) {
    assert.equal(sum(allocateReceiptCents(amount, items)), amount, String(amount));
  }
});

test("free items get nothing, and a reservation of free items allocates nothing", () => {
  assert.deepEqual(
    Object.fromEntries(
      allocateReceiptCents(100, [
        { id: "paid", weightCents: 500 },
        { id: "free", weightCents: 0 },
      ]),
    ),
    { paid: 100 },
  );
  assert.equal(allocateReceiptCents(100, [{ id: "free", weightCents: 0 }]).size, 0);
  assert.equal(allocateReceiptCents(0, [{ id: "paid", weightCents: 500 }]).size, 0);
});

test("stored decimal amounts become whole cents", () => {
  assert.equal(toCents("12.34"), 1234);
  assert.equal(toCents("0.10"), 10);
  assert.equal(toCents("99999999.99"), 9_999_999_999);
  assert.equal(toCents(null), 0);
});
