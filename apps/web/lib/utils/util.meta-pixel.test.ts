import assert from "node:assert/strict";
import { test } from "node:test";

import { fireMetaSignedUpEvent, isMetaSignedUpEventDue } from "./util.meta-pixel";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const stubBrowser = (stored: Record<string, string> = {}) => {
  const scripts: { src?: string; onload?: () => void }[] = [];
  const fakeWindow: { fbq?: { queue: unknown[][] }; localStorage: unknown } = {
    localStorage: {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => {
        stored[key] = value;
      },
    },
  };

  Object.assign(globalThis, {
    window: fakeWindow,
    document: {
      createElement: () => ({}),
      head: { appendChild: (script: { src?: string }) => scripts.push(script) },
    },
  });

  return { fakeWindow, scripts, stored };
};

const removeBrowserStub = () => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
};

test("sends only the signed-up event to the given pixel, without a PageView", (t) => {
  t.after(removeBrowserStub);
  const { fakeWindow, scripts } = stubBrowser();

  fireMetaSignedUpEvent("123456");

  assert.deepEqual(fakeWindow.fbq?.queue, [
    ["set", "autoConfig", false, "123456"],
    ["init", "123456"],
    ["trackSingleCustom", "123456", "fh_signed_up"],
  ]);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0]?.src ?? "", /connect\.facebook\.net/);
});

test("records the send only once the script has loaded, so a blocked script retries", (t) => {
  t.after(removeBrowserStub);
  const { scripts, stored } = stubBrowser();

  fireMetaSignedUpEvent("123456");
  assert.deepEqual(stored, {});

  scripts[0]?.onload?.();
  assert.equal(isMetaSignedUpEventDue(Object.values(stored)[0] ?? null, Date.now()), false);
});

test("loads nothing when the event was sent recently", (t) => {
  t.after(removeBrowserStub);
  const { fakeWindow, scripts } = stubBrowser({ louez_meta_signed_up_at: String(Date.now()) });

  fireMetaSignedUpEvent("123456");

  assert.equal(fakeWindow.fbq, undefined);
  assert.equal(scripts.length, 0);
});

test("is due when the event was never sent", () => {
  assert.equal(isMetaSignedUpEventDue(null, NOW), true);
});

test("is not due within 30 days of the last send", () => {
  assert.equal(isMetaSignedUpEventDue(String(NOW - 29 * DAY_MS), NOW), false);
});

test("is due again after 30 days", () => {
  assert.equal(isMetaSignedUpEventDue(String(NOW - 30 * DAY_MS), NOW), true);
});

test("is due when the stored value is unreadable", () => {
  assert.equal(isMetaSignedUpEventDue("not-a-timestamp", NOW), true);
});
