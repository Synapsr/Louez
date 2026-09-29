import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createAuthMutationError,
  getAuthErrorCode,
  getMutationAuthCode,
  mapAuthErrorCodeToMessageKey,
  resolveAuthErrorMessage,
} from "./util.auth-error";

describe("mapAuthErrorCodeToMessageKey", () => {
  test("maps the e-mail code errors", () => {
    assert.equal(mapAuthErrorCodeToMessageKey("INVALID_OTP"), "errors.invalidCode");
    assert.equal(mapAuthErrorCodeToMessageKey("OTP_EXPIRED"), "errors.codeExpired");
    assert.equal(mapAuthErrorCodeToMessageKey("TOO_MANY_ATTEMPTS"), "errors.tooManyAttempts");
  });

  test("does not reveal that an address has no account", () => {
    assert.equal(
      mapAuthErrorCodeToMessageKey("USER_NOT_FOUND"),
      mapAuthErrorCodeToMessageKey("INVALID_OTP"),
    );
  });

  test("maps the password errors", () => {
    const expected: Record<string, string> = {
      INVALID_EMAIL_OR_PASSWORD: "errors.invalidCredentials",
      PASSWORD_TOO_SHORT: "errors.passwordTooShort",
      PASSWORD_TOO_LONG: "errors.passwordTooLong",
      INVALID_PASSWORD: "errors.invalidPassword",
      PASSWORD_ALREADY_SET: "errors.passwordAlreadySet",
      CREDENTIAL_ACCOUNT_NOT_FOUND: "errors.passwordNotSet",
      PASSWORD_REMOVAL_UNAVAILABLE: "errors.passwordRemovalUnavailable",
      EMAIL_PASSWORD_SIGN_UP_DISABLED: "errors.passwordSignUpDisabled",
      TOO_MANY_REQUESTS: "errors.tooManyRequests",
      UNAUTHORIZED: "errors.sessionExpired",
    };

    for (const [code, key] of Object.entries(expected)) {
      assert.equal(mapAuthErrorCodeToMessageKey(code), key);
    }
  });

  test("falls back to the generic message, never to a raw one", () => {
    assert.equal(mapAuthErrorCodeToMessageKey("SOMETHING_NEW"), "errors.default");
    assert.equal(mapAuthErrorCodeToMessageKey(null), null);
    assert.equal(
      resolveAuthErrorMessage((key) => key, null),
      "errors.default",
    );
  });
});

describe("getAuthErrorCode", () => {
  test("reads the better-auth code", () => {
    assert.equal(getAuthErrorCode({ code: "INVALID_OTP", status: 400 }), "INVALID_OTP");
  });

  test("turns the rate limiter’s bare 429 into a code", () => {
    assert.equal(
      getAuthErrorCode({
        status: 429,
        message: "Too many requests. Please try again later.",
      }),
      "TOO_MANY_REQUESTS",
    );
  });

  test("returns null for anything else", () => {
    assert.equal(getAuthErrorCode({ status: 500 }), null);
    assert.equal(getAuthErrorCode(null), null);
    assert.equal(getAuthErrorCode("boom"), null);
  });

  test("carries the code through a mutation error", () => {
    assert.equal(
      getMutationAuthCode(createAuthMutationError("INVALID_PASSWORD")),
      "INVALID_PASSWORD",
    );
    assert.equal(getMutationAuthCode(createAuthMutationError(null)), null);
  });
});
