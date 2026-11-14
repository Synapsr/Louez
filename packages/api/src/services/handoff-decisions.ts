import { decisionReason, handoffErrors, type HandoffKind } from "../contracts/handoffs";
import type { ApiPorts } from "../platform/ports";
import { approvalAsksToTick } from "./approval-page";
import { answerApproval } from "./approvals";
import { decisionScopeOf, readHandoffLink } from "./handoffs";
import { answerInvitation } from "./team";

/**
 * A person's answer on a step's page (`handoffs.decide`). One procedure for
 * every kind a person decides: it checks whose step it is first (another
 * signed-in user gets `other_user` and nothing else), then that the user may
 * still decide it (`mayActOnStep`, by `mayApprove`), the step neither ended
 * nor expired, then hands the answer to its kind. A kind with no decision on
 * its page (a provider's step) is refused. Each kind holds its own fences,
 * compared under the store's lock: the revision and what the page showed
 * (an invitation's `invitationShown`, an approval's binding). An approval
 * whose consequences ask for it is approved only with the box ticked
 * (`acknowledged`, `approvalAsksToTick`): an approval posted without it
 * decides nothing, a refusal never needs it.
 */

/** What answering a step did: the step, the decision, and what approving it carried out. */
export interface HandoffDecided {
  handoffId: string;
  decision: "approved" | "refused";
  outcome: "invited" | "added" | null;
  effectIds: string[];
}

/** How a kind decided on its page takes the person's answer, as `decideHandoff` hands it over. */
type Answer = (
  row: Parameters<typeof answerInvitation>[0],
  input: Parameters<typeof answerInvitation>[1],
  ports: Pick<ApiPorts, "team" | "afterCommit">,
  now: Date,
) => Promise<HandoffDecided>;

/** How each kind decided on its page takes the answer; the other kinds have none. */
const ANSWERS: Partial<Record<HandoffKind, Answer>> = {
  team_invitation: answerInvitation,
  operation_approval: (row, input) => answerApproval(row, input),
};

export async function decideHandoff(
  input: {
    /** The step's id, or a link given before links were addressed by id. */
    id: string;
    decision: "approve" | "refuse";
    reason?: string;
    revision: number;
    /** The kind's digest of what the page showed. */
    shown: string;
    /** The page's box, "I have read what Louez will do", was ticked. */
    acknowledged?: boolean;
    userId: string;
  },
  ports: Pick<ApiPorts, "team" | "afterCommit">,
  now = new Date(),
): Promise<HandoffDecided> {
  const checked = await readHandoffLink(input.id, input.userId, now);
  if (!checked.ok) throw handoffErrors.decisionInvalid(checked.reason);
  const { row } = checked;
  const answer = ANSWERS[row.kind];
  if (!answer || !decisionScopeOf(row)) throw handoffErrors.decisionInvalid("invalid");
  // Read before the kind's lock: a repeated request that changes what the
  // approval asks raises its revision, which the kind compares under it.
  if (input.decision === "approve" && !input.acknowledged && approvalAsksToTick(row)) {
    throw handoffErrors.decisionInvalid("not_acknowledged");
  }
  return answer(
    row,
    {
      decision: input.decision,
      reason: decisionReason(input.reason),
      revision: input.revision,
      shown: input.shown,
      userId: input.userId,
    },
    ports,
    now,
  );
}
