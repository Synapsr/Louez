import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPromptPasskey,
  dismissPasskeyPrompt,
  prefersPasskey,
  rememberPasskey,
} from "./util.passkey-preferences";

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

test("only successful registration/sign-in opts this browser into the preferred method", () => {
  const local = storage();
  assert.equal(prefersPasskey(local), false);
  rememberPasskey(true, local);
  assert.equal(prefersPasskey(local), true);
  rememberPasskey(false, local);
  assert.equal(prefersPasskey(local), false);
});

test("dismissal is per account and lasts 30 days", () => {
  const local = storage();
  const now = 1_000_000;
  assert.equal(canPromptPasskey("one", local, now), true);
  dismissPasskeyPrompt("one", local, now);
  assert.equal(canPromptPasskey("one", local, now + 29 * 86400000), false);
  assert.equal(canPromptPasskey("two", local, now), true);
  assert.equal(canPromptPasskey("one", local, now + 30 * 86400000), true);
});

test("blocked storage neither breaks login nor repeatedly opens an invitation", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  for (const local of [blocked, null]) {
    assert.equal(prefersPasskey(local), false);
    assert.equal(canPromptPasskey("one", local), false);
    assert.doesNotThrow(() => rememberPasskey(true, local));
    assert.doesNotThrow(() => dismissPasskeyPrompt("one", local));
  }
});
