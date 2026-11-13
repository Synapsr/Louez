import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import type { CredentialKind } from "./actor";
import type { ApprovalLevel, Consequence } from "./approval-rule";
import type { ProcedureScope } from "./permissions";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/utils/sanitize-rich-text"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const { APPROVAL_LIVE, CONSEQUENCES, approvalLevel, confirmationStep, mayApprove } =
  await import("./approval-rule");

// The rule of a person's approval, row by row
// (docs/architecture/api-and-agents.md, "Which actions need a person"), and
// its compatibility adapter against the rule it replaces.

const KINDS: readonly CredentialKind[] = ["session", "api_key", "oauth"];
const OPTIONS = [true, false] as const;

/** The plan's table: a key's or a token's level, option on and off. A session is never asked. */
const TABLE: Record<Consequence, { on: ApprovalLevel; off: ApprovalLevel }> = {
  money: { on: "person", off: "person" },
  stock_override: { on: "person", off: "person" },
  access_removed: { on: "person", off: "person" },
  deletion: { on: "person", off: "none" },
  customer_message: { on: "person", off: "none" },
  credits: { on: "caller", off: "caller" },
  change: { on: "caller", off: "none" },
};

/** What `always` asked before the rule: money, access taken away, the overrides, priced credits. */
const ALWAYS: readonly Consequence[] = ["money", "stock_override", "access_removed", "credits"];

/** Who was asked before the rule: a key or a token with its option on, or any of them for `always`. */
const askedBefore = (
  consequences: readonly Consequence[],
  kind: CredentialKind,
  confirmSensitive: boolean,
) =>
  kind !== "session" &&
  (confirmSensitive || consequences.some((consequence) => ALWAYS.includes(consequence)));

/** Every declaration of one or two consequences. */
const DECLARATIONS: Consequence[][] = CONSEQUENCES.flatMap((first, index) => [
  [first],
  ...CONSEQUENCES.slice(index + 1).map((second) => [first, second]),
]);

describe("approvalLevel", () => {
  for (const consequence of CONSEQUENCES) {
    for (const kind of KINDS) {
      for (const confirmSensitive of OPTIONS) {
        const expected =
          kind === "session" ? "none" : TABLE[consequence][confirmSensitive ? "on" : "off"];
        test(`${consequence}, ${kind}, option ${confirmSensitive ? "on" : "off"}: ${expected}`, () => {
          assert.equal(approvalLevel([consequence], { kind, confirmSensitive }), expected);
        });
      }
    }
  }

  test("several consequences take the strictest level", () => {
    const key = (confirmSensitive: boolean) => ({ kind: "api_key" as const, confirmSensitive });
    assert.equal(approvalLevel(["change", "customer_message"], key(true)), "person");
    assert.equal(approvalLevel(["change", "customer_message"], key(false)), "none");
    assert.equal(approvalLevel(["deletion", "credits"], key(false)), "caller");
    assert.equal(approvalLevel(["credits", "stock_override"], key(false)), "person");
    assert.equal(approvalLevel(["stock_override", "customer_message"], key(false)), "person");
    assert.equal(
      approvalLevel(["stock_override", "customer_message"], {
        kind: "session",
        confirmSensitive: false,
      }),
      "none",
    );
  });

  test("no consequence asks nothing", () => {
    assert.equal(approvalLevel([], { kind: "oauth", confirmSensitive: true }), "none");
  });
});

describe("the compatibility adapter", () => {
  test("no consequence is live yet", () => {
    assert.deepEqual(APPROVAL_LIVE, []);
  });

  // Row by row against the rule it replaces: for every declaration, every
  // credential and its option, it asks exactly who was asked before, and
  // asks with the caller's token, never a person's approval.
  for (const consequences of DECLARATIONS) {
    test(`${consequences.join(" + ")}: asked as before`, () => {
      for (const kind of KINDS) {
        for (const confirmSensitive of OPTIONS) {
          if (kind === "session" && confirmSensitive) continue; // a session's option is always off
          const step = confirmationStep(consequences, { kind, confirmSensitive });
          const label = `${kind}, option ${confirmSensitive ? "on" : "off"}`;
          assert.notEqual(step, "approval", `${label}: no approval before a consequence is live`);
          assert.equal(step === "token", askedBefore(consequences, kind, confirmSensitive), label);
        }
      }
    });
  }

  test("each level maps to today's step", () => {
    const key = (confirmSensitive: boolean) => ({ kind: "api_key" as const, confirmSensitive });
    // A person's level asks for the token, as `always` did.
    assert.equal(confirmationStep(["money"], key(false)), "token");
    // The caller's level asks for the token.
    assert.equal(confirmationStep(["credits"], key(false)), "token");
    assert.equal(confirmationStep(["change"], key(true)), "token");
    // Nobody: it runs.
    assert.equal(confirmationStep(["deletion"], key(false)), "none");
    assert.equal(
      confirmationStep(["money"], { kind: "session", confirmSensitive: false }),
      "none",
      "a session is never asked",
    );
  });
});

describe("mayApprove", () => {
  const STORE = "store_a";
  const PRODUCTS_WRITE: ProcedureScope = { domain: "products", level: "write" };
  const PRODUCTS_DELETE: ProcedureScope = { domain: "products", level: "write", role: "delete" };
  const TEAM: ProcedureScope = { domain: "team", level: "write", role: "manage_members" };
  const PAYMENTS: ProcedureScope = { domain: "payments", level: "write" };

  const ROWS: Array<{
    name: string;
    user: Parameters<typeof mayApprove>[0];
    scope: ProcedureScope;
    expected: boolean;
  }> = [
    {
      name: "the requester's user, owner of the store",
      user: { userId: "requester", storeId: STORE, role: "owner" },
      scope: TEAM,
      expected: true,
    },
    {
      name: "the requester's user, a member whose role allows the action",
      user: { userId: "requester", storeId: STORE, role: "member" },
      scope: PAYMENTS,
      expected: true,
    },
    {
      name: "the requester's user, a member whose role does not allow the action",
      user: { userId: "requester", storeId: STORE, role: "member" },
      scope: TEAM,
      expected: false,
    },
    {
      name: "the requester's user, no longer a member",
      user: { userId: "requester", storeId: STORE, role: null },
      scope: PRODUCTS_WRITE,
      expected: false,
    },
    {
      name: "the requester's user, in another store",
      user: { userId: "requester", storeId: "store_b", role: "owner" },
      scope: PRODUCTS_WRITE,
      expected: false,
    },
    {
      name: "another user, owner of the store",
      user: { userId: "owner", storeId: STORE, role: "owner" },
      scope: PRODUCTS_DELETE,
      expected: false,
    },
  ];

  // Who may approve is a fact about the person and the right the action
  // needs: neither the consequence nor the kind of credential that asked.
  for (const row of ROWS) {
    test(`${row.name}: ${row.expected ? "may" : "may not"} approve`, () => {
      assert.equal(
        mayApprove(row.user, { storeId: STORE, requesterUserId: "requester", scope: row.scope }),
        row.expected,
      );
    });
  }
});
