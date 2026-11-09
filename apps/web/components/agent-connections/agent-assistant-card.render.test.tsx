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

/** The whole `<svg>` of one assistant's mark, as the strip renders it. */
const markOf = (html: string, name: string) => {
  const mark = new RegExp(`<svg[^>]*aria-label="${name}"[^>]*>.*?</svg>`).exec(html)?.[0];
  assert.ok(mark, `no mark for ${name}`);
  return mark;
};

test("Claude and Le Chat keep their brand colors in the strip, on their paths", () => {
  const html = render(() => {});
  const claude = markOf(html, "Claude");
  assert.match(claude, /<path [^>]*fill="#D97757"/);
  assert.doesNotMatch(claude, /currentColor/i);

  const leChat = markOf(html, "Le Chat");
  const fills = [...leChat.matchAll(/<path [^>]*fill="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(fills, ["#FFD700", "#FFAF00", "#FF8205", "#FA500F", "#E10500"]);
  assert.doesNotMatch(leChat, /currentColor/i);
});

test("ChatGPT and Grok follow the text color, as their brands ask", () => {
  const html = render();
  for (const name of ["ChatGPT", "Grok"]) {
    assert.match(markOf(html, name), /<svg [^>]*fill="currentColor"/);
  }
});
