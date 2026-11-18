import assert from "node:assert/strict";
import test from "node:test";

import type { VisibilityStep } from "@louez/api/contracts/visibility";

import {
  nextVisibilityStep,
  shouldOfferVisibilityGuide,
  visibilityCounts,
} from "./util.visibility-steps";

const at = new Date("2026-11-18T10:00:00Z");
const steps = (
  share: VisibilityStep["status"],
  poster: VisibilityStep["status"],
  google: VisibilityStep["status"],
): VisibilityStep[] => [
  { key: "share_contacts", status: share, decidedAt: share === "todo" ? null : at },
  { key: "qr_poster", status: poster, decidedAt: poster === "todo" ? null : at },
  { key: "google_business", status: google, decidedAt: google === "todo" ? null : at },
];

test("the next step is the first one still to do", () => {
  assert.equal(nextVisibilityStep(steps("todo", "todo", "todo"))?.key, "share_contacts");
  assert.equal(nextVisibilityStep(steps("done", "skipped", "todo"))?.key, "google_business");
});

test("a skipped step is not next", () => {
  assert.equal(nextVisibilityStep(steps("skipped", "todo", "todo"))?.key, "qr_poster");
});

test("no next step once each is done or skipped", () => {
  assert.equal(nextVisibilityStep(steps("done", "skipped", "done")), null);
});

test("counts done and skipped steps apart", () => {
  assert.deepEqual(visibilityCounts(steps("done", "skipped", "todo")), { done: 1, skipped: 1 });
});

test("the home offers the guide to an online store with a product, until closed", () => {
  const base = { online: true, hasActiveProduct: true, dismissedNoticeIds: [] };
  assert.equal(shouldOfferVisibilityGuide(base), true);
  assert.equal(shouldOfferVisibilityGuide({ ...base, online: false }), false);
  assert.equal(shouldOfferVisibilityGuide({ ...base, hasActiveProduct: false }), false);
  assert.equal(
    shouldOfferVisibilityGuide({ ...base, dismissedNoticeIds: ["visibility-guide"] }),
    false,
  );
});
