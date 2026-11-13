import assert from "node:assert/strict";
import { test } from "node:test";

import { overridesAfter, readStatusStockRefusal } from "./status-stock-refusal";

const refusal = (data: unknown) => Object.assign(new Error("Not confirmed"), { data });
const shortfall = (productName: string, combinationKey: string | null = null) => ({
  productId: `prd_${productName}`,
  productName,
  combinationKey,
  requested: 3,
  available: 1,
});

test("a capacity refusal gives the dialog every shortfall, in the server's order", () => {
  const shortfalls = [shortfall("Kayak"), shortfall("Wetsuit", "size:M")];
  assert.deepEqual(
    readStatusStockRefusal(
      refusal({ code: "RESERVATION_INSUFFICIENT_CAPACITY", details: { shortfalls } }),
    ),
    { kind: "capacity", shortfalls },
  );
});

test("a buffer-only refusal is told apart: its dialog confirms past the buffer", () => {
  const shortfalls = [shortfall("Kayak")];
  assert.deepEqual(
    readStatusStockRefusal(
      refusal({ code: "RESERVATION_TURNOVER_BUFFER_CONFLICT", details: { shortfalls } }),
    ),
    { kind: "buffer", shortfalls },
  );
});

test("reads no other refusal, and no refusal without its shortfalls", () => {
  const shortfalls = [shortfall("Kayak")];
  assert.equal(
    readStatusStockRefusal(
      refusal({ code: "RESERVATION_ITEMS_UNAVAILABLE", details: { shortfalls } }),
    ),
    null,
  );
  assert.equal(
    readStatusStockRefusal(refusal({ code: "RESERVATION_INSUFFICIENT_CAPACITY", details: {} })),
    null,
  );
  assert.equal(
    readStatusStockRefusal(
      refusal({ code: "RESERVATION_INSUFFICIENT_CAPACITY", details: { shortfalls: [] } }),
    ),
    null,
  );
  assert.equal(
    readStatusStockRefusal(
      refusal({
        code: "RESERVATION_INSUFFICIENT_CAPACITY",
        details: { shortfalls: [{ ...shortfall("Kayak"), requested: "3" }] },
      }),
    ),
    null,
  );
  assert.equal(readStatusStockRefusal(new Error("network")), null);
  assert.equal(readStatusStockRefusal("RESERVATION_INSUFFICIENT_CAPACITY"), null);
});

test("confirm anyway sends the refusal's flag, and keeps the one already sent", () => {
  const shortfalls = [shortfall("Kayak")];
  const buffer = { kind: "buffer" as const, shortfalls };
  const capacity = { kind: "capacity" as const, shortfalls };

  assert.deepEqual(overridesAfter(buffer, {}), { overrideTurnoverBuffer: true });
  assert.deepEqual(overridesAfter(capacity, {}), { allowOverbooking: true });
  // Short both ways: the buffer's dialog first, then the stock's with the buffer kept.
  assert.deepEqual(overridesAfter(capacity, overridesAfter(buffer, {})), {
    overrideTurnoverBuffer: true,
    allowOverbooking: true,
  });
  assert.deepEqual(overridesAfter(buffer, { allowOverbooking: true }), {
    allowOverbooking: true,
    overrideTurnoverBuffer: true,
  });
});
