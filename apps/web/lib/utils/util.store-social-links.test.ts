import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStoreSocialLinks } from "./util.store-social-links";

test("no settings, no links", () => {
  assert.deepEqual(resolveStoreSocialLinks(null), []);
  assert.deepEqual(resolveStoreSocialLinks(undefined), []);
  assert.deepEqual(resolveStoreSocialLinks({}), []);
});

test("blank and null entries are dropped, the rest is trimmed", () => {
  assert.deepEqual(
    resolveStoreSocialLinks({
      instagram: "  https://instagram.com/armor  ",
      facebook: "   ",
      tiktok: null,
      website: "",
    }),
    [{ network: "instagram", url: "https://instagram.com/armor" }],
  );
});

test("links come out in the fixed network order, not the saved one", () => {
  assert.deepEqual(
    resolveStoreSocialLinks({
      website: "https://armor.example",
      x: "https://x.com/armor",
      instagram: "https://instagram.com/armor",
    }).map((link) => link.network),
    ["instagram", "x", "website"],
  );
});
