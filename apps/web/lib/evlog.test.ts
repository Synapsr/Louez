import assert from "node:assert/strict";
import { test } from "node:test";

// The app's logger prints no handoff secret: a request error on a return URL
// and an event that names a link, as the server writes them to stdout and
// stderr (the console line comes before any drain).

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
