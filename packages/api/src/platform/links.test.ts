import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentConnectionsLinks,
  categoryLinks,
  customerLinks,
  productLinks,
  reservationLinks,
  storeLinks,
} from "./links";
import { createTestUrls, TEST_APP_URL } from "./test-urls";

const urls = createTestUrls();
const online = { slug: "ddm", onboardingCompleted: true };
const onboarding = { slug: "ddm", onboardingCompleted: false };

test("a store links its dashboard, and its storefront once online", () => {
  assert.deepEqual(storeLinks(urls, online), {
    dashboard: `${TEST_APP_URL}/dashboard`,
    storefront: "https://ddm.louez.test",
  });
  assert.deepEqual(storeLinks(urls, onboarding), { dashboard: `${TEST_APP_URL}/dashboard` });
});

test("an active product links its storefront page by slug, or by id before slugs", () => {
  assert.deepEqual(productLinks(urls, online, { id: "p1", slug: "kayak", status: "active" }), {
    dashboard: `${TEST_APP_URL}/dashboard/products/p1`,
    storefront: "https://ddm.louez.test/product/kayak",
  });
  assert.equal(
    productLinks(urls, online, { id: "p1", slug: null, status: "active" }).storefront,
    "https://ddm.louez.test/product/p1",
  );
});

test("a draft or archived product, a store in onboarding, or a bare reference: dashboard only", () => {
  for (const status of ["draft", "archived", null]) {
    assert.deepEqual(productLinks(urls, online, { id: "p1", slug: "kayak", status }), {
      dashboard: `${TEST_APP_URL}/dashboard/products/p1`,
    });
  }
  assert.equal(
    productLinks(urls, onboarding, { id: "p1", slug: "kayak", status: "active" }).storefront,
    undefined,
  );
  assert.equal(productLinks(urls, online, { id: "p1" }).storefront, undefined);
});

test("a category links the categories page and the catalog filtered on it", () => {
  assert.deepEqual(categoryLinks(urls, online, { id: "c1", slug: "kayaks & co" }), {
    dashboard: `${TEST_APP_URL}/dashboard/categories`,
    storefront: "https://ddm.louez.test/catalog?category=kayaks%20%26%20co",
  });
  assert.equal(categoryLinks(urls, onboarding, { id: "c1", slug: null }).storefront, undefined);
});

test("reservations, customers and agent connections link their dashboard pages, ids encoded", () => {
  assert.deepEqual(reservationLinks(urls, { id: "r/1" }), {
    dashboard: `${TEST_APP_URL}/dashboard/reservations/r%2F1`,
  });
  assert.deepEqual(customerLinks(urls, { id: "c1" }), {
    dashboard: `${TEST_APP_URL}/dashboard/customers/c1`,
  });
  assert.deepEqual(agentConnectionsLinks(urls), {
    dashboard: `${TEST_APP_URL}/dashboard/settings/integrations/mcp`,
  });
});
