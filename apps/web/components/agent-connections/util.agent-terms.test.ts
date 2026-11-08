import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultAgentTerms, isAgentTermsComplete, withBundle, withStore } from "./util.agent-terms";

test("a first connection starts on the current stores, read and write, confirmation on, daily tools", () => {
  assert.deepEqual(defaultAgentTerms(["s1", "s2"], null), {
    stores: { all: false, ids: ["s1", "s2"] },
    preset: "write",
    confirmSensitive: true,
    bundles: ["daily"],
  });
});

test("a connection granted before starts from its terms", () => {
  const current = {
    stores: { all: true as const },
    preset: "read" as const,
    confirmSensitive: false,
    bundles: ["daily" as const, "catalog" as const],
  };
  assert.deepEqual(defaultAgentTerms(["s1"], current), current);
});

test("a store granted before that the user left is dropped", () => {
  const current = {
    stores: { all: false as const, ids: ["s1", "gone"] },
    preset: "read" as const,
    confirmSensitive: true,
    bundles: ["daily" as const],
  };
  assert.deepEqual(defaultAgentTerms(["s1", "s2"], current).stores, { all: false, ids: ["s1"] });
  // Every chosen store gone, others left: the user picks again.
  const none = defaultAgentTerms(["s2"], { ...current, stores: { all: false, ids: ["gone"] } });
  assert.deepEqual(none.stores, { all: false, ids: [] });
  assert.equal(isAgentTermsComplete(none), false);
});

test("a user with no store any longer reconnects over every store to come", () => {
  const stale = {
    stores: { all: false as const, ids: ["gone"] },
    preset: "write" as const,
    confirmSensitive: true,
    bundles: ["daily" as const],
  };
  const terms = defaultAgentTerms([], stale);
  assert.deepEqual(terms.stores, { all: true });
  assert.equal(isAgentTermsComplete(terms), true);
  assert.deepEqual(defaultAgentTerms([], null).stores, { all: true });
});

test("stores and bundles toggle without duplicates, in a stable order", () => {
  assert.deepEqual(withStore({ all: false, ids: ["s1"] }, "s1", true), { all: false, ids: ["s1"] });
  assert.deepEqual(withStore({ all: false, ids: ["s1", "s2"] }, "s1", false), {
    all: false,
    ids: ["s2"],
  });
  assert.deepEqual(withBundle(["catalog"], "daily", true), ["daily", "catalog"]);
  assert.deepEqual(withBundle(["daily", "catalog"], "daily", false), ["catalog"]);
});

test("terms need a store and a bundle", () => {
  const terms = defaultAgentTerms(["s1"], null);
  assert.equal(isAgentTermsComplete(terms), true);
  assert.equal(isAgentTermsComplete({ ...terms, stores: { all: false, ids: [] } }), false);
  assert.equal(isAgentTermsComplete({ ...terms, stores: { all: true } }), true);
  assert.equal(isAgentTermsComplete({ ...terms, bundles: [] }), false);
});
