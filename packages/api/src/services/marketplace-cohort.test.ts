import assert from "node:assert/strict";
import { test } from "node:test";

import { marketplaceCohortStatus, nextMarketplaceCohortRank } from "./marketplace-cohort";

test("assigns the last launch-cohort waiver at capacity minus one", () => {
  assert.equal(nextMarketplaceCohortRank(999, 1_000), 1_000);
  assert.deepEqual(marketplaceCohortStatus(999, 1_000), {
    taken: 999,
    total: 1_000,
    remaining: 1,
  });
});

test("does not assign a launch-cohort waiver once capacity is reached", () => {
  assert.equal(nextMarketplaceCohortRank(1_000, 1_000), null);
  assert.deepEqual(marketplaceCohortStatus(1_000, 1_000), {
    taken: 1_000,
    total: 1_000,
    remaining: 0,
  });
});
