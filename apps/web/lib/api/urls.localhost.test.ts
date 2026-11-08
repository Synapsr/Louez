import assert from "node:assert/strict";
import test from "node:test";

import { productLinks } from "@louez/api/platform/links";

// A local platform deployment: subdomains do not resolve on localhost, so the
// storefront is served under `/<slug>` on the app's own origin.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.NEXT_PUBLIC_APP_DOMAIN = "localhost:3000";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.LOUEZ_MODE = "platform";

test("localhost: the storefront is path-routed under the store's slug", async () => {
  const { apiUrls } = await import("./urls");
  assert.deepEqual(
    productLinks(
      apiUrls,
      { slug: "ddm", onboardingCompleted: true },
      {
        id: "p1",
        slug: "kayak",
        status: "active",
      },
    ),
    {
      dashboard: "http://localhost:3000/dashboard/products/p1",
      storefront: "http://localhost:3000/ddm/product/kayak",
    },
  );
});
