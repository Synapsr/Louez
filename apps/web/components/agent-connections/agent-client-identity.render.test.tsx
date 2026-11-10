import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/fr.json";

import { AgentClientIdentity } from "./agent-client-identity";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

type Client = Parameters<typeof AgentClientIdentity>[0]["client"];

const render = (client: Client) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <AgentClientIdentity client={client} size="large" />
    </NextIntlClientProvider>,
  );

const registered = {
  declaredBy: null,
  verified: false,
  iconUrl: null,
};
const cursor = { vendor: "cursor" as const, name: "Cursor", domain: "cursor.com" };

test("a client whose codes go to Cursor alone shows Cursor and where the code goes", () => {
  const html = render({ ...registered, name: "Cursor", destination: cursor });
  assert.match(html, />Cursor</);
  assert.match(html, /Vérifié : renvoie vers cursor\.com/);
  assert.doesNotMatch(html, /Nom non vérifié/);
  assert.doesNotMatch(html, /enregistrée dynamiquement/);
  // Same name as the vendor: not repeated.
  assert.doesNotMatch(html, /Nom déclaré/);
});

test("another declared name follows in small text, attributed, never as the title", () => {
  const html = render({ ...registered, name: "Evil", destination: cursor });
  assert.match(html, /<p class="text-lg font-semibold">Cursor<\/p>/);
  assert.match(html, /Nom déclaré par l’application : Evil/);

  const fromDocument = render({
    ...registered,
    declaredBy: "evil.test",
    name: "Evil",
    destination: cursor,
  });
  assert.match(fromDocument, /Nom déclaré par evil\.test : Evil/);
});

test("a client with no single vendor keeps today's display", () => {
  const html = render({ ...registered, name: "Cursor", destination: null });
  assert.match(html, /Nom déclaré par l’application \(enregistrée dynamiquement\)/);
  assert.match(html, /Nom non vérifié/);
  assert.doesNotMatch(html, /renvoie vers/);
});

test("a client on Louez's list keeps its badge", () => {
  const html = render({
    name: "Claude",
    declaredBy: "claude.ai",
    verified: true,
    iconUrl: null,
    destination: null,
  });
  assert.match(html, /Nom déclaré par claude\.ai/);
  assert.match(html, />Vérifié</);
});
