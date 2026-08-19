import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isExportDateRangeWithinLimit,
  isValidExportDateRange,
  resolveStoreExportDateRange,
} from "./date-range";
import { contractExportParamsSchema, exportParamsSchema } from "./types";

test("store export ranges include the full last calendar day in the store timezone", () => {
  const range = resolveStoreExportDateRange("2026-07-01", "2026-07-31", "Europe/Paris");

  assert.equal(range.startDate.toISOString(), "2026-06-30T22:00:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-07-31T21:59:59.999Z");
});

test("store export ranges preserve inclusive days across a daylight-saving transition", () => {
  const range = resolveStoreExportDateRange("2026-10-25", "2026-10-25", "Europe/Paris");

  assert.equal(range.startDate.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-10-25T22:59:59.999Z");
});

test("an invalid store timezone safely falls back to UTC", () => {
  const range = resolveStoreExportDateRange("2026-08-01", "2026-08-01", "Not/A-Timezone");

  assert.equal(range.startDate.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-08-01T23:59:59.999Z");
});

test("date range validation rejects reversed and overlong ranges", () => {
  assert.equal(isValidExportDateRange("2026-08-02", "2026-08-01"), false);
  assert.equal(isValidExportDateRange("2026-08-01", "2026-08-01"), true);
  assert.equal(isExportDateRangeWithinLimit("2026-01-01", "2027-01-01"), true);
  assert.equal(isExportDateRangeWithinLimit("2026-01-01", "2027-01-02"), false);
});

test("contract exports require at least one valid reservation status", () => {
  const valid = contractExportParamsSchema.safeParse({
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    statuses: ["confirmed", "completed"],
    locale: "fr",
  });
  const empty = contractExportParamsSchema.safeParse({
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    statuses: [],
  });
  const unknown = contractExportParamsSchema.safeParse({
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    statuses: ["paid"],
  });

  assert.equal(valid.success, true);
  assert.equal(empty.success, false);
  assert.equal(unknown.success, false);
});

test("tabular exports now accept date-only calendar boundaries", () => {
  assert.equal(
    exportParamsSchema.safeParse({
      type: "reservations",
      format: "csv",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    }).success,
    true,
  );
  assert.equal(
    exportParamsSchema.safeParse({
      type: "reservations",
      format: "csv",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-31T00:00:00.000Z",
    }).success,
    false,
  );
});
