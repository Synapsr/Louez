import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LOGGED_CANDIDATES_PER_CLASS,
  classifyLegacyFeeCandidate,
  isLegacyFeeReportTick,
  legacyFeeReportWindow,
  summarizeLegacyFeeCandidates,
  type LegacyFeeCandidate,
  type LegacyFeeCandidateFlags,
} from "./legacy-fee-repair-core";

const NO_FLAGS: LegacyFeeCandidateFlags = {
  modeChanged: false,
  ownedByWebhook: false,
  openSession: false,
  monthClosed: false,
};
const ALL_FLAGS: LegacyFeeCandidateFlags = {
  modeChanged: true,
  ownedByWebhook: true,
  openSession: true,
  monthClosed: true,
};

describe("legacy fee report window", () => {
  test("starts at the UTC start of the previous month and stops 15 minutes ago", () => {
    assert.deepEqual(legacyFeeReportWindow(new Date("2026-03-02T04:45:00Z")), {
      from: new Date("2026-02-01T00:00:00Z"),
      to: new Date("2026-03-02T04:30:00Z"),
    });
  });

  test("goes back into the previous year in January", () => {
    assert.deepEqual(
      legacyFeeReportWindow(new Date("2026-01-02T04:45:00Z")).from,
      new Date("2025-12-01T00:00:00Z"),
    );
  });

  test("uses UTC months, whatever the offset of the instant", () => {
    // 1 March in Paris, still 28 February in UTC.
    assert.deepEqual(
      legacyFeeReportWindow(new Date("2026-03-01T00:30:00+01:00")).from,
      new Date("2026-01-01T00:00:00Z"),
    );
  });
});

describe("legacy fee report tick", () => {
  test("runs at 04:45 UTC only", () => {
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T04:45:00Z")), true);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T04:45:59Z")), true);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T06:45:00+02:00")), true);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T04:44:00Z")), false);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T04:46:00Z")), false);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T05:45:00Z")), false);
    assert.equal(isLegacyFeeReportTick(new Date("2026-03-02T04:45:00+02:00")), false);
  });
});

describe("legacy fee candidate classes", () => {
  const cases: {
    kind: LegacyFeeCandidate["kind"];
    flags: Partial<LegacyFeeCandidateFlags>;
    expected: string;
  }[] = [
    { kind: "record", flags: ALL_FLAGS, expected: "mode_changed" },
    { kind: "record", flags: { ...ALL_FLAGS, modeChanged: false }, expected: "owned_by_webhook" },
    { kind: "record", flags: { openSession: true, monthClosed: true }, expected: "open_session" },
    { kind: "record", flags: { monthClosed: true }, expected: "month_closed" },
    { kind: "record", flags: {}, expected: "missed" },
    // The marketplace fee does not depend on pay-as-you-go.
    { kind: "marketplace", flags: { modeChanged: true }, expected: "missed" },
    { kind: "marketplace", flags: ALL_FLAGS, expected: "owned_by_webhook" },
    // Payment requests and extensions never take the marketplace fee.
    { kind: "marketplace", flags: { openSession: true }, expected: "missed" },
    {
      kind: "marketplace",
      flags: { openSession: true, monthClosed: true },
      expected: "month_closed",
    },
    // A void has only the month to check.
    { kind: "void", flags: { ...ALL_FLAGS, monthClosed: false }, expected: "missed" },
    { kind: "void", flags: ALL_FLAGS, expected: "month_closed" },
  ];

  for (const { kind, flags, expected } of cases) {
    test(`${kind} with ${JSON.stringify(flags)} is ${expected}`, () => {
      assert.equal(classifyLegacyFeeCandidate(kind, { ...NO_FLAGS, ...flags }), expected);
    });
  }
});

describe("legacy fee report summary", () => {
  const candidate = (
    kind: LegacyFeeCandidate["kind"],
    reservationId: string,
    at: string,
    flags: Partial<LegacyFeeCandidateFlags> = {},
  ): LegacyFeeCandidate => ({
    kind,
    reservationId,
    storeId: "store",
    at: new Date(at),
    flags: { ...NO_FLAGS, ...flags },
  });

  test("counts every class of every kind, zeros included, and lists the newest first", () => {
    const { counts, groups } = summarizeLegacyFeeCandidates([
      candidate("record", "late", "2026-02-20T10:00:00Z"),
      candidate("record", "early", "2026-02-10T10:00:00Z"),
      candidate("record", "switched", "2026-02-11T10:00:00Z", { modeChanged: true }),
      candidate("void", "cancelled", "2026-02-12T10:00:00Z", { monthClosed: true }),
    ]);

    assert.deepEqual(counts, {
      record: { mode_changed: 1, owned_by_webhook: 0, open_session: 0, month_closed: 0, missed: 2 },
      marketplace: { owned_by_webhook: 0, month_closed: 0, missed: 0 },
      void: { month_closed: 1, missed: 0 },
    });
    assert.deepEqual(groups, [
      {
        kind: "record",
        class: "missed",
        count: 2,
        candidates: [
          { reservationId: "late", storeId: "store", at: "2026-02-20T10:00:00.000Z" },
          { reservationId: "early", storeId: "store", at: "2026-02-10T10:00:00.000Z" },
        ],
      },
      {
        kind: "void",
        class: "month_closed",
        count: 1,
        candidates: [
          { reservationId: "cancelled", storeId: "store", at: "2026-02-12T10:00:00.000Z" },
        ],
      },
      {
        kind: "record",
        class: "mode_changed",
        count: 1,
        candidates: [
          { reservationId: "switched", storeId: "store", at: "2026-02-11T10:00:00.000Z" },
        ],
      },
    ]);
  });

  test("lists the newest 100 per class but counts them all", () => {
    const start = Date.parse("2026-02-01T00:00:00Z");
    const many = Array.from({ length: LOGGED_CANDIDATES_PER_CLASS + 5 }, (_, index) =>
      candidate("marketplace", `res_${index}`, new Date(start + index * 60_000).toISOString()),
    );

    const { counts, groups } = summarizeLegacyFeeCandidates(many);

    assert.equal(counts.marketplace.missed, LOGGED_CANDIDATES_PER_CLASS + 5);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.candidates.length, LOGGED_CANDIDATES_PER_CLASS);
    const listed = groups[0]?.candidates.map((listedCandidate) => listedCandidate.reservationId);
    assert.equal(listed?.[0], `res_${LOGGED_CANDIDATES_PER_CLASS + 4}`);
    assert.equal(listed?.at(-1), "res_5");
  });
});
