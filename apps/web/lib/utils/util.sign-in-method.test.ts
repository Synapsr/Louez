import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { inferSignInMethod } from "./util.sign-in-method";

describe("inferSignInMethod", () => {
  test("recognises a password sign-in, even on an account linked to Google", () => {
    assert.equal(inferSignInMethod({ path: "/sign-in/email", hasGoogleAccount: true }), "password");
    assert.equal(
      inferSignInMethod({ path: "/sign-up/email", hasGoogleAccount: false }),
      "password",
    );
  });

  test("keeps the historical label for the e-mail code and the magic link", () => {
    assert.equal(
      inferSignInMethod({ path: "/sign-in/email-otp", hasGoogleAccount: true }),
      "magic link",
    );
    assert.equal(
      inferSignInMethod({ path: "/magic-link/verify", hasGoogleAccount: false }),
      "magic link",
    );
  });

  test("recognises the OAuth callback", () => {
    assert.equal(inferSignInMethod({ path: "/callback/:id", hasGoogleAccount: false }), "google");
  });

  test("does not report a password change as a sign-in", () => {
    assert.equal(inferSignInMethod({ path: "/change-password", hasGoogleAccount: false }), null);
  });

  test("falls back to the account shape outside a known endpoint", () => {
    assert.equal(inferSignInMethod({ path: null, hasGoogleAccount: true }), "google");
    assert.equal(inferSignInMethod({ path: null, hasGoogleAccount: false }), "magic link");
  });
});
