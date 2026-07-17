import assert from "node:assert/strict";
import { test } from "node:test";

import { detectCountryFromRequestHeaders } from "./util.request-country-detection";

test("detects the country from Cloudflare headers", () => {
  const headers = new Headers({ "cf-ipcountry": "be" });

  assert.deepEqual(detectCountryFromRequestHeaders(headers), {
    country: "BE",
    source: "cf-ipcountry",
  });
});

test("falls through invalid values to another supported geo header", () => {
  const headers = new Headers({
    "cf-ipcountry": "XX",
    "x-vercel-ip-country": "DE",
  });

  assert.deepEqual(detectCountryFromRequestHeaders(headers), {
    country: "DE",
    source: "x-vercel-ip-country",
  });
});

test("supports CloudFront country headers", () => {
  const headers = new Headers({ "cloudfront-viewer-country": "CA" });

  assert.deepEqual(detectCountryFromRequestHeaders(headers), {
    country: "CA",
    source: "cloudfront-viewer-country",
  });
});

test("ignores missing and unsupported countries", () => {
  assert.equal(detectCountryFromRequestHeaders(new Headers({ "cf-ipcountry": "XX" })), null);
});
