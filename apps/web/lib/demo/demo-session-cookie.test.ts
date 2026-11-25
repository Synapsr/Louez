import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDemoSessionCookie, parseDemoSessionCookie } from "./demo-session-cookie";

test("the demo cookie round-trips and refuses anything else", () => {
  const value = {
    vertical: "ski" as const,
    storeId: "abcDEF123_-xyz",
    visitorId: "abcDEF123_-xyz",
  };
  assert.deepEqual(parseDemoSessionCookie(formatDemoSessionCookie(value)), value);
  for (const raw of [
    undefined,
    "",
    "ski",
    "surf.abc.def",
    "ski.abc",
    "ski.abc.def.ghi",
    "ski.a b.c",
    "ski.<script>.x",
  ]) {
    assert.equal(parseDemoSessionCookie(raw), null, String(raw));
  }
});
