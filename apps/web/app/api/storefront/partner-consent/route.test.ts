import assert from "node:assert/strict";
import { before, describe, mock, test } from "node:test";

import { NextRequest } from "next/server";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

closeNetworkForSuite();

// The partner lookup without a database: one active partner in one store.
mock.module("@louez/api/services/partners", {
  namedExports: {
    findActivePartnerByCode: async (storeId: string, code: string) =>
      storeId === "store_a" && code === "camping-les-pins"
        ? { id: "partner_1", name: "Camping Les Pins" }
        : null,
  },
});

let POST: typeof import("./route").POST;

before(async () => {
  ({ POST } = await import("./route"));
});

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("https://velo-evasion.louez.test/api/storefront/partner-consent", {
    method: "POST",
    headers: {
      host: "velo-evasion.louez.test",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("partner consent", () => {
  test("a yes on the storefront sets the httpOnly partner cookie for 30 days", async () => {
    const response = await POST(request({ storeId: "store_a", code: "Camping-Les-Pins" }));
    assert.equal(response.status, 200);
    const cookie = response.cookies.get("louez_partner");
    assert.equal(cookie?.value, "store_a.camping-les-pins");
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.secure, true);
    assert.equal(cookie?.maxAge, 30 * 24 * 60 * 60);
  });

  test("another site, or a form, cannot set it", async () => {
    const crossSite = await POST(
      request({ storeId: "store_a", code: "camping-les-pins" }, { "sec-fetch-site": "cross-site" }),
    );
    const form = await POST(
      request("storeId=store_a&code=camping-les-pins", {
        "content-type": "application/x-www-form-urlencoded",
      }),
    );
    for (const response of [crossSite, form]) {
      assert.equal(response.status, 403);
      assert.equal(response.cookies.get("louez_partner"), undefined);
    }
  });

  test("an unknown or malformed code stores nothing", async () => {
    const unknown = await POST(request({ storeId: "store_a", code: "nobody" }));
    const otherStore = await POST(request({ storeId: "store_b", code: "camping-les-pins" }));
    const malformed = await POST(request({ storeId: "store_a", code: "<b>" }));
    assert.deepEqual([unknown.status, otherStore.status, malformed.status], [404, 404, 400]);
    for (const response of [unknown, otherStore, malformed]) {
      assert.equal(response.cookies.get("louez_partner"), undefined);
    }
  });
});
