import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeCommand,
  claudeConnectorLink,
  cursorInstallLink,
  vscodeInstallLink,
} from "./util.assistant-links";

// An address with characters that must survive encoding: a port, a path, a query.
const MCP_URL = "https://app.louez.test:8443/api/mcp?x=1&y=é";

test("Claude's link opens the custom connector form with Louez's name and address", () => {
  const link = new URL(claudeConnectorLink(MCP_URL));
  assert.equal(link.origin + link.pathname, "https://claude.ai/customize/connectors");
  assert.equal(link.searchParams.get("modal"), "add-custom-connector");
  assert.equal(link.searchParams.get("connectorName"), "Louez");
  assert.equal(link.searchParams.get("connectorUrl"), MCP_URL);
});

test("Claude's link encodes the address, so its query stays inside one parameter", () => {
  const link = claudeConnectorLink(MCP_URL);
  assert.doesNotMatch(link, /[?&]y=/);
  assert.equal([...new URL(link).searchParams.keys()].length, 3);
});

test("Claude Code's command adds Louez over HTTP", () => {
  assert.equal(
    claudeCodeCommand("https://app.louez.test/api/mcp"),
    "claude mcp add --transport http louez https://app.louez.test/api/mcp",
  );
});

test("Cursor's link carries the server's config as base64 JSON", () => {
  const link = new URL(cursorInstallLink(MCP_URL));
  assert.equal(link.protocol, "cursor:");
  assert.equal(link.searchParams.get("name"), "Louez");
  const config = link.searchParams.get("config");
  assert.ok(config);
  assert.deepEqual(JSON.parse(Buffer.from(config, "base64").toString("utf8")), { url: MCP_URL });
});

test("VS Code's link carries the server's config as URL-encoded JSON", () => {
  const link = vscodeInstallLink(MCP_URL);
  const prefix = "vscode:mcp/install?";
  assert.ok(link.startsWith(prefix));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.slice(prefix.length))), {
    name: "Louez",
    type: "http",
    url: MCP_URL,
  });
});
