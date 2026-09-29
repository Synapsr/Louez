import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "@react-email/render";
import { InstantAccessEmail } from "@/lib/email/templates/instant-access";
import { getEmailTranslations } from "@/lib/email/i18n";
import { locales } from "@/i18n/config";
import { createDemoPeriod } from "./fixtures";
import { createDemoPortal, createDemoPortalEmail } from "./portal";
import { createDemoPortalEmailDocument } from "./portal-email";

for (const locale of locales) {
  test(`the real ${locale} access email has one inert measurable CTA and no remote resources`, async () => {
    const period = createDemoPeriod();
    const portal = createDemoPortal(
      period,
      { productIndex: 0, quantity: 2, selected: {}, unitPrice: 20, period },
      locale,
    );
    const html = await render(
      createElement(InstantAccessEmail, createDemoPortalEmail(portal.confirmed, locale)),
    );
    const inert = createDemoPortalEmailDocument(html);
    assert.equal((inert.match(/data-portal-email-action=/g) ?? []).length, 1);
    assert.match(inert, /Content-Security-Policy/);
    assert.match(inert, /default-src 'none'/);
    assert.doesNotMatch(inert, /\s(?:href|src|srcset)=/i);
    assert.doesNotMatch(inert, /<(?:script|iframe|form)\b/i);
    assert.ok(inert.includes(getEmailTranslations(locale).instantAccess.title));
    assert.ok(inert.includes(portal.confirmed.number));
  });
}
