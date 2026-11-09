import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/fr.json";

import { ConnectAgentDevelopers } from "./connect-agent-developers";
import { ConnectAgentGuide } from "./connect-agent-guide";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The connect guide, as the dialog shows it: one action per assistant, the
// address once, and the technical details folded away.

const MCP_URL = "https://app.louez.test/api/mcp";

const render = (oauthAvailable = true) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <ConnectAgentGuide mcpUrl={MCP_URL} oauthAvailable={oauthAvailable} variant="dialog" />
    </NextIntlClientProvider>,
  );

/** The markup of one assistant's card. */
const cardOf = (html: string, assistant: string) => {
  const card = new RegExp(
    `<li [^>]*data-assistant="${assistant}".*?</ol><p[^>]*>[^<]*</p></li>`,
  ).exec(html)?.[0];
  assert.ok(card, `no card for ${assistant}`);
  return card;
};

test("each assistant gets one card with one action", () => {
  const html = render();
  for (const assistant of ["claude", "chatgpt", "grok", "mistral"]) {
    const card = cardOf(html, assistant);
    assert.equal(card.match(/data-slot="button"/g)?.length, 1, `${assistant} has one action`);
  }
});

test("Claude's action opens Claude with Louez filled in, in a new tab", () => {
  const card = cardOf(render(), "claude");
  assert.match(card, />Ajouter à Claude</);
  assert.match(card, /href="https:\/\/claude\.ai\/customize\/connectors\?[^"]*connectorName=Louez/);
  assert.match(card, /target="_blank"/);
});

test("the assistants without a link copy the address", () => {
  const html = render();
  for (const assistant of ["chatgpt", "grok", "mistral"]) {
    assert.match(cardOf(html, assistant), />Copier l’adresse</);
  }
});

test("the address shows once, under its plain name", () => {
  const html = render();
  assert.match(html, />Adresse de connexion</);
  assert.equal(html.split(`>${MCP_URL}</code>`).length - 1, 1);
});

test("the plain copy holds no jargon until the developer section opens", () => {
  const html = render();
  assert.match(html, /aria-expanded="false"[^>]*>Pour les développeurs/);
  assert.doesNotMatch(html, /MCP|OAuth|Bearer|claude mcp add/);
});

test("without OAuth, the guide says so and opens the developer section", () => {
  const html = render(false);
  assert.doesNotMatch(html, /data-assistant=/);
  assert.match(html, /aria-expanded="true"[^>]*>Pour les développeurs/);
  assert.match(html, /Authorization: Bearer/);
});

test("the developer section holds the address's technical name, API keys and code tools", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <ConnectAgentDevelopers mcpUrl={MCP_URL} oauthAvailable defaultOpen />
    </NextIntlClientProvider>,
  );
  assert.match(html, /serveur MCP/);
  assert.match(html, /href="\/dashboard\/settings\/integrations\/mcp#api-keys"/);
  assert.match(html, /claude mcp add --transport http louez https:\/\/app\.louez\.test\/api\/mcp/);
  assert.match(html, /href="cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/);
  assert.match(html, /href="vscode:mcp\/install\?/);
});
