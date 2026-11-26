import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmbedSecurityHeaders,
  buildHandoffSecurityHeaders,
  buildSecurityHeaders,
  type SecurityHeadersOptions,
} from "./util.security-headers";

const contentSecurityPolicy = (options: SecurityHeadersOptions): string =>
  buildSecurityHeaders(options).find((header) => header.key === "Content-Security-Policy")?.value ??
  "";

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

test("a runtime URL without an origin adds nothing to the CSP", () => {
  const base = contentSecurityPolicy({ isDevelopment: false });

  for (const url of ["not a url", "javascript:alert(1)", "data:text/javascript,1"]) {
    assert.equal(contentSecurityPolicy({ fromHelloApiUrl: url, isDevelopment: false }), base);
    assert.equal(contentSecurityPolicy({ isDevelopment: false, openReplayIngestPoint: url }), base);
  }
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

test("allows Klibon's tag, ping and signup beacon only when Klibon is on", () => {
  const cspOf = (klibonEnabled: boolean) =>
    buildSecurityHeaders({ isDevelopment: false, klibonEnabled }).find(
      (header) => header.key === "Content-Security-Policy",
    )?.value ?? "";
  const on = cspOf(true);

  for (const directive of ["script-src", "img-src", "connect-src"]) {
    assert.match(on, new RegExp(`${directive}[^;]*https://go\\.klibon\\.com`));
  }
  assert.doesNotMatch(cspOf(false), /klibon/);
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

test("the handoff page may send its form to any https provider, and nothing else changes", () => {
  const options = { appDomain: "runtime.example.com", isDevelopment: false };
  const directives = (headers: { key: string; value: string }[]) =>
    new Map(
      (headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "")
        .split("; ")
        .map((directive) => {
          const [name, ...sources] = directive.split(" ");
          return [name, sources.join(" ")] as const;
        }),
    );
  const app = directives(buildSecurityHeaders(options));
  const handoff = directives(buildHandoffSecurityHeaders(options));

  assert.equal(app.get("form-action"), "'self'");
  assert.equal(handoff.get("form-action"), "'self' https:");
  assert.deepEqual(
    [...handoff].filter(([name]) => name !== "form-action"),
    [...app].filter(([name]) => name !== "form-action"),
  );
  // The other headers are the app's too.
  assert.deepEqual(
    buildHandoffSecurityHeaders(options).filter((h) => h.key !== "Content-Security-Policy"),
    buildSecurityHeaders(options).filter((h) => h.key !== "Content-Security-Policy"),
  );
});
