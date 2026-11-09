import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HANDOFF_ROUTE_HEADER,
  isHandoffPath,
  loadsClientAnalytics,
  resumableHandoffPath,
} from "./handoff-privacy";

// A handoff's URL holds a secret: the root layout loads no analytics for it,
// and the login goes back only to a handoff path.

const ID = "AbCdEfGhIjKlMnOpQrStU";
const SECRET = "s".repeat(43);
const STATE = "t".repeat(43);

describe("handoff privacy", () => {
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
