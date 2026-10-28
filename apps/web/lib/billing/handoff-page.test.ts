import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { handoffPageCsp, handoffResponse } from "./handoff-page";

// The page that posts the hand-off token (louez-billing docs/api, README §10 step 2):
// standalone, never cached, never framed, with a referrer policy that keeps `Origin`,
// a CSP of its own, and no analytics or session replay.

const TEXTS = {
  lang: "fr",
  title: "Ouverture de la facturation…",
  message: "Nous vous emmenons vers vos pages de facturation.",
  continueLabel: "Continuer",
  backLabel: "Retour à Louez",
  unavailable: "La facturation ne peut pas s'ouvrir pour le moment.",
};
const BILLING = "https://billing.billing.test";
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJvd25lcjEifQ.c2lnbmF0dXJl";

const page = () =>
  handoffResponse(
    { kind: "page", billingOrigin: BILLING, token: TOKEN, backHref: "/dashboard/settings/billing" },
    TEXTS,
  );

const hashes = (csp: string, directive: string) =>
  (csp.split("; ").find((part) => part.startsWith(`${directive} `)) ?? "").split(" ").slice(1);

const sha256 = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

describe("the hand-off page", () => {
  test("posts one field, the token, to the service's /sso", async () => {
    const response = page();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    const html = await response.text();
    assert.match(
      html,
      /<form id="handoff" method="post" action="https:\/\/billing\.billing\.test\/sso">/,
    );
    assert.equal(html.match(/<input /g)?.length, 1);
    assert.match(html, new RegExp(`<input type="hidden" name="token" value="${TOKEN}">`));
    assert.match(html, /<button type="submit">Continuer<\/button>/, "the no-script fallback");
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /<a href="\/dashboard\/settings\/billing">Retour à Louez<\/a>/);
  });

  test("is never cached, never framed, and keeps the Origin of the post", () => {
    const { headers } = page();
    assert.equal(headers.get("Cache-Control"), "no-store");
    assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(headers.get("X-Frame-Options"), "DENY");
    assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  });

  test("allows its own inline script and style by hash, and posts only to the billing origin", async () => {
    const response = page();
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    assert.equal(csp, handoffPageCsp(BILLING));
    assert.match(csp, /^default-src 'none'; /);
    assert.match(csp, /form-action https:\/\/billing\.billing\.test;/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|'self'/);

    const html = await response.text();
    const scripts = [...html.matchAll(/<script>([^<]*)<\/script>/g)].map((match) => match[1] ?? "");
    const styles = [...html.matchAll(/<style>([^<]*)<\/style>/g)].map((match) => match[1] ?? "");
    assert.equal(scripts.length, 1);
    assert.equal(styles.length, 1);
    assert.deepEqual(hashes(csp, "script-src"), scripts.map(sha256));
    assert.deepEqual(hashes(csp, "style-src"), styles.map(sha256));
    assert.match(scripts[0] ?? "", /getElementById\("handoff"\)\.submit\(\)/);
    assert.match(scripts[0] ?? "", /back_forward/, "no second hand-off from the back button");
  });

  test("loads nothing else: no analytics, no session replay, no external script", async () => {
    const html = await page().text();
    assert.doesNotMatch(html, /posthog|openreplay|gleap|<script src|<link /i);
    assert.equal(html.match(/https?:\/\//g)?.length, 1, "only the form action is absolute");
  });

  test("escapes what it prints", async () => {
    const html = await handoffResponse(
      {
        kind: "page",
        billingOrigin: BILLING,
        token: TOKEN,
        backHref: "/dashboard/settings/billing",
      },
      { ...TEXTS, message: `<img src=x onerror="alert(1)">` },
    ).text();
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });
});

describe("the other answers of the route", () => {
  test("a redirect and a 404 carry the same strict headers and no token", async () => {
    const redirect = handoffResponse({ kind: "redirect", to: "/login?callbackUrl=x" }, TEXTS);
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("Location"), "/login?callbackUrl=x");
    const notFound = handoffResponse({ kind: "not_found" }, TEXTS);
    assert.equal(notFound.status, 404);
    for (const response of [redirect, notFound]) {
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("X-Frame-Options"), "DENY");
      assert.match(response.headers.get("Content-Security-Policy") ?? "", /^default-src 'none'/);
    }
  });

  test("unavailable says so, with a way back and nothing to post", async () => {
    const response = handoffResponse(
      { kind: "unavailable", backHref: "/dashboard/settings/billing" },
      TEXTS,
    );
    assert.equal(response.status, 503);
    assert.match(response.headers.get("Content-Security-Policy") ?? "", /form-action 'none'/);
    const html = await response.text();
    assert.match(html, /La facturation ne peut pas s&#39;ouvrir pour le moment\./);
    assert.doesNotMatch(html, /<form|<script/);
  });
});
