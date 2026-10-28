import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { InstanceProvider } from "@/components/instance-provider";
import messages from "@/messages/fr.json";

import { LoginLegalNotice } from "./login-legal-notice";

// Design §7.2 hides Louez.io's /terms on an instance that does not bill its stores; the
// privacy policy is still served there, so the sign-in page still links it.

const render = (billingEnabled: boolean) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <InstanceProvider
        config={{ standalone: false, emailConfigured: true, googleAuthConfigured: true, billingEnabled }}
      >
        <LoginLegalNotice />
      </InstanceProvider>
    </NextIntlClientProvider>,
  );

test("with billing on, the sign-in page links the terms of service and the privacy policy", () => {
  const html = render(true);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /En continuant, vous acceptez nos/);
  assert.match(html, /href="\/privacy"[^>]*>Politique de confidentialité</);
});

test("with billing off, only the privacy policy is linked", () => {
  const html = render(false);
  assert.doesNotMatch(html, /\/terms/);
  assert.doesNotMatch(html, /vous acceptez/);
  assert.match(html, /href="\/privacy"[^>]*>Politique de confidentialité</);
});
