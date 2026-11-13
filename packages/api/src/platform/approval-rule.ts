import type { MemberRole } from "@louez/utils";

import type { Credential } from "./actor";
import { allows, type ProcedureScope } from "./permissions";

/**
 * Who must agree to an action before it runs, and who may approve it
 * (docs/architecture/api-and-agents.md, "A person's approval"). Each place
 * that asks declares the consequences of the branch it is about to run, next
 * to that branch's preview; these functions decide from them, and nothing
 * else. Pure: no database, no clock.
 */

/** What an action does that someone must agree to. */
export const CONSEQUENCES = [
  /** Money moves, or the record of money received or given back changes. */
  "money",
  /** Books over the stock or past the turnover buffer. */
  "stock_override",
  /** Takes a person's access to the store away. */
  "access_removed",
  /** Destroys what the store cannot recreate as it was: units, tiers, history, outside links. */
  "deletion",
  /** A message goes to a customer. */
  "customer_message",
  /** Spends credits the store bought from Louez. */
  "credits",
  /** Anything else a preview guards: the store can put it back. */
  "change",
] as const;
export type Consequence = (typeof CONSEQUENCES)[number];

/** Whether a value is one of the consequences the rule knows, and not a name an object inherits. */
export const isConsequence = (value: unknown): value is Consequence =>
  typeof value === "string" && (CONSEQUENCES as readonly string[]).includes(value);

/** What a branch declares: at least one consequence. */
export type Consequences = readonly [Consequence, ...Consequence[]];

/** Who must agree: a person on a Louez page, the caller with its token, or nobody. */
export type ApprovalLevel = "person" | "caller" | "none";

/** Each consequence's level for a key or a token, by the connection's option. */
const LEVELS: Record<Consequence, { optionOn: ApprovalLevel; optionOff: ApprovalLevel }> = {
  money: { optionOn: "person", optionOff: "person" },
  stock_override: { optionOn: "person", optionOff: "person" },
  access_removed: { optionOn: "person", optionOff: "person" },
  deletion: { optionOn: "person", optionOff: "none" },
  customer_message: { optionOn: "person", optionOff: "none" },
  credits: { optionOn: "caller", optionOff: "caller" },
  change: { optionOn: "caller", optionOff: "none" },
};

const STRICTNESS: Record<ApprovalLevel, number> = { none: 0, caller: 1, person: 2 };

/** One consequence's level for this credential. */
function levelOf(
  consequence: Consequence,
  credential: Pick<Credential, "kind" | "confirmSensitive">,
): ApprovalLevel {
  // A session is the user: they clicked in the dashboard, or asked the in-app assistant.
  // A name forced past the type must not find a level by accident (an object
  // inherits `toString`): the rule knows its consequences and no other.
  if (!isConsequence(consequence)) {
    throw new Error(`Unknown consequence: ${String(consequence)}`);
  }
  if (credential.kind === "session") return "none";
  const levels = LEVELS[consequence];
  return credential.confirmSensitive ? levels.optionOn : levels.optionOff;
}

/**
 * Who must agree to a branch with these consequences, for this credential:
 * the strictest level among them. A person approves what the store cannot
 * take back in Louez and what reaches money, a person or a promise the
 * store's own rules refuse; the caller confirms what the store can put back.
 */
export function approvalLevel(
  consequences: readonly Consequence[],
  credential: Pick<Credential, "kind" | "confirmSensitive">,
): ApprovalLevel {
  let level: ApprovalLevel = "none";
  for (const consequence of consequences) {
    const next = levelOf(consequence, credential);
    if (STRICTNESS[next] > STRICTNESS[level]) level = next;
  }
  return level;
}

/**
 * The consequences whose `person` level asks for a person's approval. The
 * others still ask for the caller's token, as before the rule: none is live
 * until the approval exists (pull requests 7 and 8 of the plan).
 */
export const APPROVAL_LIVE: readonly Consequence[] = [];

/** How a branch is asked, until each consequence goes live. */
export type ConfirmationStep = "approval" | "token" | "none";

/**
 * The compatibility adapter: the level, as asked today. A `person` level
 * asks for a person's approval only for a live consequence that needs one;
 * otherwise it asks for the token, as the call's `always` did before. So,
 * with nothing live, a session is never asked; with the option on, a key or
 * a token confirms every branch; with it off, it still confirms money,
 * access taken away, stock overrides and priced credit spending, and runs
 * the rest directly.
 */
export function confirmationStep(
  consequences: readonly Consequence[],
  credential: Pick<Credential, "kind" | "confirmSensitive">,
): ConfirmationStep {
  const level = approvalLevel(consequences, credential);
  if (level === "none") return "none";
  const needsPerson = consequences.some(
    (consequence) =>
      APPROVAL_LIVE.includes(consequence) && levelOf(consequence, credential) === "person",
  );
  return needsPerson ? "approval" : "token";
}

/** The request an approval is for: its store, who asked, and the right the action needs. */
export interface ApprovalFacts {
  storeId: string;
  /** The user the requesting connection acts for: an API key's owner, an OAuth grant's user. */
  requesterUserId: string;
  scope: ProcedureScope;
}

/** The signed-in user who would decide, as their membership of the approval's store stands now. */
export interface ApproverFacts {
  userId: string;
  storeId: string;
  /** Their role in that store now; null when they are no longer a member. */
  role: MemberRole | null;
}

/**
 * Who may decide an approval: today its requester's user, still a member of
 * its store whose role allows the action. One named rule, so that it can
 * later widen to any member holding the permission the action needs.
 */
export function mayApprove(user: ApproverFacts, approval: ApprovalFacts): boolean {
  if (user.userId !== approval.requesterUserId) return false;
  if (user.storeId !== approval.storeId || user.role === null) return false;
  // A person in the dashboard: the role alone, never a connection's scopes.
  return allows(user.role, null, approval.scope);
}
