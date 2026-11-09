import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/fr.json";

import { ConnectAgentAssistant } from "./connect-agent-assistant";
import { ConnectAgentDevelopers } from "./connect-agent-developers";
import { ConnectAgentGuide } from "./connect-agent-guide";
import { ASSISTANTS, type AssistantKey } from "./util.assistants";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The connect guide, as the dialog shows it, in two steps: pick the assistant,
// then that assistant's steps alone. The technical details stay folded away.
// Without a DOM, clicks can't run here: each step is rendered as the guide
// shows it, the first by the guide itself, the second by its component.

const MCP_URL = "https://app.louez.test/api/mcp";

const withIntl = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

const renderGuide = (oauthAvailable = true) =>
  withIntl(<ConnectAgentGuide mcpUrl={MCP_URL} oauthAvailable={oauthAvailable} variant="dialog" />);

/** The second step, as the guide shows it once the user chose `key`. */
const renderStep = (key: AssistantKey) => {
  const assistant = ASSISTANTS.find((candidate) => candidate.key === key);
  assert.ok(assistant, `no assistant ${key}`);
  return withIntl(
    <ConnectAgentAssistant assistant={assistant} mcpUrl={MCP_URL} onBack={() => {}} />,
  );
};

test("the first step offers the four assistants, one button each, and nothing else", () => {
  const html = renderGuide();
  assert.match(html, />Quel assistant utilisez-vous \?</);
  for (const [key, name] of [
    ["claude", "Claude"],
    ["chatgpt", "ChatGPT"],
    ["grok", "Grok"],
    ["mistral", "Mistral Vibe"],
  ]) {
    assert.match(html, new RegExp(`<button [^>]*data-assistant="${key}"[^>]*>.*?${name}</span>`));
  }
  assert.doesNotMatch(html, /<ol/);
  assert.doesNotMatch(html, /Ajouter à Claude/);
  assert.doesNotMatch(html, new RegExp(`>${MCP_URL}</code>`));
  assert.doesNotMatch(html, /Ensuite, Louez vous demandera/);
});

test("the first step keeps the logos out of the buttons' names", () => {
  const tiles = renderGuide().match(/<button [^>]*data-assistant=.*?<\/button>/g);
  assert.ok(tiles);
  assert.equal(tiles.length, 4);
  for (const tile of tiles) assert.match(tile, /<svg [^>]*aria-hidden="true"/);
});

test("the plain copy holds no jargon until the developer section opens", () => {
  const html = renderGuide();
  assert.match(html, /aria-expanded="false"[^>]*>Pour les développeurs/);
  assert.doesNotMatch(html, /MCP|OAuth|Bearer|claude mcp add/);
});

test("choosing Claude shows the button that opens Claude with Louez filled in, in a new tab", () => {
  const html = renderStep("claude");
  const link = /<a [^>]*>(?:<[^>]*>)*Ajouter à Claude.*?<\/a>/.exec(html)?.[0];
  assert.ok(link, "no Add to Claude link");
  assert.match(
    link,
    /href="https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&amp;connectorName=Louez&amp;connectorUrl=https%3A%2F%2Fapp\.louez\.test%2Fapi%2Fmcp"/,
  );
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  // Claude takes the address from the link: no field to copy it from.
  assert.doesNotMatch(html, new RegExp(`>${MCP_URL}</code>`));
  assert.equal(html.match(/<li>/g)?.length, 3);
  assert.match(html, /Sur un compte Claude Team ou Enterprise/);
  assert.match(html, /Ensuite, Louez vous demandera/);
});

test("choosing ChatGPT shows the address to copy, then its steps with their link", () => {
  const html = renderStep("chatgpt");
  assert.match(html, />Adresse de connexion</);
  assert.equal(html.split(`>${MCP_URL}</code>`).length - 1, 1);
  assert.match(html, />Copier</);
  assert.match(html, /href="https:\/\/chatgpt\.com\/plugins"/);
  assert.doesNotMatch(html, /Ajouter à/);
  assert.ok(html.indexOf(MCP_URL) < html.indexOf("<ol"), "the address comes before the steps");
});

test("the second step names the chosen assistant and offers to go back to the first", () => {
  for (const { key, name } of ASSISTANTS) {
    const html = renderStep(key);
    assert.match(html, new RegExp(`<h3 tabindex="-1"[^>]*>${name}</h3>`));
    assert.match(html, /<button [^>]*>.*?Changer d’assistant/);
    assert.doesNotMatch(html, /Pour les développeurs/);
  }
});

test("without OAuth, the guide says so, skips the choice and opens the developer section", () => {
  const html = renderGuide(false);
  assert.match(html, /HTTPS/);
  assert.doesNotMatch(html, /data-assistant=/);
  assert.doesNotMatch(html, /Quel assistant utilisez-vous/);
  assert.equal(html.split(`>${MCP_URL}</code>`).length - 1, 1);
  assert.match(html, /aria-expanded="true"[^>]*>Pour les développeurs/);
  assert.match(html, /Authorization: Bearer/);
});

test("the developer section holds the address's technical name, API keys and code tools", () => {
  const html = withIntl(<ConnectAgentDevelopers mcpUrl={MCP_URL} oauthAvailable defaultOpen />);
  assert.match(html, /serveur MCP/);
  assert.match(html, /href="\/dashboard\/settings\/integrations\/mcp#api-keys"/);
  assert.match(html, /claude mcp add --transport http louez https:\/\/app\.louez\.test\/api\/mcp/);
  assert.match(html, /href="cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
  assert.match(html, /href="vscode:mcp\/install\?/);
});
