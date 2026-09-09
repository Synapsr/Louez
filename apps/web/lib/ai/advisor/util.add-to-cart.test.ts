import assert from "node:assert/strict";
import { test } from "node:test";

import { findCartPeriodConflict, parseAdvisorAddToCartInput } from "./util.add-to-cart";

test("parses a valid input and normalises the dates to strict ISO", () => {
  const result = parseAdvisorAddToCartInput({
    productId: "p1",
    quantity: 2,
    startDate: "2026-09-10T09:00:00+02:00",
    endDate: "2026-09-12T18:00",
  });

  assert.ok(result.ok);
  assert.equal(result.request.productId, "p1");
  assert.equal(result.request.quantity, 2);
  assert.equal(result.request.startDate, "2026-09-10T07:00:00.000Z");
  assert.match(result.request.endDate, /^2026-09-12T\d{2}:00:00\.000Z$/);
});

test("rejects a malformed input", () => {
  assert.deepEqual(parseAdvisorAddToCartInput({ productId: "p1", quantity: 0 }), {
    ok: false,
    reason: "invalid_input",
  });
  assert.deepEqual(parseAdvisorAddToCartInput(null), { ok: false, reason: "invalid_input" });
});

test("rejects an unparsable or inverted period", () => {
  assert.deepEqual(
    parseAdvisorAddToCartInput({
      productId: "p1",
      quantity: 1,
      startDate: "tomorrow",
      endDate: "2026-09-12T18:00:00Z",
    }),
    { ok: false, reason: "invalid_dates" },
  );
  assert.deepEqual(
    parseAdvisorAddToCartInput({
      productId: "p1",
      quantity: 1,
      startDate: "2026-09-12T18:00:00Z",
      endDate: "2026-09-10T09:00:00Z",
    }),
    { ok: false, reason: "invalid_dates" },
  );
});

test("an empty cart never conflicts", () => {
  assert.equal(
    findCartPeriodConflict(
      {
        hasItems: false,
        startDate: "2026-09-01T07:00:00.000Z",
        endDate: "2026-09-02T16:00:00.000Z",
      },
      { startDate: "2026-09-10T07:00:00.000Z", endDate: "2026-09-12T16:00:00.000Z" },
    ),
    null,
  );
});

test("the same instant in another offset is not a conflict", () => {
  assert.equal(
    findCartPeriodConflict(
      {
        hasItems: true,
        startDate: "2026-09-10T09:00:00+02:00",
        endDate: "2026-09-12T18:00:00+02:00",
      },
      { startDate: "2026-09-10T07:00:00.000Z", endDate: "2026-09-12T16:00:00.000Z" },
    ),
    null,
  );
});

test("other dates on a non-empty cart return the cart period", () => {
  assert.deepEqual(
    findCartPeriodConflict(
      {
        hasItems: true,
        startDate: "2026-09-10T07:00:00.000Z",
        endDate: "2026-09-12T16:00:00.000Z",
      },
      { startDate: "2026-09-11T07:00:00.000Z", endDate: "2026-09-12T16:00:00.000Z" },
    ),
    { cartStartDate: "2026-09-10T07:00:00.000Z", cartEndDate: "2026-09-12T16:00:00.000Z" },
  );
});
