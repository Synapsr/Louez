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
    { clientId: CHATGPT_CLIENT_ID, name: null, redirectUris: [] },
    { clientId: "dcr_1", name: "ChatGPT", redirectUris: [] },
    { clientId: "dcr_2", name: "OpenAI Codex", redirectUris: [] },
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
    {
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      name: "Claude",
      redirectUris: [],
    },
    { clientId: "https://cursor.com/oauth/client.json", name: "Cursor", redirectUris: [] },
    { clientId: "dcr_3", name: "Codexpert", redirectUris: [] },
    { clientId: "dcr_4", name: null, redirectUris: [] },
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
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", name: null, redirectUris: [] },
    { clientId: "https://claude.com/oauth/client.json", name: "Something", redirectUris: [] },
    { clientId: "dcr_1", name: "Claude", redirectUris: [] },
    { clientId: "dcr_2", name: "Claude Code", redirectUris: [] },
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
    { clientId: "https://cursor.com/oauth/client.json", name: "Cursor", redirectUris: [] },
    { clientId: "https://claude.ai.evil.test/client.json", name: null, redirectUris: [] },
    { clientId: "dcr_3", name: "Claudette", redirectUris: [] },
    { clientId: "dcr_4", name: null, redirectUris: [] },
  ]) {
    assert.equal(isAnthropicClient(client), false, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client).capabilities, [], JSON.stringify(client));
  }
  assert.equal(
    isAnthropicClient({ clientId: CHATGPT_CLIENT_ID, name: "ChatGPT", redirectUris: [] }),
    false,
  );
});

test("a name copying both directories gets both rules, each procedure once", () => {
  assert.deepEqual(
    clientWithholding({ clientId: "dcr_5", name: "ChatGPT for Claude", redirectUris: [] }),
    {
      domains: ["billing", "stores"],
      bundles: ["billing"],
      capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
      purchases: true,
    },
  );
  assert.deepEqual(clientWithholding({ clientId: "dcr_6", name: "Cursor", redirectUris: [] }), {
    domains: [],
    bundles: [],
    capabilities: [],
    purchases: false,
  });
});

test("a client whose every redirect URI is on one vendor's domains gets that vendor's rules, whatever its name", () => {
  const openAi = {
    domains: ["billing", "stores"],
    bundles: ["billing"],
    capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
    purchases: true,
  };
  const anthropic = {
    domains: [],
    bundles: [],
    capabilities: ["products.enhanceImage"],
    purchases: false,
  };
  const none = { domains: [], bundles: [], capabilities: [], purchases: false };

  for (const redirectUris of [
    ["https://chatgpt.com/connector/oauth/abc"],
    ["https://chatgpt.com/connector_platform_oauth_redirect", "https://platform.openai.com/cb"],
  ]) {
    const client = { clientId: "dcr_evil", name: "Evil", redirectUris };
    assert.equal(isOpenAiClient(client), true, JSON.stringify(redirectUris));
    assert.equal(isAnthropicClient(client), false, JSON.stringify(redirectUris));
    assert.deepEqual(clientWithholding(client), openAi, JSON.stringify(redirectUris));
  }
  for (const redirectUris of [
    ["https://claude.ai/api/mcp/auth_callback"],
    ["https://claude.com/api/mcp/auth_callback"],
  ]) {
    const client = { clientId: "dcr_evil", name: "Evil", redirectUris };
    assert.equal(isAnthropicClient(client), true, JSON.stringify(redirectUris));
    assert.equal(isOpenAiClient(client), false, JSON.stringify(redirectUris));
    assert.deepEqual(clientWithholding(client), anthropic, JSON.stringify(redirectUris));
  }
  // Mixed, loopback, look-alike, another vendor: nothing from the redirects.
  for (const redirectUris of [
    ["https://chatgpt.com/connector/oauth/abc", "http://127.0.0.1:8787/callback"],
    ["https://claude.ai/api/mcp/auth_callback", "https://evil.test/cb"],
    ["https://chatgpt.com/connector/oauth/abc", "https://claude.ai/api/mcp/auth_callback"],
    ["http://localhost/callback"],
    ["https://chatgpt.com.evil.test/cb"],
    ["https://claude.ai.evil.test/cb"],
    ["https://www.cursor.com/bot/mcp/oauth/callback"],
    [],
  ]) {
    const client = { clientId: "dcr_evil", name: "Evil", redirectUris };
    assert.equal(isOpenAiClient(client), false, JSON.stringify(redirectUris));
    assert.equal(isAnthropicClient(client), false, JSON.stringify(redirectUris));
    assert.deepEqual(clientWithholding(client), none, JSON.stringify(redirectUris));
  }
  // The id and name matches stand beside it.
  assert.deepEqual(
    clientWithholding({
      clientId: "dcr_named",
      name: "ChatGPT",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    }),
    {
      domains: ["billing", "stores"],
      bundles: ["billing"],
      capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
      purchases: true,
    },
  );
});
