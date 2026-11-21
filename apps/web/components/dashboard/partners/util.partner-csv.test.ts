import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildPartnerStatementCsv, partnerStatementFileName } from "./util.partner-csv";

const labels = {
  headers: {
    number: "Number",
    startDate: "Start",
    endDate: "End",
    base: "Rental",
    rule: "Rule",
    commission: "Commission",
    state: "State",
    note: "Note",
  },
  states: { upcoming: "Upcoming", due: "Due", cancelled: "Cancelled" },
};

const booking = {
  reservationId: "r1",
  number: "R-0042",
  startDate: new Date("2026-11-02T08:00:00Z"),
  endDate: new Date("2026-11-04T18:00:00Z"),
  base: 120,
  computed: 12,
  commission: 12,
  adjustment: null,
  rule: { type: "percent" as const, value: 10 },
  state: "due" as const,
  origin: "link" as const,
};

describe("partner statement CSV", () => {
  test("one line per reservation, amounts in the currency, a cancelled one at zero", () => {
    const csv = buildPartnerStatementCsv(
      {
        currency: "EUR",
        bookings: [
          booking,
          { ...booking, number: "R-0043", state: "cancelled", commission: 8, computed: 8 },
          {
            ...booking,
            number: "R-0044",
            rule: { type: "fixed", value: 5 },
            commission: 2.5,
            adjustment: { amount: 2.5, note: "=half refunded" },
          },
        ],
      },
      labels,
    );
    const lines = csv.replace("﻿", "").split("\r\n");
    assert.equal(lines[0], "Number,Start,End,Rental (EUR),Rule,Commission (EUR),State,Note");
    assert.equal(lines[1], "R-0042,2026-11-02,2026-11-04,120.00,10 %,12.00,Due,");
    assert.equal(lines[2], "R-0043,2026-11-02,2026-11-04,120.00,10 %,0.00,Cancelled,");
    // A note typed by the store cannot run as a formula.
    assert.equal(lines[3], "R-0044,2026-11-02,2026-11-04,120.00,5.00,2.50,Due,'=half refunded");
  });

  test("names the file after the partner's code and the month", () => {
    assert.equal(partnerStatementFileName("les-pins", "2026-11"), "les-pins-2026-11.csv");
  });
});
