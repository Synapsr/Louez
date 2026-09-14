import assert from "node:assert/strict";
import { test } from "node:test";

import { getOnlineStoreSectionFromPathname } from "./util.online-store-section";

test("reads the section segment of an editor URL", () => {
  assert.equal(getOnlineStoreSectionFromPathname("/online-store/home"), "home");
  assert.equal(getOnlineStoreSectionFromPathname("/online-store/seo/"), "seo");
  assert.equal(getOnlineStoreSectionFromPathname("/online-store/contact?x=1"), "contact");
});

test("answers null outside the editor and for unknown sections", () => {
  assert.equal(getOnlineStoreSectionFromPathname("/online-store"), null);
  assert.equal(getOnlineStoreSectionFromPathname("/online-store/"), null);
  assert.equal(getOnlineStoreSectionFromPathname("/online-store/whatever"), null);
  assert.equal(getOnlineStoreSectionFromPathname("/dashboard/settings"), null);
  assert.equal(getOnlineStoreSectionFromPathname("/online-storefront/home"), null);
});
