import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesDeploymentMode } from "./matches-deployment-mode";

// A Connect event is heard in the mode of the deployment's Stripe secret key.

test("an event is heard in its key's mode, and in no other", () => {
  const cases: ReadonlyArray<
    readonly [secretKey: string | undefined, livemode: boolean, heard: boolean]
  > = [
    ["sk_test_123", false, true],
    ["sk_test_123", true, false],
    ["rk_test_123", false, true],
    ["rk_test_123", true, false],
    ["sk_live_123", true, true],
    ["sk_live_123", false, false],
    ["rk_live_123", true, true],
    ["rk_live_123", false, false],
    // Any other key reads as live, as `stripeKeyMode` has it.
    ["sk_other_123", true, true],
    ["sk_other_123", false, false],
    // A deployment with no key hears nothing.
    [undefined, false, false],
    [undefined, true, false],
    ["", false, false],
  ];
  for (const [secretKey, livemode, heard] of cases) {
    assert.equal(
      matchesDeploymentMode({ livemode, secretKey }),
      heard,
      `${String(secretKey)}, livemode ${livemode}`,
    );
  }
});
