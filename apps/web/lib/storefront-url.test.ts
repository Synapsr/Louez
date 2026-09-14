import assert from "node:assert/strict";
import test from "node:test";

// `@/env` validates the whole process environment at import time; the URL
// helpers only read the public app URL/domain, so give them a platform
// deployment and skip the rest. NEXT_PUBLIC_APP_DOMAIN is captured once per
// process, which is why the localhost variants live in the pure builder tests.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.NEXT_PUBLIC_APP_DOMAIN = "louez.io";
process.env.NEXT_PUBLIC_APP_URL = "https://app.louez.io";
process.env.LOUEZ_MODE = "platform";

// The env must be set before the module loads, hence the lazy import.
const load = () => import("./storefront-url");

// These strings reach emails, SMS, Stripe return URLs and webhooks: the
// expectations below pin the output byte for byte.

test("platform: store root has no trailing slash", async () => {
  const { getStorefrontUrl } = await load();
  assert.equal(getStorefrontUrl("ddm"), "https://ddm.louez.io");
  assert.equal(getStorefrontUrl("ddm", "/"), "https://ddm.louez.io");
});

test("platform: paths are appended to the store subdomain", async () => {
  const { getStorefrontUrl } = await load();
  assert.equal(getStorefrontUrl("ddm", "/account"), "https://ddm.louez.io/account");
  assert.equal(getStorefrontUrl("ddm", "account/login"), "https://ddm.louez.io/account/login");
  assert.equal(
    getStorefrontUrl("ddm", "/account/reservations/abc?event=paid"),
    "https://ddm.louez.io/account/reservations/abc?event=paid",
  );
});

test("platform: embed and marketplace entry points keep their query strings", async () => {
  const { getStorefrontUrl } = await load();
  assert.equal(getStorefrontUrl("ddm", "/embed"), "https://ddm.louez.io/embed");
  assert.equal(
    getStorefrontUrl("ddm", "/?channel=marketplace"),
    "https://ddm.louez.io/?channel=marketplace",
  );
  assert.equal(
    getStorefrontUrl("ddm", "/rental?startDate=2026-09-10&endDate=2026-09-12"),
    "https://ddm.louez.io/rental?startDate=2026-09-10&endDate=2026-09-12",
  );
});

test("standalone: the storefront lives at the app URL root, never slugged", async () => {
  const { getStorefrontUrl } = await load();
  const previousMode = process.env.LOUEZ_MODE;
  process.env.LOUEZ_MODE = "standalone";
  try {
    assert.equal(getStorefrontUrl("ddm"), "https://app.louez.io");
    assert.equal(getStorefrontUrl("ddm", "/"), "https://app.louez.io");
    assert.equal(getStorefrontUrl("ddm", "/checkout"), "https://app.louez.io/checkout");
    assert.equal(getStorefrontUrl("ddm", "/embed"), "https://app.louez.io/embed");
  } finally {
    process.env.LOUEZ_MODE = previousMode;
  }
});
