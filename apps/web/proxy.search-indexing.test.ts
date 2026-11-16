import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

// A platform instance: the dashboard and one storefront per subdomain.
process.env.LOUEZ_MODE = "platform";
process.env.NEXT_PUBLIC_APP_URL = "https://app.louez.io";
process.env.NEXT_PUBLIC_APP_DOMAIN = "louez.io";

const hosts = ["shop.louez.io", "app.louez.io", "louez.io"];

afterEach(() => {
  delete process.env.LOUEZ_SEARCH_INDEXING;
});

test("without the switch, storefront, dashboard and apex answers carry no robots header", async () => {
  for (const host of hosts) {
    const response = await proxy(new NextRequest(`https://${host}/`, { headers: { host } }));
    assert.equal(response.headers.get("x-robots-tag"), null, host);
  }
});

test("with LOUEZ_SEARCH_INDEXING=off, every answer says noindex, nofollow", async () => {
  process.env.LOUEZ_SEARCH_INDEXING = "off";
  for (const host of hosts) {
    for (const path of ["/", "/catalog", "/product/tent", "/dashboard", "/robots.txt"]) {
      const response = await proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", `${host}${path}`);
    }
  }
});
