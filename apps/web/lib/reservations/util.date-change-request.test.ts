import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getDateChangeResolution,
  canRequestDateChange,
  getDateChangeRequests,
  isValidRequestedEndDate,
} from "./util.date-change-request";

const start = new Date("2026-09-10T09:00:00Z");
const end = new Date("2026-09-14T09:00:00Z");
const now = new Date("2026-09-11T09:00:00Z");

describe("return date requests", () => {
  test("permits extensions and rejects early returns", () => {
    assert.equal(isValidRequestedEndDate(new Date("2026-09-15T09:00:00Z"), start, end, now), true);
    assert.equal(isValidRequestedEndDate(new Date("2026-09-12T09:00:00Z"), start, end, now), false);
  });
  test("rejects unchanged, invalid, past and pre-pickup dates", () => {
    for (const date of [end, start, now, new Date("invalid"), new Date("2026-09-01")]) {
      assert.equal(isValidRequestedEndDate(date, start, end, now), false);
    }
  });
  test("only confirmed and ongoing reservations accept requests", () => {
    for (const status of ["confirmed", "ongoing"]) assert.equal(canRequestDateChange(status), true);
    for (const status of ["pending", "quote", "completed", "cancelled", "rejected", "declined"])
      assert.equal(canRequestDateChange(status), false);
  });
  test("ignores unrelated or malformed activity without treating it as a request", () => {
    const request = {
      kind: "return_date_request",
      status: "pending",
      originalStartDate: start.toISOString(),
      originalEndDate: end.toISOString(),
      requestedEndDate: "2026-09-15T09:00:00.000Z",
      reason: "More time",
    };
    const rows = [
      { id: "a", metadata: null },
      { id: "b", metadata: { previous: {} } },
      { id: "c", metadata: request },
      { id: "d", metadata: { ...request, requestedEndDate: "invalid" } },
    ];
    assert.deepEqual(getDateChangeRequests(rows), [{ id: "c", ...request }]);
  });
});

test("acceptance requires the exact requested period; price-only edits leave requests pending", () => {
  const request = {
    id: "request",
    kind: "return_date_request",
    status: "pending",
    originalStartDate: start.toISOString(),
    originalEndDate: end.toISOString(),
    requestedEndDate: "2026-09-15T09:00:00.000Z",
    reason: "",
  } as const;
  assert.equal(getDateChangeResolution(request, start, end), "pending");
  assert.equal(
    getDateChangeResolution(request, start, new Date(request.requestedEndDate)),
    "accepted",
  );
  assert.equal(
    getDateChangeResolution(request, now, new Date(request.requestedEndDate)),
    "superseded",
  );
  assert.equal(
    getDateChangeResolution(request, start, new Date("2026-09-16T09:00:00Z")),
    "superseded",
  );
});
