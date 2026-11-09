import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HANDOFF_ROUTE_HEADER,
  isHandoffPath,
  loadsClientAnalytics,
  redactHandoffSecrets,
  redactLogValue,
  resumableHandoffPath,
} from "./handoff-privacy";

// A handoff's URL holds a secret: the logger redacts it, the root layout loads
// no analytics for it, and the login goes back only to a handoff path.

const ID = "AbCdEfGhIjKlMnOpQrStU";
const SECRET = "s".repeat(43);
const STATE = "t".repeat(43);

describe("handoff privacy", () => {
  test("redacts the link's secret and the return's state, keeping the id", () => {
    assert.equal(redactHandoffSecrets(`/handoffs/${ID}${SECRET}`), `/handoffs/${ID}[redacted]`);
    assert.equal(
      redactHandoffSecrets(`GET /handoffs/${ID}${SECRET}/continue failed`),
      `GET /handoffs/${ID}[redacted]/continue failed`,
    );
    assert.equal(
      redactHandoffSecrets(`https://app.louez.test/handoffs/return/${ID}/${STATE}?checkout=cs_1`),
      `https://app.louez.test/handoffs/return/${ID}/[redacted]?checkout=cs_1`,
    );
    assert.equal(
      redactHandoffSecrets(`/handoffs/refresh/${ID}/${STATE}`),
      `/handoffs/refresh/${ID}/[redacted]`,
    );
    assert.equal(
      redactHandoffSecrets(`/login?callbackUrl=%2Fhandoffs%2F${ID}${SECRET}`),
      "/login?callbackUrl=%2Fhandoffs%2F[redacted]",
    );
    // Nothing secret in these.
    for (const path of [`/handoffs/done/${ID}`, "/handoffs/resume", "/dashboard/settings"]) {
      assert.equal(redactHandoffSecrets(path), path);
    }
  });

  test("redacts every string of a log event, nested", () => {
    const event = {
      path: `/handoffs/${ID}${SECRET}`,
      error: { message: `failed at /handoffs/return/${ID}/${STATE}`, status: 500 },
      lines: [`/handoffs/${ID}${SECRET}`],
      at: new Date("2026-11-09T10:00:00Z"),
    };
    const redacted = redactLogValue(event);
    assert.ok(!JSON.stringify(redacted).includes(SECRET));
    assert.ok(!JSON.stringify(redacted).includes(STATE));
    assert.equal(redacted.error.status, 500);
    assert.equal(redacted.at.getTime(), event.at.getTime());
  });

  test("the root layout loads no analytics on a handoff page", () => {
    assert.equal(loadsClientAnalytics(new Headers()), true);
    assert.equal(loadsClientAnalytics(new Headers({ [HANDOFF_ROUTE_HEADER]: "1" })), false);
    assert.equal(isHandoffPath("/handoffs/x"), true);
    assert.equal(isHandoffPath("/handoffsx"), false);
  });

  test("the login goes back to a handoff path only", () => {
    for (const path of [
      `/handoffs/${ID}${SECRET}`,
      `/handoffs/return/${ID}/${STATE}`,
      `/handoffs/return/${ID}/${STATE}?checkout=cs_test_1`,
      `/handoffs/refresh/${ID}/${STATE}`,
    ]) {
      assert.equal(resumableHandoffPath(path), path);
    }
    for (const path of [
      undefined,
      "",
      "https://evil.test/",
      "//evil.test/handoffs/x",
      `/handoffs/${ID}${SECRET}/../../dashboard`,
      `/handoffs/return/${ID}/${STATE}?next=https://evil.test`,
      "/dashboard",
    ]) {
      assert.equal(resumableHandoffPath(path), null, String(path));
    }
  });
});
