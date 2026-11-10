import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHATGPT_CLIENT_ID,
  clientWithholding,
  isAnthropicClient,
  isOpenAiClient,
} from "./agent-clients";

test("OpenAI's clients are told apart by their metadata document or their name, and never reach the paid AI photo tools", () => {
  for (const client of [
    { clientId: CHATGPT_CLIENT_ID, name: null },
    { clientId: "dcr_1", name: "ChatGPT" },
    { clientId: "dcr_2", name: "OpenAI Codex" },
  ]) {
    assert.equal(isOpenAiClient(client), true, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client), {
      domains: ["billing", "stores"],
      bundles: ["billing"],
      capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
      purchases: true,
    });
  }
  for (const client of [
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", name: "Claude" },
    { clientId: "https://cursor.com/oauth/client.json", name: "Cursor" },
    { clientId: "dcr_3", name: "Codexpert" },
    { clientId: "dcr_4", name: null },
  ]) {
    assert.equal(isOpenAiClient(client), false, JSON.stringify(client));
    assert.ok(
      !clientWithholding(client).capabilities.includes("products.removeImageBackground"),
      JSON.stringify(client),
    );
  }
});

test("Anthropic's clients are told apart by their metadata document or their name, and never reach the AI enhancement", () => {
  for (const client of [
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", name: null },
    { clientId: "https://claude.com/oauth/client.json", name: "Something" },
    { clientId: "dcr_1", name: "Claude" },
    { clientId: "dcr_2", name: "Claude Code" },
  ]) {
    assert.equal(isAnthropicClient(client), true, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client), {
      domains: [],
      bundles: [],
      capabilities: ["products.enhanceImage"],
      purchases: false,
    });
  }
  for (const client of [
    { clientId: "https://cursor.com/oauth/client.json", name: "Cursor" },
    { clientId: "https://claude.ai.evil.test/client.json", name: null },
    { clientId: "dcr_3", name: "Claudette" },
    { clientId: "dcr_4", name: null },
  ]) {
    assert.equal(isAnthropicClient(client), false, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client).capabilities, [], JSON.stringify(client));
  }
  assert.equal(isAnthropicClient({ clientId: CHATGPT_CLIENT_ID, name: "ChatGPT" }), false);
});

test("a name copying both directories gets both rules, each procedure once", () => {
  assert.deepEqual(clientWithholding({ clientId: "dcr_5", name: "ChatGPT for Claude" }), {
    domains: ["billing", "stores"],
    bundles: ["billing"],
    capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
    purchases: true,
  });
  assert.deepEqual(clientWithholding({ clientId: "dcr_6", name: "Cursor" }), {
    domains: [],
    bundles: [],
    capabilities: [],
    purchases: false,
  });
});
