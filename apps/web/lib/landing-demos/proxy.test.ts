import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";

test("demo requests bypass both dashboard and storefront resolution", async () => {
  for (const host of ["app.louez.io", "shop.louez.io", "localhost:3000"]) {
    const response = await proxy(
      new NextRequest(`https://${host}/demos/landing/rental`, { headers: { host } }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-request-x-louez-public-demo"), "1");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("demo routes reject writes and externally supplied layout markers", async () => {
  const response = await proxy(
    new NextRequest("https://app.louez.io/demos/landing/rental", { method: "POST" }),
  );
  assert.equal(response.status, 405);
  const spoof = await proxy(
    new NextRequest("https://app.louez.io/dashboard", { headers: { "x-louez-public-demo": "1" } }),
  );
  assert.equal(spoof.status, 400);
});
