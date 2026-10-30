import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type CachedNotice, balanceLimitCrossings } from "./balance-limit-crossings";

// Which cached versions start a balance limit email (louez-billing docs/api, README
// §8.8): the store's newest version, just cached, has a balance notice and the one
// before it had none. Sending is in balance-limit-email.db.test.ts.

const v = (storeId: string, version: number, noticeKind: CachedNotice["noticeKind"] = null) => ({
  storeId,
  version,
  noticeKind,
});

describe("balanceLimitCrossings", () => {
  test("ok to near, and ok straight to reached, are crossings", () => {
    assert.deepEqual(balanceLimitCrossings([v("s1", 1)], [v("s1", 2, "balance_limit_near")]), [
      { storeId: "s1", version: 2 },
    ]);
    assert.deepEqual(
      balanceLimitCrossings([v("s1", 1, "card_expiring")], [v("s1", 2, "balance_limit_reached")]),
      [{ storeId: "s1", version: 2 }],
    );
  });

  test("near to reached, and a version that leaves the notice, are not", () => {
    assert.deepEqual(
      balanceLimitCrossings(
        [v("s1", 1, "balance_limit_near")],
        [v("s1", 2, "balance_limit_reached")],
      ),
      [],
    );
    assert.deepEqual(balanceLimitCrossings([v("s1", 1, "balance_limit_near")], [v("s1", 2)]), []);
  });

  test("the version before is the one cached before the write, whatever the write brought", () => {
    // A pull that brings near then reached after an ok version: one crossing, the newest.
    assert.deepEqual(
      balanceLimitCrossings(
        [v("s1", 1)],
        [v("s1", 2, "balance_limit_near"), v("s1", 3, "balance_limit_reached")],
      ),
      [{ storeId: "s1", version: 3 }],
    );
    // A store already past its limit gets nothing when the crossing is over.
    assert.deepEqual(
      balanceLimitCrossings([v("s1", 1)], [v("s1", 2, "balance_limit_near"), v("s1", 3)]),
      [],
    );
  });

  test("into an empty cache, the version just below among the new ones decides", () => {
    const history = [v("s1", 1), v("s1", 2, "balance_limit_near")];
    assert.deepEqual(balanceLimitCrossings([], history), [{ storeId: "s1", version: 2 }]);
    const already = [v("s2", 1, "balance_limit_near"), v("s2", 2, "balance_limit_reached")];
    assert.deepEqual(balanceLimitCrossings([], already), []);
    // A store whose first version has the notice has no version before it.
    assert.deepEqual(balanceLimitCrossings([], [v("s3", 1, "balance_limit_near")]), [
      { storeId: "s3", version: 1 },
    ]);
  });

  test("a version older than the newest cached, and the * policy, start nothing", () => {
    assert.deepEqual(balanceLimitCrossings([v("s1", 5)], [v("s1", 4, "balance_limit_near")]), []);
    assert.deepEqual(balanceLimitCrossings([], [v("*", 1, "balance_limit_near")]), []);
  });
});
