import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, describe, test } from "node:test";

// web-push cannot be aborted once started: an outbox sender out of time must
// not start one, since its row may already be a retry's.

const directory = mkdtempSync(join(tmpdir(), "louez-push-client-"));
const webPushPath = join(directory, "web-push.cjs");
const envPath = join(directory, "env.cjs");
writeFileSync(
  webPushPath,
  [
    "module.exports = {",
    "  setVapidDetails: () => {},",
    "  sendNotification: async (target, body, options) => {",
    "    globalThis.__louezPushes.push(options);",
    "  },",
    "};",
  ].join("\n"),
);
writeFileSync(
  envPath,
  "module.exports = { env: { VAPID_PRIVATE_KEY: 'private', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_SUBJECT: 'mailto:fx@fx.test' } };",
);
after(() => rmSync(directory, { recursive: true }));

const pushes: unknown[] = [];
Reflect.set(globalThis, "__louezPushes", pushes);

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const fromClient = (context.parentURL ?? "").includes("push/client.ts");
    if (fromClient && specifier === "web-push") {
      return { url: pathToFileURL(webPushPath).href, shortCircuit: true };
    }
    if (fromClient && specifier === "@/env") {
      return { url: pathToFileURL(envPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

describe("web push inside an outbox sender", () => {
  let client: typeof import("./client");
  let signals: typeof import("../api/effect-signal");

  before(async () => {
    client = await import("./client");
    signals = await import("../api/effect-signal");
  });

  afterEach(() => {
    pushes.length = 0;
  });

  const target = { endpoint: "https://push.example.test/1", keys: { p256dh: "p", auth: "a" } };
  const payload = { title: "Confirmed", body: "R-1" };

  test("an aborted sender never starts a push", async () => {
    const controller = new AbortController();
    controller.abort(new Error("sender timed out"));
    await assert.rejects(
      signals.withEffectSignal({ signal: controller.signal }, () =>
        client.sendPush(target, payload),
      ),
      /sender timed out/,
    );
    assert.deepEqual(pushes, []);
  });

  test("a sender out of time before its timer fired never starts a push", async () => {
    const controller = new AbortController();
    const throwIfAborted = () => {
      throw new Error("past the deadline");
    };
    await assert.rejects(
      signals.withEffectSignal({ signal: controller.signal, throwIfAborted }, () =>
        client.sendPush(target, payload),
      ),
      /past the deadline/,
    );
    assert.deepEqual(pushes, []);
  });

  test("a live sender pushes, within its own timeout", async () => {
    const controller = new AbortController();
    const result = await signals.withEffectSignal({ signal: controller.signal }, () =>
      client.sendPush(target, payload),
    );
    assert.deepEqual(result, { success: true });
    assert.deepEqual(pushes, [{ TTL: 43_200, timeout: signals.PROVIDER_TIMEOUT_MS }]);
  });

  test("outside a sender, the push goes as before", async () => {
    assert.deepEqual(await client.sendPush(target, payload), { success: true });
    assert.deepEqual(pushes, [{ TTL: 43_200 }]);
  });
});
