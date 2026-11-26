import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmbedSecurityHeaders,
  buildHandoffSecurityHeaders,
  buildSecurityHeaders,
  type SecurityHeader,
  type SecurityHeadersOptions,
} from "./util.security-headers";

const contentSecurityPolicy = (options: SecurityHeadersOptions): string =>
  buildSecurityHeaders(options).find((header) => header.key === "Content-Security-Policy")?.value ??
  "";

const cspDirectives = (headers: SecurityHeader[]) =>
  new Map(
    (headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "")
      .split("; ")
      .map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources.join(" ")] as const;
      }),
  );

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

test("allows the Umami origin to serve its script and receive its events, and nothing else", () => {
  const app = cspDirectives(buildSecurityHeaders({ isDevelopment: false }));
  const umami = cspDirectives(
    buildSecurityHeaders({
      isDevelopment: false,
      umamiScriptUrl: "https://stats.example.com/umami/script.js?v=1",
    }),
  );
  const changed = ["script-src", "connect-src"];

  for (const directive of changed) {
    assert.equal(umami.get(directive), `${app.get(directive)} https://stats.example.com`);
  }
  assert.deepEqual(
    [...umami].filter(([name]) => !changed.includes(name)),
    [...app].filter(([name]) => !changed.includes(name)),
  );
});

test("a missing or malformed Umami URL leaves the CSP as it is", () => {
  const base = contentSecurityPolicy({ isDevelopment: false });

  for (const umamiScriptUrl of [
    "",
    "not a url",
    "/umami/script.js",
    "javascript:alert(1)",
    "data:text/javascript,1",
  ]) {
    assert.equal(contentSecurityPolicy({ isDevelopment: false, umamiScriptUrl }), base);
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

test("the embed's policy allows no marketing tracker, and keeps PostHog", () => {
  const options = {
    appDomain: "runtime.example.com",
    fromHelloApiUrl: "https://engagement.runtime.example.com/api",
    isDevelopment: false,
    klibonEnabled: true,
    openReplayIngestPoint: "https://replay.runtime.example.com/ingest",
  };
  const cspOf = (headers: { key: string; value: string }[]) =>
    headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
  const app = cspOf(buildSecurityHeaders(options));
  const embed = cspOf(buildEmbedSecurityHeaders(options));

  for (const tracker of [/engagement\.runtime/, /replay\.runtime/, /klibon/]) {
    assert.match(app, tracker);
    assert.doesNotMatch(embed, tracker);
  }
  assert.match(embed, /script-src[^;]*https:\/\/eu-assets\.i\.posthog\.com/);
  assert.match(embed, /connect-src[^;]*https:\/\/eu\.i\.posthog\.com/);
});

test("the handoff page may send its form to any https provider, and nothing else changes", () => {
  const options = { appDomain: "runtime.example.com", isDevelopment: false };
  const app = cspDirectives(buildSecurityHeaders(options));
  const handoff = cspDirectives(buildHandoffSecurityHeaders(options));

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
