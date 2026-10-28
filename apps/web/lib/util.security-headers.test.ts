import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEmbedSecurityHeaders, buildSecurityHeaders } from "./util.security-headers";

test("adds runtime deployment origins to the CSP", () => {
  const headers = buildSecurityHeaders({
    appDomain: "runtime.example.com",
    fromHelloApiUrl: "https://engagement.runtime.example.com/api",
    isDevelopment: false,
    openReplayIngestPoint: "https://replay.runtime.example.com/ingest",
  });
  const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value;

  assert.match(csp ?? "", /script-src[^;]*https:\/\/engagement\.runtime\.example\.com/);
  assert.match(csp ?? "", /connect-src[^;]*https:\/\/replay\.runtime\.example\.com/);
  assert.match(csp ?? "", /frame-src[^;]*https:\/\/\*\.runtime\.example\.com/);
});

test("allows OpenFreeMap assets without the retired CARTO and Leaflet origins", () => {
  const headers = buildSecurityHeaders({
    isDevelopment: false,
  });
  const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";

  assert.match(csp, /img-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  assert.match(csp, /connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  assert.doesNotMatch(csp, /cartocdn|unpkg\.com/);
});

test("embed headers allow framing without emitting X-Frame-Options", () => {
  const headers = buildEmbedSecurityHeaders({
    appDomain: "runtime.example.com",
    isDevelopment: false,
  });
  const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value;

  assert.equal(
    headers.some((header) => header.key === "X-Frame-Options"),
    false,
  );
  assert.match(csp ?? "", /frame-ancestors \*/);
});

test("the billing pages' origin joins form-action only when given (service mode)", () => {
  const csp = (billingOrigin?: string) =>
    buildSecurityHeaders({ billingOrigin, isDevelopment: false }).find(
      (header) => header.key === "Content-Security-Policy",
    )?.value ?? "";

  assert.match(
    csp("https://billing.example.com/api/v1/louez"),
    /form-action 'self' https:\/\/billing\.example\.com;/,
  );
  assert.match(csp(), /form-action 'self';/);
  assert.match(csp("not a url"), /form-action 'self';/);
});
