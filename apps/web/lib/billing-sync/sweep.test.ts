import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isSweepDue } from "./sweep";

// When the nightly sweep runs (louez-billing docs/api, README §7.4).

describe("isSweepDue", () => {
  test("from 02:00 UTC until a sweep finished after it", () => {
    const at = (iso: string) => new Date(iso);
    assert.equal(isSweepDue(at("2026-10-25T01:59:00Z"), null), false);
    assert.equal(isSweepDue(at("2026-10-25T02:00:00Z"), null), true);
    assert.equal(isSweepDue(at("2026-10-25T02:05:00Z"), at("2026-10-24T02:00:30Z")), true);
    assert.equal(isSweepDue(at("2026-10-25T02:05:00Z"), at("2026-10-25T02:01:10Z")), false);
    assert.equal(isSweepDue(at("2026-10-25T23:00:00Z"), at("2026-10-25T02:01:10Z")), false);
  });

  test("a sweep missed at 02:00 UTC is still due later that day", () => {
    const at = (iso: string) => new Date(iso);
    assert.equal(isSweepDue(at("2026-10-25T03:00:00Z"), at("2026-10-24T02:00:30Z")), true);
    assert.equal(isSweepDue(at("2026-10-25T23:59:00Z"), at("2026-10-24T02:00:30Z")), true);
  });
});
