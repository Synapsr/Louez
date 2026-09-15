import assert from "node:assert/strict";
import test from "node:test";
import { advanceDemoClock, DEMO_CUES, DEMO_DURATION } from "./use-demo-playback";

test("pausing preserves the active position and resuming reaches the next cue", () => {
  const beforeHover = advanceDemoClock(0, 700);
  assert.equal(advanceDemoClock(beforeHover, 0), 700);
  assert.equal(advanceDemoClock(beforeHover, 350), DEMO_CUES.storefront[1].at);
  assert.equal(advanceDemoClock(beforeHover, -100), beforeHover);
  assert.equal(advanceDemoClock(DEMO_DURATION - 10, 5000), DEMO_DURATION);
});
test("all flows finish in 3–5 seconds and cues precede completion", () => {
  assert.ok(DEMO_DURATION >= 3000 && DEMO_DURATION <= 5000);
  for (const cues of Object.values(DEMO_CUES)) {
    assert.ok(cues.some((cue) => "click" in cue && cue.click));
    assert.ok(
      cues.every(
        (cue, index) => cue.at < DEMO_DURATION && (index === 0 || cue.at > cues[index - 1].at),
      ),
    );
  }
});
