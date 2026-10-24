import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  initialBillableAt,
  planReservationInsert,
  type ReservationInsertValues,
} from "./reservation-insert";
import { reservations } from "./schema";

const NOW = new Date("2026-01-31T23:59:59.600Z");
const NOW_SECONDS = new Date("2026-01-31T23:59:59.000Z");

const values = (
  status: ReservationInsertValues["status"],
  source: string | null,
): ReservationInsertValues => ({
  id: "res_1",
  storeId: "store_1",
  customerId: "customer_1",
  number: "2026-0001",
  status,
  source,
  startDate: new Date("2026-02-01T09:00:00Z"),
  endDate: new Date("2026-02-02T09:00:00Z"),
  subtotalAmount: "10.00",
  depositAmount: "0.00",
  totalAmount: "10.00",
});

describe("initialBillableAt", () => {
  test("gives the date to billable statuses only", () => {
    const billable = ["confirmed", "ongoing", "completed"];
    for (const status of reservations.status.enumValues) {
      assert.equal(initialBillableAt(status, NOW), billable.includes(status) ? NOW : null, status);
    }
  });
});

describe("planReservationInsert", () => {
  test("a confirmed insert is billable from now and records the fee", () => {
    for (const [source, marketplace] of [
      ["manual", false],
      ["online", false],
      [null, false],
      ["marketplace", true],
    ] as const) {
      const plan = planReservationInsert(values("confirmed", source), NOW);
      assert.deepEqual(plan.row, { ...values("confirmed", source), billableAt: NOW_SECONDS });
      assert.deepEqual(
        plan.effects,
        [
          {
            type: "legacy_fee.record",
            storeId: "store_1",
            reservationId: "res_1",
            marketplace,
            at: NOW_SECONDS,
          },
        ],
        String(source),
      );
    }
  });

  test("a pending or quote insert has no billable date and no effect", () => {
    for (const status of ["pending", "quote"] as const) {
      for (const source of ["online", "manual", "marketplace"]) {
        const plan = planReservationInsert(values(status, source), NOW);
        assert.equal(plan.row.billableAt, null, `${status} ${source}`);
        assert.deepEqual(plan.effects, [], `${status} ${source}`);
      }
    }
  });
});
