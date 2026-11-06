import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SignInMethods } from "./sign-in-methods";
import {
  LAST_SIGN_IN_METHOD_STORAGE_KEY,
  readLastSignInMethod,
  rememberLastSignInMethod,
  resolveInitialLoginStep,
} from "./util.last-sign-in-method";

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const throwingStorage = {
  getItem: () => {
    throw new Error("storage blocked");
  },
  setItem: () => {
    throw new Error("storage blocked");
  },
};

const platform: SignInMethods = {
  password: "secondary",
  emailOtp: true,
  google: true,
};
const standalone: SignInMethods = {
  password: "primary",
  emailOtp: true,
  google: false,
};

describe("last sign-in method storage", () => {
  test("round-trips a method through the storage", () => {
    const storage = createStorage();

    rememberLastSignInMethod("password", storage);

    assert.equal(storage.getItem(LAST_SIGN_IN_METHOD_STORAGE_KEY), "password");
    assert.equal(readLastSignInMethod(storage), "password");
  });

  test("ignores a value it did not write", () => {
    const storage = createStorage({
      [LAST_SIGN_IN_METHOD_STORAGE_KEY]: "passkey",
    });

    assert.equal(readLastSignInMethod(storage), null);
  });

  test("reads nothing without a storage (server render)", () => {
    assert.equal(readLastSignInMethod(null), null);
    assert.doesNotThrow(() => rememberLastSignInMethod("emailOtp", null));
  });

  test("never throws when the browser blocks the storage", () => {
    assert.equal(readLastSignInMethod(throwingStorage), null);
    assert.doesNotThrow(() => rememberLastSignInMethod("password", throwingStorage));
  });
});

describe("resolveInitialLoginStep", () => {
  test("opens the e-mail step on the platform by default", () => {
    assert.equal(resolveInitialLoginStep(platform, null), "email");
  });

  test("opens the password step on a standalone instance by default", () => {
    assert.equal(resolveInitialLoginStep(standalone, null), "password");
  });

  test("reopens the method used last time", () => {
    assert.equal(resolveInitialLoginStep(platform, "password"), "password");
    assert.equal(resolveInitialLoginStep(standalone, "emailOtp"), "email");
  });

  test("ignores a remembered e-mail code the instance can no longer send", () => {
    assert.equal(
      resolveInitialLoginStep({ ...standalone, emailOtp: false }, "emailOtp"),
      "password",
    );
  });

  test("ignores a remembered password where passwords are off", () => {
    assert.equal(resolveInitialLoginStep({ ...platform, password: false }, "password"), "email");
  });
});
