import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
mock.module("@louez/utils", { namedExports: createRequire(import.meta.url)("@louez/utils") });

const { resolveReferralAttribution } = await import("./referral-attribution");

const VALID_CODE = "LOUEZ7A9K2M3"; // LOUEZ + 7 unambiguous chars
const referrer = { id: "store_referrer", userId: "user_referrer" };

test("a valid code from another owner resolves to that referrer", () => {
  const result = resolveReferralAttribution({
    refCode: VALID_CODE,
    referrerStore: referrer,
    currentUserId: "user_new",
  });
  assert.deepEqual(result, {
    referredByUserId: "user_referrer",
    referredByStoreId: "store_referrer",
  });
});

test("self-referral (same owner) resolves to null", () => {
  const result = resolveReferralAttribution({
    refCode: VALID_CODE,
    referrerStore: referrer,
    currentUserId: "user_referrer",
  });
  assert.equal(result, null);
});

test("an unknown referrer store resolves to null", () => {
  const result = resolveReferralAttribution({
    refCode: VALID_CODE,
    referrerStore: null,
    currentUserId: "user_new",
  });
  assert.equal(result, null);
});

test("a malformed code resolves to null even if a store is supplied", () => {
  const result = resolveReferralAttribution({
    refCode: "NOTACODE",
    referrerStore: referrer,
    currentUserId: "user_new",
  });
  assert.equal(result, null);
});

test("a missing cookie value resolves to null", () => {
  assert.equal(
    resolveReferralAttribution({
      refCode: null,
      referrerStore: referrer,
      currentUserId: "user_new",
    }),
    null,
  );
  assert.equal(
    resolveReferralAttribution({
      refCode: undefined,
      referrerStore: referrer,
      currentUserId: "user_new",
    }),
    null,
  );
});
