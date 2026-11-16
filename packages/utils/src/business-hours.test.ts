import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildExistingStoreDate, zonedLocalTimeToInstant } from "./business-hours";

// Paris moves its clocks from 02:00 to 03:00 on 30 March 2031, and from 03:00
// back to 02:00 on 26 October 2031.
const PARIS = "Europe/Paris";

describe("a local time typed in the store's time zone (T5)", () => {
  test("a time the clocks skip does not exist", () => {
    assert.equal(zonedLocalTimeToInstant("2031-03-30T02:00", PARIS), null);
    assert.equal(zonedLocalTimeToInstant("2031-03-30T02:30", PARIS), null);
    assert.equal(buildExistingStoreDate(new Date(2031, 2, 30), "02:30", PARIS), null);
  });

  test("the times around the skip exist, at their own instant", () => {
    assert.equal(
      zonedLocalTimeToInstant("2031-03-30T01:30", PARIS)?.toISOString(),
      "2031-03-30T00:30:00.000Z",
    );
    assert.equal(
      buildExistingStoreDate(new Date(2031, 2, 30), "03:00", PARIS)?.toISOString(),
      "2031-03-30T01:00:00.000Z",
    );
  });

  test("a time the clocks pass twice exists", () => {
    const instant = zonedLocalTimeToInstant("2031-10-26T02:30", PARIS);
    assert.ok(instant);
    assert.ok(
      ["2031-10-26T00:30:00.000Z", "2031-10-26T01:30:00.000Z"].includes(instant.toISOString()),
    );
  });

  test("anything but a local date and time is refused", () => {
    assert.equal(zonedLocalTimeToInstant("not a date", PARIS), null);
    assert.equal(zonedLocalTimeToInstant("2031-03-30T09:00:00", PARIS), null);
  });
});
