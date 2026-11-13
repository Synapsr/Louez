import assert from "node:assert/strict";
import { test } from "node:test";

import { checkoutSessionAccount, isSessionCreationRow } from "./checkout-session-account";

// A checkout session is read on the account its payment row records; a row
// that records none is read with the store's connected account of the moment.

test("the payment row Louez wrote when it created the session, and the rows it writes when one is paid", () => {
  const cases: ReadonlyArray<readonly [origin: string | null, creation: boolean]> = [
    ["checkout", true],
    ["customer_session", true],
    // Written before the column existed.
    [null, true],
    // Sessions that have no payment row until they are paid.
    ["payment_request", false],
    ["extension", false],
  ];
  for (const [origin, creation] of cases) {
    assert.equal(isSessionCreationRow({ origin }), creation, String(origin));
  }
});

test("the account a checkout session is read on, and the only one heard about it", () => {
  const cases: ReadonlyArray<
    readonly [recordedAccountId: string | null, storeAccountId: string | null, accepted: unknown]
  > = [
    // The row records the account the session was created on.
    ["acct_created_on", "acct_created_on", "acct_created_on"],
    // The store connected another account since: the row's account still.
    ["acct_created_on", "acct_today", "acct_created_on"],
    ["acct_created_on", null, "acct_created_on"],
    // A row that records none: the store's account at the time it is read.
    [null, "acct_today", "acct_today"],
    ["", "acct_today", "acct_today"],
    [null, null, null],
  ];
  for (const [recordedAccountId, storeAccountId, accepted] of cases) {
    assert.equal(
      checkoutSessionAccount({ recordedAccountId, storeAccountId }),
      accepted,
      `recorded ${String(recordedAccountId)}, store ${String(storeAccountId)}`,
    );
  }
});
