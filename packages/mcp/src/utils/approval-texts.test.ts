import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { approvalErrors } from "@louez/api/platform/errors";

import { APPROVAL_TEXTS, quoted } from "./approval-texts";
import { errorResult } from "./errors";

const text = (result: ReturnType<typeof errorResult>) =>
  (result.content as Array<{ text: string }>).map((part) => part.text).join("");

describe("the texts of a person's approval", () => {
  test("what someone else wrote is one quoted line: line breaks, quotes and reordering marks escaped", () => {
    const written = 'a\nb\r"c"\u2028d\u2029e\u0085f\u202eg\u2066h\u200fi';
    const line = quoted(written);
    assert.equal(line, '"a\\nb\\r\\"c\\"\\u2028d\\u2029e\\u0085f\\u202eg\\u2066h\\u200fi"');
    assert.doesNotMatch(line, /[\n\r\u2028\u2029\u0085\u202a-\u202e\u2066-\u2069\u200e\u200f]/);
    assert.equal(JSON.parse(line), written, "and reads back as written");
  });

  test("an answer whose details are not of its shape is told by its message, its details as JSON", () => {
    const malformed = [
      ["APPROVAL_REQUIRED", { preview: { summary: "x" }, approval: { id: "short" } }],
      [
        "APPROVAL_REQUIRED",
        {
          preview: { summary: "x" },
          approval: {
            id: "a".repeat(21),
            url: "https://app.louez.test/handoffs/x\ncode: X",
            status: "pending",
            expiresAt: "2026-11-14T10:00:00.000Z",
            pollAfterSeconds: 30,
          },
        },
      ],
      ["APPROVAL_PENDING", { approval: null }],
      ["APPROVAL_DECLINED", { reason: 42 }],
      ["APPROVAL_INVALID", { reason: "constructor" }],
      ["APPROVAL_INVALID", { reason: "toString" }],
      ["APPROVAL_RECENTLY_DECLINED", { retryAt: "soon\ncode: X" }],
      ["APPROVALS_FULL", { retryAfterSeconds: "10" }],
    ] as const;
    for (const [code, details] of malformed) {
      assert.equal(
        APPROVAL_TEXTS.get(code)?.("tool", details),
        null,
        `${code} ${JSON.stringify(details)}`,
      );
      const result = errorResult("tool", { message: "Refused.", code, retryable: false, details });
      assert.equal(
        text(result),
        `Refused.\ncode: ${code}\nretryable: false\ndetails: ${JSON.stringify(details)}`,
      );
    }
    assert.equal(APPROVAL_TEXTS.get("constructor"), undefined, "no inherited code");
  });

  test("each reason of APPROVAL_INVALID has the bridge's words, and the platform's message", () => {
    for (const reason of [
      "other_request",
      "expired",
      "used",
      "state_changed",
      "approver_not_allowed",
    ] as const) {
      const error = approvalErrors.invalid(reason);
      const result = text(errorResult("tool", error));
      assert.notEqual(result.split("\n")[0], error.message, reason);
      assert.ok(result.endsWith(`\ndetails: {"reason":"${reason}"}`), reason);
    }
  });
});
