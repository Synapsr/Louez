import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCategorySlugPath,
  buildProductSlugPath,
  parseStorefrontPath,
  toSearchParams,
} from "./util.legacy-storefront-url";

describe("parseStorefrontPath", () => {
  it("recognises a product page and keeps its query", () => {
    const target = parseStorefrontPath("/product/abc123?startDate=2026-10-01&endDate=2026-10-03");
    assert.equal(target?.kind, "product");
    assert.equal(target?.kind === "product" && target.ref, "abc123");
    assert.equal(target?.search.get("endDate"), "2026-10-03");
  });

  it("recognises a category filter of the catalog", () => {
    const target = parseStorefrontPath("/catalog?category=abc123&sort=price_asc");
    assert.equal(target?.kind, "catalog");
    assert.equal(target?.kind === "catalog" && target.categoryToken, "abc123");
  });

  it("ignores the reserved category values and every other page", () => {
    assert.equal(parseStorefrontPath("/catalog?category=all"), null);
    assert.equal(parseStorefrontPath("/catalog"), null);
    assert.equal(parseStorefrontPath("/about"), null);
    assert.equal(parseStorefrontPath("/product/abc/extra"), null);
  });
});

describe("slug paths", () => {
  it("keeps the query on a product redirect", () => {
    assert.equal(
      buildProductSlugPath("velo", new URLSearchParams("startDate=a&endDate=b")),
      "/product/velo?startDate=a&endDate=b",
    );
    assert.equal(buildProductSlugPath("velo", new URLSearchParams()), "/product/velo");
  });

  it("swaps the category token and keeps the other filters", () => {
    assert.equal(
      buildCategorySlugPath(
        { id: "c1", slug: "velos" },
        new URLSearchParams("category=c1&sort=price_asc"),
      ),
      "/catalog?category=velos&sort=price_asc",
    );
  });

  it("flattens Next search params", () => {
    assert.equal(toSearchParams({ a: "1", b: ["2", "3"], c: undefined }).toString(), "a=1&b=2&b=3");
  });
});
