import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { render } from "@react-email/render";
import { supportedLocales } from "@louez/types";
import {
  OTPEmail,
  getOtpEmailSubject,
  PasswordChangedEmail,
  getPasswordChangedEmailSubject,
} from "@louez/email/templates";

// tsx loads the shared email package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

for (const locale of supportedLocales) {
  test(`${locale}: login and password reset codes render with distinct subjects`, async () => {
    const loginSubject = getOtpEmailSubject(locale, "sign-in");
    const resetSubject = getOtpEmailSubject(locale, "forget-password");
    assert.ok(loginSubject.trim());
    assert.ok(resetSubject.trim());
    assert.notEqual(loginSubject, resetSubject);
    for (const purpose of ["sign-in", "forget-password"] as const) {
      const html = await render(OTPEmail({ otp: "123456", locale, purpose }));
      assert.ok(html.includes("123456"));
      assert.ok(html.includes(`lang="${locale}"`));
      assert.ok(!html.includes("undefined"));
    }
  });

  test(`${locale}: every password security notice renders its account protection link`, async () => {
    const url = "https://example.com/dashboard/account/password-alert";
    for (const event of ["added", "changed", "reset", "removed"] as const) {
      assert.ok(getPasswordChangedEmailSubject(locale, event).trim());
      const html = await render(PasswordChangedEmail({ locale, event, url }));
      assert.ok(html.includes(`href="${url}"`));
      assert.ok(html.includes(`lang="${locale}"`));
      assert.ok(!html.includes("undefined"));
    }
  });
}
