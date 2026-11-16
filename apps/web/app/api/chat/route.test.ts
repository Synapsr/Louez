import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

// The chat endpoint answers only this app's own pages, with the chat's JSON:
// anything else is refused before the session is read, so none of the
// assistant's tools is built. The session and the tools are stand-ins that
// note being reached; no model, no database.

const APP = "https://app.louez.test";
process.env.NEXT_PUBLIC_APP_URL = APP;

const directory = mkdtempSync(join(tmpdir(), "louez-chat-route-"));
const stub = (name: string, source: string) => {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(path, source);
  return pathToFileURL(path).href;
};
const reached = "globalThis.__chatReached ??= []; globalThis.__chatReached";
const STUBS: Record<string, string> = {
  // Signed out: a request the guard lets through ends at the session, with 401.
  "@/lib/auth": stub(
    "auth",
    `export const auth = async () => { ${reached}.push("session"); return null; };`,
  ),
  "@/lib/ai/tools": stub(
    "tools",
    `export const createAITools = () => { ${reached}.push("tools"); return {}; };
export const ASSISTANT_API_DOMAINS = [];`,
  ),
  // What only a request past the session reaches.
  "@/lib/api/ports": stub("ports", "export const apiPorts = { urls: {} };"),
  "@/lib/ai/assistant-api": stub("assistant-api", "export const createAssistantApi = () => ({});"),
  "@/lib/store-context": stub("store-context", "export const getCurrentStore = async () => null;"),
  "@/lib/discord/platform-notifications": stub(
    "notifications",
    "export const notifyAiChatStarted = () => {};",
  ),
  "@/lib/ai/provider": stub(
    "provider",
    "export const getAIModel = () => null; export const isAIChatConfigured = () => true;",
  ),
  "@louez/auth": stub(
    "louez-auth",
    "export const auth = {}; export const mcpOAuth = null; export const authInstance = {};",
  ),
};
after(() => rmSync(directory, { recursive: true }));
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const url = STUBS[specifier];
    if (url) return { url, shortCircuit: true };
    return next(specifier, context);
  },
});

const reachedSoFar = () =>
  ((globalThis as { __chatReached?: string[] }).__chatReached ??= []) as string[];

describe("the chat endpoint", () => {
  let POST: (request: Request) => Promise<Response>;

  before(async () => {
    ({ POST } = await import("./route"));
  });

  beforeEach(() => {
    reachedSoFar().length = 0;
  });

  const post = (headers: Record<string, string>, body = '{"messages":[]}') =>
    POST(
      new Request(`${APP}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      }),
    );

  test("the dashboard's own request goes on to the session", async () => {
    const answer = await post({ origin: APP, "sec-fetch-site": "same-origin" });
    assert.equal(answer.status, 401, "signed out, past the guard");
    assert.deepEqual(reachedSoFar(), ["session"]);
  });

  test("a request from another site, or another origin of the same site, is refused first", async () => {
    const requests: Record<string, string>[] = [
      { origin: "https://elsewhere.test", "sec-fetch-site": "cross-site" },
      { origin: "https://other.louez.test", "sec-fetch-site": "same-site" },
      { origin: "https://elsewhere.test" },
      {},
    ];
    for (const headers of requests) {
      const answer = await post(headers);
      assert.equal(answer.status, 403, JSON.stringify(headers));
      assert.equal(answer.headers.get("cache-control"), "no-store");
    }
    assert.deepEqual(reachedSoFar(), [], "neither the session nor a tool");
  });

  test("a body that is not the chat's JSON is refused first, even from the app", async () => {
    for (const type of ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]) {
      const answer = await post(
        { origin: APP, "sec-fetch-site": "same-origin", "content-type": type },
        "messages=[]",
      );
      assert.equal(answer.status, 403, type);
    }
    assert.deepEqual(reachedSoFar(), []);
  });
});
