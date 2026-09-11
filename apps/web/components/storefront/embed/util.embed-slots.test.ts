import assert from "node:assert/strict";
import { test } from "node:test";

import { groupEmbedSlots } from "./util.embed-slots";

test("a split day makes one block per opening range", () => {
  const groups = groupEmbedSlots(["09:00", "09:30", "10:00", "14:00", "14:30"], 30);
  assert.deepEqual(
    groups.map((group) => [group.period, group.slots]),
    [
      ["morning", ["09:00", "09:30", "10:00"]],
      ["afternoon", ["14:00", "14:30"]],
    ],
  );
});

test("a continuous day stays one block, named after its first slot", () => {
  const groups = groupEmbedSlots(["09:00", "09:30", "10:00"], 30);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.key, "09:00");
  assert.equal(groups[0]?.period, "morning");
});

test("evening slots get their own period", () => {
  const groups = groupEmbedSlots(["18:00", "18:30"], 30);
  assert.equal(groups[0]?.period, "evening");
});

test("no slot, no group", () => {
  assert.deepEqual(groupEmbedSlots([], 30), []);
});
