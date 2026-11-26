import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { encodePartnerCookie, readPartnerCookie } from "./partner-cookie";

const CLICK = new Date("2026-11-19T10:00:00Z");
const SECRET = "a-server-secret-for-partner-cookies";

describe("partner cookie", () => {
  test("reads back the code and the click time it wrote, for the same store only", () => {
    const value = encodePartnerCookie("velo-evasion", "camping-les-pins", CLICK, SECRET);
    assert.deepEqual(readPartnerCookie(value, "velo-evasion", SECRET), {
      code: "camping-les-pins",
      clickedAt: CLICK,
    });
    assert.equal(readPartnerCookie(value, "kayak-du-port", SECRET), null);
  });

  test("refuses a value the server did not sign: unsigned, forged, edited or another secret's", () => {
    const signed = encodePartnerCookie("velo-evasion", "camping-les-pins", CLICK, SECRET);
    const signature = signed.split(".")[3];
    for (const value of [
      // The format before the cookie was signed.
      "velo-evasion.camping-les-pins.1794000000",
      `velo-evasion.camping-les-pins.1794000000.${"A".repeat(43)}`,
      // A signed value with another code or another click time.
      `velo-evasion.hotel-du-port.${signed.split(".")[2]}.${signature}`,
      `velo-evasion.camping-les-pins.1794000000.${signature}`,
      encodePartnerCookie("velo-evasion", "camping-les-pins", CLICK, "another-secret"),
    ]) {
      assert.equal(readPartnerCookie(value, "velo-evasion", SECRET), null, value);
    }
    assert.equal(readPartnerCookie(signed, "velo-evasion", ""), null);
  });

  test("refuses a missing or malformed value", () => {
    for (const value of [
      undefined,
      "camping-les-pins",
      "velo-evasion.camping-les-pins",
      "velo-evasion..1794000000.x",
      "velo-evasion.<script>.1794000000.x",
      "velo-evasion.camping-les-pins.soon.x",
      // Signed, but not a code.
      encodePartnerCookie("velo-evasion", "<script>", CLICK, SECRET),
    ]) {
      assert.equal(readPartnerCookie(value, "velo-evasion", SECRET), null, String(value));
    }
  });
});
