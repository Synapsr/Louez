import assert from "node:assert/strict";
import { test } from "node:test";

import { CHATGPT_CLIENT_ID, clientWithholding, isOpenAiClient } from "./agent-clients";

test("OpenAI's clients are told apart by their metadata document or their name", () => {
  for (const client of [
    { clientId: CHATGPT_CLIENT_ID, name: null },
    { clientId: "dcr_1", name: "ChatGPT" },
    { clientId: "dcr_2", name: "OpenAI Codex" },
  ]) {
    assert.equal(isOpenAiClient(client), true, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client), { domains: ["billing"], bundles: ["billing"] });
  }
  for (const client of [
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", name: "Claude" },
    { clientId: "https://cursor.com/oauth/client.json", name: "Cursor" },
    { clientId: "dcr_3", name: "Codexpert" },
    { clientId: "dcr_4", name: null },
  ]) {
    assert.equal(isOpenAiClient(client), false, JSON.stringify(client));
    assert.deepEqual(clientWithholding(client), { domains: [], bundles: [] });
  }
});
