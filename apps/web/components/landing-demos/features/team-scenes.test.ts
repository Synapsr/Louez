import assert from "node:assert/strict";
import test from "node:test";

import { demo as multiStore } from "@/components/landing-demos/features/multi-store.demo";
import { demo as multiStoreChart } from "@/components/landing-demos/features/multi-store-chart.demo";
import { demo as teamInvite } from "@/components/landing-demos/features/team-invite.demo";

test("team and multi-store loops move to stable data targets before acting", () => {
  for (const demo of [multiStore, multiStoreChart, teamInvite]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      const previous = demo.cues[index - 1];
      assert.ok(cue.at > (previous?.at ?? -1) && cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-[\w-]+="[\w-]+"\]$/);
      if (cue.click || cue.type) {
        assert.equal(previous?.selector, cue.selector);
        assert.ok(cue.at - previous.at >= 700 && cue.at - previous.at <= 900);
        assert.ok(!previous.click && !previous.type);
      }
      if (cue.type)
        assert.ok(cue.at + cue.type.duration < (demo.cues[index + 1]?.at ?? demo.duration));
    }
  }
});

test("the chart hides and restores the same real legend control", () => {
  const clicks = multiStoreChart.cues.filter((cue) => cue.click);
  assert.equal(clicks.length, 2);
  assert.equal(clicks[0].selector, clicks[1].selector);
  assert.ok(clicks[1].at - clicks[0].at >= 2500);
});

test("the team loop types a complete address, submits, then leaves time to read the pending invitation", () => {
  assert.equal(teamInvite.cues.find((cue) => cue.type)?.type?.text, "lea.dupont@example.com");
  const submit = teamInvite.cues.find((cue) => cue.click);
  const pending = teamInvite.cues.at(-1);
  assert.ok(submit && pending);
  assert.equal(submit.selector, '[data-demo-target="team-invite-submit"]');
  assert.equal(pending.selector, '[data-demo-target="team-pending-invitation"]');
  assert.ok(pending.at > submit.at && teamInvite.duration - pending.at >= 2000);
});
