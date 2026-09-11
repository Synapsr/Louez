import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOLDED_EMBED_PERIOD,
  nextEmbedPeriodStep,
  resolveEmbedPeriodPick,
  resolveEmbedPeriodTap,
  toEmbedPeriodStep,
} from "./util.embed-period-steps";

test("the guided order runs pickup day, pickup time, return day, return time", () => {
  assert.equal(nextEmbedPeriodStep("startDate"), "startTime");
  assert.equal(nextEmbedPeriodStep("startTime"), "endDate");
  assert.equal(nextEmbedPeriodStep("endDate"), "endTime");
  assert.equal(nextEmbedPeriodStep("endTime"), null);
});

test("a first tap without dates starts the chain", () => {
  const editing = resolveEmbedPeriodTap(FOLDED_EMBED_PERIOD, "startDate", false);
  assert.deepEqual(editing, { active: "startDate", chaining: true });
});

test("a tap with dates edits that half alone", () => {
  const editing = resolveEmbedPeriodTap(FOLDED_EMBED_PERIOD, "endDate", true);
  assert.deepEqual(editing, { active: "endDate", chaining: false });
  assert.deepEqual(resolveEmbedPeriodPick(editing), FOLDED_EMBED_PERIOD);
});

test("tapping the open half folds the panel", () => {
  const editing = resolveEmbedPeriodTap({ active: "startTime", chaining: true }, "startTime", true);
  assert.deepEqual(editing, FOLDED_EMBED_PERIOD);
});

test("while chaining, each pick hands over until the return time folds", () => {
  let editing = resolveEmbedPeriodTap(FOLDED_EMBED_PERIOD, "startDate", false);
  const visited = [editing.active];
  while (editing.active) {
    editing = resolveEmbedPeriodPick(editing);
    visited.push(editing.active);
  }
  assert.deepEqual(visited, ["startDate", "startTime", "endDate", "endTime", null]);
});

test("a chain started mid-way follows the remaining order", () => {
  const editing = resolveEmbedPeriodTap(FOLDED_EMBED_PERIOD, "endDate", false);
  assert.deepEqual(resolveEmbedPeriodPick(editing), { active: "endTime", chaining: true });
});

test("field and part combine into a step", () => {
  assert.equal(toEmbedPeriodStep("start", "date"), "startDate");
  assert.equal(toEmbedPeriodStep("end", "time"), "endTime");
});
