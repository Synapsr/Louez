import assert from "node:assert/strict";
import { test } from "node:test";
import { demo as settings } from "@/components/landing-demos/features/notification-settings.demo";
import { demo as reminders } from "@/components/landing-demos/features/customer-reminders.demo";
import { demo as confirmation } from "@/components/landing-demos/features/booking-confirmation.demo";

test("message scripts move before acting, use data selectors, and leave time to read", () => {
  for (const demo of [settings, reminders, confirmation]) {
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    let previousAt = -1;
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at > previousAt && cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-/);
      assert.doesNotMatch(cue.selector, /aria-|:has-text|text=/);
      if (cue.click || cue.press || cue.emit || cue.scroll) {
        const move = demo.cues[index - 1];
        assert.ok(move);
        assert.equal(move.selector, cue.selector);
        assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
        assert.equal(move.click, undefined);
        assert.equal(move.emit, undefined);
      }
      previousAt = cue.at;
    }
    assert.ok(demo.duration - previousAt >= 2000);
  }
});
