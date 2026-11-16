import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

// The approval's texts load the approval services, which pull in
// "@louez/auth": no call reaches it here.
const directory = mkdtempSync(join(tmpdir(), "louez-ai-approval-results-"));
const authStubPath = join(directory, "auth.mjs");
writeFileSync(
  authStubPath,
  "export const auth = {}; export const mcpOAuth = null; export const authInstance = {};",
);
after(() => rmSync(directory, { recursive: true }));
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    if (specifier === "@louez/auth") {
      return { url: pathToFileURL(authStubPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

type Errors = typeof import("@louez/api/platform/errors");
type Help = typeof import("@louez/api/platform/approval-help");
let approvalErrors: Errors["approvalErrors"];
let ASSISTANT_APPROVAL_TEXTS: Help["ASSISTANT_APPROVAL_TEXTS"];
let approvalResultOf: typeof import("./payment-approval").approvalResultOf;

before(async () => {
  // packages/api is ES modules: the CommonJS packages' names, by hand.
  await import("@louez/mcp/testing/cjs-named-exports");
  ({ approvalErrors } = await import("@louez/api/platform/errors"));
  ({ ASSISTANT_APPROVAL_TEXTS } = await import("@louez/api/platform/approval-help"));
  ({ approvalResultOf } = await import("./payment-approval"));
});

// What the assistant's payment tools answer for each answer of the
// platform's approval: a structured result the model reads, never an error
// thrown at it, and never an instruction to call again and again.

const ID = "AbCdEfGhIjKlMnOpQrStU";
const approval = (status: "pending" | "approved", stillAsApproved?: boolean) => ({
  id: ID,
  url: `https://app.test/handoffs/${ID}`,
  status,
  expiresAt: "2030-06-01T09:00:00.000Z",
  pollAfterSeconds: 30,
  decision: null,
  ...(stillAsApproved === undefined ? {} : { stillAsApproved }),
});
const preview = {
  summary: "Record a rental payment of €40.00 (cash) on reservation #2030-0001.",
  details: { reservationId: "res_1", number: "2030-0001", amount: "40.00", notes: "Ada" },
};

describe("approvalResultOf", () => {
  test("a request waiting for the person is the card's result", () => {
    const result = approvalResultOf(approvalErrors.required(preview, approval("pending")));
    assert.deepEqual(result, {
      status: "approval_required",
      approvalId: ID,
      url: `https://app.test/handoffs/${ID}`,
      summary: preview.summary,
      amount: "40.00",
      bookingNumber: "2030-0001",
      expiresAt: "2030-06-01T09:00:00.000Z",
      message: ASSISTANT_APPROVAL_TEXTS.required,
    });
  });

  test("an approved request the call is not is no approval of it", () => {
    assert.equal(
      approvalResultOf(approvalErrors.required(preview, approval("approved", true)))?.status,
      "approved",
    );
    assert.deepEqual(
      approvalResultOf(approvalErrors.required(preview, approval("approved", false))),
      {
        status: "invalid",
        reason: "other_request",
        message: ASSISTANT_APPROVAL_TEXTS.invalid.other_request,
      },
    );
  });

  test("each state of the platform is said as it is", () => {
    assert.deepEqual(approvalResultOf(approvalErrors.pending(approval("pending"))), {
      status: "pending",
      approvalId: ID,
      message: ASSISTANT_APPROVAL_TEXTS.pending,
    });
    assert.deepEqual(approvalResultOf(approvalErrors.declined(ID, "Not\nnow")), {
      status: "declined",
      reason: "Not now",
      message: ASSISTANT_APPROVAL_TEXTS.declined,
    });
    assert.equal(approvalResultOf(approvalErrors.invalid("expired"))?.status, "expired");
    for (const reason of [
      "used",
      "state_changed",
      "approver_not_allowed",
      "other_request",
    ] as const) {
      assert.deepEqual(approvalResultOf(approvalErrors.invalid(reason)), {
        status: "invalid",
        reason,
        message: ASSISTANT_APPROVAL_TEXTS.invalid[reason],
      });
    }
    const now = new Date();
    assert.equal(
      approvalResultOf(approvalErrors.full("connection_open", now, now))?.status,
      "unavailable",
    );
    assert.equal(approvalResultOf(approvalErrors.recentlyDeclined(now, now))?.status, "declined");
  });

  test("any other error is not an approval's", () => {
    assert.equal(approvalResultOf(new Error("boom")), null);
  });

  test("no text tells the model to call again until the person decides", () => {
    const texts = [
      ASSISTANT_APPROVAL_TEXTS.required,
      ASSISTANT_APPROVAL_TEXTS.pending,
      ASSISTANT_APPROVAL_TEXTS.declined,
    ];
    for (const text of texts) assert.doesNotMatch(text, /retry|poll|every \d+ seconds/i);
    assert.match(ASSISTANT_APPROVAL_TEXTS.pending, /has not decided yet/);
    assert.match(ASSISTANT_APPROVAL_TEXTS.required, /never ask them for the approval's id/i);
  });
});
