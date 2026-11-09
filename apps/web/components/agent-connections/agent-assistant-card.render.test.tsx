import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/fr.json";

import { AgentAssistantCard } from "./agent-assistant-card";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The assistant strip: the assistants' marks, one line with a "?" that says
// more, and the button that opens the connect guide. Closable only where the
// caller says what closing means (the dashboard home).

const render = (onDismiss?: () => void) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <AgentAssistantCard
        mcpUrl="https://app.louez.test/api/mcp"
        oauthAvailable
        onDismiss={onDismiss}
      />
    </NextIntlClientProvider>,
  );

test("the strip names each assistant by its mark", () => {
  const html = render();
  for (const name of ["Claude", "ChatGPT", "Grok", "Le Chat"]) {
    assert.match(html, new RegExp(`role="img" aria-label="${name}"`));
  }
});

test('the strip holds one line, its "?" and the connect button', () => {
  const html = render();
  assert.match(html, /Laissez votre assistant IA configurer votre boutique\./);
  assert.match(html, /aria-label="En savoir plus"/);
  assert.match(html, />Connecter</);
  // The explanation waits in the popover until the "?" is opened.
  assert.doesNotMatch(html, /Vous choisissez ses droits/);
});

test("a close button only when the caller can close it", () => {
  assert.doesNotMatch(render(), /aria-label="Masquer"/);
  assert.match(
    render(() => {}),
    /aria-label="Masquer"/,
  );
});
