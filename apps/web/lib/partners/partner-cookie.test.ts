import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { encodePartnerCookie, readPartnerCookie } from "./partner-cookie";

const CLICK = new Date("2026-11-19T10:00:00Z");

describe("partner cookie", () => {
  test("reads back the code and the click time it wrote, for the same store only", () => {
    const value = encodePartnerCookie("velo-evasion", "camping-les-pins", CLICK);
    assert.deepEqual(readPartnerCookie(value, "velo-evasion"), {
      code: "camping-les-pins",
      clickedAt: CLICK,
    });
    assert.equal(readPartnerCookie(value, "kayak-du-port"), null);
  });

  test("refuses a missing, malformed or forged value", () => {
    for (const value of [
      undefined,
      "camping-les-pins",
      "velo-evasion.camping-les-pins",
      "velo-evasion..1794000000",
      "velo-evasion.<script>.1794000000",
      "velo-evasion.camping-les-pins.soon",
      "velo-evasion.camping-les-pins.-5",
    ]) {
      assert.equal(readPartnerCookie(value, "velo-evasion"), null, String(value));
    }
  });
});
