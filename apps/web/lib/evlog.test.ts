import assert from "node:assert/strict";
import { test } from "node:test";

// The app's logger prints no secret a URL holds, a handoff's or a partner
// space's: a request error on such a URL and an event that names one, as the
// server writes them to stdout and stderr (the console line comes before any
// drain).

const ID = "AbCdEfGhIjKlMnOpQrStU";
const SECRET = "s".repeat(43);
const STATE = "t".repeat(43);

async function captureOutput(run: () => void | Promise<void>): Promise<string> {
  const written: string[] = [];
  const original = { out: process.stdout.write, err: process.stderr.write };
  const capture = (chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  process.stdout.write = capture;
  process.stderr.write = capture;
  try {
    await run();
  } finally {
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
  return written.join("");
}

test("the logger prints no handoff secret, in a request error or an event", async () => {
  const evlog = await import("./evlog");
  evlog.register();
  const returnPath = `/handoffs/return/${ID}/${STATE}`;

  const output = await captureOutput(() => {
    evlog.onRequestError(
      Object.assign(new Error(`Render failed for ${returnPath}`), { digest: "1" }),
      { path: returnPath, method: "GET", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/handoffs/return/[id]/[state]",
        routeType: "route",
        renderSource: "react-server-components",
      },
    );
    evlog.log.error({ handoff: { url: `https://app.louez.test/handoffs/${ID}${SECRET}` } });
  });

  assert.match(output, /Render failed/, "the error is printed");
  assert.ok(output.includes(ID), "the id stays");
  assert.ok(!output.includes(STATE), output);
  assert.ok(!output.includes(SECRET), output);
});

// A partner space's secret: its first character p (`%70` once encoded,
// `%2570` twice), then a run of x the output must never hold.
const TOKEN = `p${"x".repeat(42)}`;
const TAIL = TOKEN.slice(1);
const LEAK = "x".repeat(8);

test("the logger prints no partner space's secret, plain or encoded, in a path or a URL", async () => {
  const evlog = await import("./evlog");
  evlog.register();
  const spacePath = `/partner/${TOKEN}/notifications`;
  const lines = {
    plainPath: `/partner/${TOKEN}/notifications`,
    encodedPath: `/partner/%70${TAIL}/notifications`,
    doubleEncodedPath: `/partner/%2570${TAIL}`,
    plainUrl: `https://app.louez.test/partner/${TOKEN}?from=mail`,
    encodedUrl: `next=https%3A%2F%2Fapp.louez.test%2Fpartner%2F%70${TAIL}%2Fnotifications`,
    doubleEncodedUrl: `next=https%253A%252F%252Fapp.louez.test%252Fpartner%252F%2570${TAIL}`,
  };

  const output = await captureOutput(() => {
    evlog.onRequestError(
      Object.assign(new Error(`Route failed for ${spacePath}`), { digest: "2" }),
      { path: spacePath, method: "POST", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/partner/[token]/notifications",
        routeType: "route",
        renderSource: "react-server-components",
      },
    );
    evlog.log.info({ partner: lines });
  });

  assert.match(output, /Route failed/, "the error is printed");
  assert.ok(!output.includes(LEAK), output);
  for (const kept of [
    "/partner/[redacted]/notifications",
    "https://app.louez.test/partner/[redacted]?from=mail",
    "%2Fpartner%2F[redacted]%2Fnotifications",
    "%252Fpartner%252F[redacted]",
  ]) {
    assert.ok(output.includes(kept), `${kept} in ${output}`);
  }
});

test("the logger leaves other partner pages and links as they are", async () => {
  const evlog = await import("./evlog");
  evlog.register();
  const kept = [
    "/dashboard/visibility/partners/pl_partner_000000001",
    "https://velo.louez.io/?partner=camping-les-pins",
    "/api/storefront/partner-consent",
  ];
  const output = await captureOutput(() => {
    evlog.log.info({ pages: kept });
  });
  for (const text of kept) assert.ok(output.includes(text), `${text} in ${output}`);
  assert.ok(!output.includes("[redacted]"), output);
});
