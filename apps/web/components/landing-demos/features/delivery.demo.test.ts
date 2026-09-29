import assert from "node:assert/strict";
import test from "node:test";

import { demo as calendar } from "./delivery-calendar.demo";
import { demo as settings } from "./delivery-settings.demo";
import { demo as simulator } from "./delivery-simulator.demo";

test("delivery scripts leave time to move, act and read within a desktop loop", () => {
  for (const demo of [settings, simulator, calendar]) {
    assert.equal(demo.actor, "owner");
    assert.ok(!demo.format || demo.format === "desktop");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at < demo.duration);
      assert.ok(cue.selector.includes("[data-"));
      assert.ok(!cue.selector.includes("aria-label"));
      assert.equal(cue.emit, undefined);
      if (index > 0) assert.ok(cue.at > demo.cues[index - 1].at);
      if (!cue.click && !cue.hover && !cue.type) continue;
      const move = demo.cues[index - 1];
      assert.ok(move);
      assert.equal(move.selector, cue.selector);
      assert.ok(!move.click && !move.hover && !move.type);
      assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
      assert.ok(cue.at + (cue.type?.duration ?? 0) < demo.duration);
    }
  }
});
