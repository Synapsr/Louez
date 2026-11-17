import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  consumeStartedCheckout,
  readPendingCheckout,
  writePendingCheckout,
} from "./util.pending-checkout-storage";

// The browser's record of the checkout it started, one per store: the hint a
// payment checkout resumes with, and the proof a confirmation page asks for
// before it empties this browser's cart. Proof is consumed: it works once.

const LEGACY_KEY = "louez:checkout:pending-reservation";

beforeEach(() => window.localStorage.clear());

test("each store keeps its own record", () => {
  writePendingCheckout({ storeId: "store_a", reservationId: "res_a", resumable: true });
  writePendingCheckout({ storeId: "store_b", reservationId: "res_b", resumable: true });

  assert.equal(readPendingCheckout("store_a"), "res_a");
  assert.equal(readPendingCheckout("store_b"), "res_b");
});

test("a request, which no checkout may resume, is never read as a resume hint", () => {
  writePendingCheckout({ storeId: "store_a", reservationId: "res_request", resumable: false });

  assert.equal(readPendingCheckout("store_a"), undefined);
  assert.equal(consumeStartedCheckout("store_a", "res_request"), true);
});

test("the record proves the checkout once, for its own store and reservation", () => {
  writePendingCheckout({ storeId: "store_a", reservationId: "res_a", resumable: true });

  assert.equal(consumeStartedCheckout("store_b", "res_a"), false);
  assert.equal(consumeStartedCheckout("store_a", "res_other"), false);
  assert.equal(readPendingCheckout("store_a"), "res_a", "a refused proof leaves the record");

  assert.equal(consumeStartedCheckout("store_a", "res_a"), true);
  assert.equal(consumeStartedCheckout("store_a", "res_a"), false);
  assert.equal(readPendingCheckout("store_a"), undefined);
});

test("without a record there is no proof", () => {
  assert.equal(consumeStartedCheckout("store_a", "res_a"), false);
});

test("a record written before records were per store still counts for its store, once", () => {
  window.localStorage.setItem(
    LEGACY_KEY,
    JSON.stringify({ storeId: "store_a", reservationId: "res_a" }),
  );

  assert.equal(readPendingCheckout("store_b"), undefined);
  assert.equal(consumeStartedCheckout("store_b", "res_a"), false);
  assert.equal(readPendingCheckout("store_a"), "res_a");
  assert.equal(consumeStartedCheckout("store_a", "res_a"), true);
  assert.equal(window.localStorage.getItem(LEGACY_KEY), null);
  assert.equal(consumeStartedCheckout("store_a", "res_a"), false);
});

test("a new record of a store replaces that store's older one", () => {
  window.localStorage.setItem(
    LEGACY_KEY,
    JSON.stringify({ storeId: "store_a", reservationId: "res_old" }),
  );
  writePendingCheckout({ storeId: "store_a", reservationId: "res_new", resumable: true });

  assert.equal(readPendingCheckout("store_a"), "res_new");
  assert.equal(consumeStartedCheckout("store_a", "res_old"), false);
});

test("a corrupt record proves nothing", () => {
  window.localStorage.setItem(`${LEGACY_KEY}:store_a`, "{not json");
  assert.equal(readPendingCheckout("store_a"), undefined);
  assert.equal(consumeStartedCheckout("store_a", "res_a"), false);
});
