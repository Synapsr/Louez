import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, describe, test } from "node:test";

// An outbox sender that timed out while its email was being prepared must not
// start SMTP: the transport cannot be aborted, and the row may already be a
// retry's.

const directory = mkdtempSync(join(tmpdir(), "louez-email-client-"));
const transportPath = join(directory, "email.cjs");
writeFileSync(
  transportPath,
  [
    "module.exports = {",
    "  isEmailConfigured: () => true,",
    "  sendEmail: async (options) => {",
    "    globalThis.__louezSentEmails.push(options.subject);",
    "    return { messageId: 'id' };",
    "  },",
    "};",
  ].join("\n"),
);
after(() => rmSync(directory, { recursive: true }));

const sent: string[] = [];
Reflect.set(globalThis, "__louezSentEmails", sent);

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "@louez/email" && (context.parentURL ?? "").includes("email/client.ts")) {
      return { url: pathToFileURL(transportPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

describe("app email client inside an outbox sender", () => {
  let client: typeof import("./client");
  let signals: typeof import("../api/effect-signal");

  before(async () => {
    client = await import("./client");
    signals = await import("../api/effect-signal");
  });

  afterEach(() => {
    sent.length = 0;
  });

  const options = { to: "customer@example.test", subject: "Accepted", html: "<p>ok</p>" };

  test("an aborted sender never reaches SMTP", async () => {
    const controller = new AbortController();
    controller.abort(new Error("sender timed out"));
    await assert.rejects(
      signals.withEffectSignal(controller.signal, () => client.sendEmail(options)),
      /sender timed out/,
    );
    assert.deepEqual(sent, []);
  });

  test("a live sender sends", async () => {
    const controller = new AbortController();
    await signals.withEffectSignal(controller.signal, () => client.sendEmail(options));
    assert.deepEqual(sent, ["Accepted"]);
  });

  test("outside a sender, the email goes as before", async () => {
    await client.sendEmail(options);
    assert.deepEqual(sent, ["Accepted"]);
  });
});
