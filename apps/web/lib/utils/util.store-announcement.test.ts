import assert from "node:assert/strict";
import { test } from "node:test";

import { isExternalHref, resolveStoreAnnouncement } from "./util.store-announcement";

test("no bar without a theme, a disabled one or a blank text", () => {
  assert.equal(resolveStoreAnnouncement(null), null);
  assert.equal(resolveStoreAnnouncement({}), null);
  assert.equal(
    resolveStoreAnnouncement({ announcement: { enabled: false, text: "Fermé", href: null } }),
    null,
  );
  assert.equal(
    resolveStoreAnnouncement({ announcement: { enabled: true, text: "   ", href: "/catalog" } }),
    null,
  );
});

test("the text is trimmed and a blank href counts as no link", () => {
  assert.deepEqual(
    resolveStoreAnnouncement({
      announcement: { enabled: true, text: "  -10 % ce week-end  ", href: "  " },
    }),
    { text: "-10 % ce week-end", href: null, external: false },
  );
});

test("a store-relative href stays in the storefront, an absolute one leaves it", () => {
  assert.deepEqual(
    resolveStoreAnnouncement({ announcement: { enabled: true, text: "Promo", href: "/catalog" } }),
    { text: "Promo", href: "/catalog", external: false },
  );
  assert.deepEqual(
    resolveStoreAnnouncement({
      announcement: { enabled: true, text: "Promo", href: "https://example.com/offre" },
    }),
    { text: "Promo", href: "https://example.com/offre", external: true },
  );
});

test("only http(s) and protocol-relative hrefs are external", () => {
  assert.equal(isExternalHref("https://example.com"), true);
  assert.equal(isExternalHref("http://example.com/x"), true);
  assert.equal(isExternalHref("//example.com"), true);
  assert.equal(isExternalHref("/catalog"), false);
  assert.equal(isExternalHref("#reviews"), false);
  assert.equal(isExternalHref("mailto:hello@example.com"), false);
  assert.equal(isExternalHref("tel:+33600000000"), false);
});
