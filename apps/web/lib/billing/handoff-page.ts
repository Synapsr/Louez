import { createHash } from "node:crypto";

// What `GET /dashboard/billing` sends (louez-billing docs/api, README §10 step 2): a
// standalone HTML page, with no analytics or session replay, that posts the token to
// the service's `/sso` by itself, and a button for when it does not. Its CSP is its
// own, with the inline script and style allowed by hash: the dashboard's CSP has
// `'unsafe-inline'`, which a hash would turn off, so the proxy sends none here.

/**
 * Submits the form, unless the visitor came back to this page with the back button:
 * a fresh token would take them straight to billing again, so they get the buttons.
 */
const SCRIPT =
  'var n=performance.getEntriesByType("navigation")[0];' +
  'if(!n||n.type!=="back_forward")document.getElementById("handoff").submit();';

const STYLE =
  "body{margin:0;min-height:100vh;display:grid;place-items:center;" +
  "font:16px/1.5 system-ui,sans-serif;color:#18181b;background:#fafafa}" +
  "main{max-width:24rem;padding:1.5rem;text-align:center}" +
  "button{font:inherit;padding:.5rem 1rem;border:0;border-radius:.5rem;" +
  "background:#18181b;color:#fff;cursor:pointer}" +
  "a{display:block;margin-top:1rem;color:inherit}" +
  "@media (prefers-color-scheme:dark){body{color:#fafafa;background:#09090b}" +
  "button{background:#fafafa;color:#09090b}}";

const sha256 = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** Nothing loads or runs but the page's own script and style; the form posts only to `/sso`. */
export function handoffPageCsp(billingOrigin: string): string {
  return [
    "default-src 'none'",
    `script-src ${sha256(SCRIPT)}`,
    `style-src ${sha256(STYLE)}`,
    `form-action ${billingOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** For every other answer of the route: nothing to load, nothing to frame. */
const BARE_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Never cached, never framed. `strict-origin-when-cross-origin` keeps the `Origin` of
 * the form post, which `/sso` requires: `no-referrer` would send `Origin: null`.
 */
function handoffHeaders(csp: string, contentType: string | null): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": csp,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export type HandoffPageTexts = {
  /** The page language, `lang` of the document. */
  readonly lang: string;
  readonly title: string;
  readonly message: string;
  readonly continueLabel: string;
  readonly backLabel: string;
  readonly unavailable: string;
};

/** What the route answers; `answerBillingHandoff` decides it. */
export type BillingHandoffAnswer =
  | { readonly kind: "not_found" }
  | { readonly kind: "redirect"; readonly to: string }
  /** The configuration or the ids do not allow a token: the error is logged. */
  | { readonly kind: "unavailable"; readonly backHref: string }
  | {
      readonly kind: "page";
      /** The billing pages' origin, the only `form-action`. */
      readonly billingOrigin: string;
      readonly token: string;
      readonly backHref: string;
    };

function document(texts: HandoffPageTexts, body: string): string {
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(texts.lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(texts.title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    `<body><main>${body}</main></body>`,
    "</html>",
  ].join("\n");
}

/** The page that posts `token` to `{billingOrigin}/sso`, in one field named `token`. */
export function renderHandoffPage(
  answer: { readonly billingOrigin: string; readonly token: string; readonly backHref: string },
  texts: HandoffPageTexts,
): string {
  const action = `${answer.billingOrigin}/sso`;
  return document(
    texts,
    [
      `<form id="handoff" method="post" action="${escapeHtml(action)}">`,
      `<input type="hidden" name="token" value="${escapeHtml(answer.token)}">`,
      `<p>${escapeHtml(texts.message)}</p>`,
      `<button type="submit">${escapeHtml(texts.continueLabel)}</button>`,
      "</form>",
      `<a href="${escapeHtml(answer.backHref)}">${escapeHtml(texts.backLabel)}</a>`,
      `<script>${SCRIPT}</script>`,
    ].join(""),
  );
}

/** The response of `GET /dashboard/billing` for `answer`. */
export function handoffResponse(answer: BillingHandoffAnswer, texts: HandoffPageTexts): Response {
  switch (answer.kind) {
    case "not_found":
      return new Response("Not Found", {
        status: 404,
        headers: handoffHeaders(BARE_CSP, "text/plain; charset=utf-8"),
      });
    case "redirect": {
      const headers = handoffHeaders(BARE_CSP, null);
      headers.set("Location", answer.to);
      return new Response(null, { status: 307, headers });
    }
    case "unavailable":
      return new Response(
        document(
          texts,
          `<p>${escapeHtml(texts.unavailable)}</p><a href="${escapeHtml(answer.backHref)}">${escapeHtml(texts.backLabel)}</a>`,
        ),
        {
          status: 503,
          headers: handoffHeaders(handoffPageCsp("'none'"), "text/html; charset=utf-8"),
        },
      );
    case "page":
      return new Response(renderHandoffPage(answer, texts), {
        status: 200,
        headers: handoffHeaders(handoffPageCsp(answer.billingOrigin), "text/html; charset=utf-8"),
      });
  }
}
