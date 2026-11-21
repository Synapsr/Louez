import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, mock, test } from "node:test";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
const utils: Record<string, unknown> = require("@louez/utils");
mock.module("@louez/utils", { namedExports: utils });

let commissionBase: typeof import("./partner-commission").commissionBase;
let commissionState: typeof import("./partner-commission").commissionState;
let computeCommission: typeof import("./partner-commission").computeCommission;
let monthOf: typeof import("./partner-commission").monthOf;
let monthRange: typeof import("./partner-commission").monthRange;
let monthTotals: typeof import("./partner-commission").monthTotals;
let recentMonths: typeof import("./partner-commission").recentMonths;

before(async () => {
  ({
    commissionBase,
    commissionState,
    computeCommission,
    monthOf,
    monthRange,
    monthTotals,
    recentMonths,
  } = await import("./partner-commission"));
});

describe("partner commission", () => {
  test("the base is the rental after discount, without insurance, delivery or deposit", () => {
    // subtotal_amount holds the lines and the insurance, never the delivery or the deposit.
    assert.equal(
      commissionBase(
        { subtotalAmount: "130.00", tulipInsuranceAmount: "10.00", discountAmount: "20.00" },
        "EUR",
      ),
      100,
    );
    assert.equal(
      commissionBase(
        { subtotalAmount: "80.00", tulipInsuranceAmount: null, discountAmount: null },
        "EUR",
      ),
      80,
    );
    // A discount larger than the lines leaves nothing, never a negative base.
    assert.equal(
      commissionBase(
        { subtotalAmount: "10.00", tulipInsuranceAmount: "0", discountAmount: "15" },
        "EUR",
      ),
      0,
    );
  });

  test("a percentage of the base, rounded to the currency's minor unit", () => {
    assert.equal(computeCommission({ type: "percent", value: 10 }, 123.45, "EUR"), 12.35);
    assert.equal(computeCommission({ type: "percent", value: 12.5 }, 99.99, "EUR"), 12.5);
    // The yen has no minor unit.
    assert.equal(computeCommission({ type: "percent", value: 10 }, 12345, "JPY"), 1235);
  });

  test("a fixed amount per booking, never more than the base", () => {
    assert.equal(computeCommission({ type: "fixed", value: 5 }, 80, "EUR"), 5);
    assert.equal(computeCommission({ type: "fixed", value: 50 }, 30, "EUR"), 30);
    assert.equal(computeCommission({ type: "fixed", value: 5 }, 0, "EUR"), 0);
  });

  test("due once completed, or once a confirmed or ongoing rental has ended", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const past = new Date("2026-11-18T18:00:00Z");
    const future = new Date("2026-11-25T18:00:00Z");
    assert.equal(commissionState("completed", future, now), "due");
    assert.equal(commissionState("ongoing", past, now), "due");
    assert.equal(commissionState("confirmed", past, now), "due");
    assert.equal(commissionState("confirmed", future, now), "upcoming");
    assert.equal(commissionState("ongoing", future, now), "upcoming");
    // A request or a quote is not a rental yet, even past its dates.
    assert.equal(commissionState("pending", past, now), "upcoming");
    assert.equal(commissionState("quote", past, now), "upcoming");
    for (const status of ["cancelled", "rejected", "declined"]) {
      assert.equal(commissionState(status, past, now), "cancelled");
    }
  });

  test("months are cut at the store's midnight", () => {
    // 23:30 UTC on 31 October is already 1 November in Paris.
    assert.equal(monthOf(new Date("2026-10-31T23:30:00Z"), "Europe/Paris"), "2026-11");
    assert.equal(monthOf(new Date("2026-10-31T23:30:00Z"), "UTC"), "2026-10");
    assert.deepEqual(monthRange("2026-11", "Europe/Paris"), {
      start: new Date("2026-10-31T23:00:00Z"),
      end: new Date("2026-11-30T23:00:00Z"),
    });
    assert.deepEqual(recentMonths(new Date("2026-01-15T12:00:00Z"), "UTC", 3), [
      "2026-01",
      "2025-12",
      "2025-11",
    ]);
  });

  test("a month's totals: due and upcoming apart, cancelled in neither, what is left after payments", () => {
    const totals = monthTotals(
      [
        { commission: 12.35, state: "due" },
        { commission: 5, state: "due" },
        { commission: 8, state: "upcoming" },
        { commission: 30, state: "cancelled" },
      ],
      10,
      42,
      "EUR",
    );
    assert.deepEqual(totals, {
      bookings: 4,
      due: 17.35,
      upcoming: 8,
      paid: 10,
      remaining: 7.35,
      visits: 42,
    });
    // Paid more than is now due (a rental changed after the payment): a negative balance.
    assert.equal(monthTotals([{ commission: 5, state: "due" }], 12, 0, "EUR").remaining, -7);
  });
});
