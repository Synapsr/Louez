import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSignInMethods } from "./sign-in-methods";

describe("resolveSignInMethods", () => {
  test("keeps the password primary on a standalone instance", () => {
    assert.deepEqual(
      resolveSignInMethods({
        standalone: true,
        emailConfigured: false,
        googleAuthConfigured: false,
      }),
      { password: "primary", emailOtp: false, google: false },
    );
  });

  test("makes the password a secondary method on the platform", () => {
    assert.deepEqual(
      resolveSignInMethods({
        standalone: false,
        emailConfigured: true,
        googleAuthConfigured: true,
      }),
      { password: "secondary", emailOtp: true, google: true },
    );
  });

  test("only offers the e-mail code and Google where they are configured", () => {
    const methods = resolveSignInMethods({
      standalone: true,
      emailConfigured: true,
      googleAuthConfigured: false,
    });

    assert.equal(methods.emailOtp, true);
    assert.equal(methods.google, false);
  });
});
