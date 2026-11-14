import { decisionReason, handoffErrors, type HandoffKind } from "../contracts/handoffs";
import type { ApiPorts } from "../platform/ports";
import { HANDOFF_DECISION_SCOPES, readHandoffLink } from "./handoffs";
import { answerInvitation } from "./team";

/**
 * A person's answer on a step's page (`handoffs.decide`). One procedure for
 * every kind a person decides: it checks whose step it is first (another
 * signed-in user gets `other_user` and nothing else), then that the user may
 * still decide it (`mayActOnStep`, by `mayApprove`), the step neither ended
 * nor expired, then hands the answer to its kind. A kind with no decision on
 * its page (a provider's step) is refused. Each kind holds its own fences,
 * compared under the store's lock: the revision and what the page showed.
 */

/** What answering a step did: the step, the decision, and what approving it carried out. */
export interface HandoffDecided {
  handoffId: string;
  decision: "approved" | "refused";
  outcome: "invited" | "added" | null;
  effectIds: string[];
}

/** How each kind decided on its page takes the answer; the other kinds have none. */
const ANSWERS: Partial<Record<HandoffKind, typeof answerInvitation>> = {
  team_invitation: answerInvitation,
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
    userId: string;
  },
  ports: Pick<ApiPorts, "team" | "afterCommit">,
  now = new Date(),
): Promise<HandoffDecided> {
  const checked = await readHandoffLink(input.id, input.userId, now);
  if (!checked.ok) throw handoffErrors.decisionInvalid(checked.reason);
  const { row } = checked;
  const answer = ANSWERS[row.kind];
  if (!answer || !HANDOFF_DECISION_SCOPES[row.kind]) throw handoffErrors.decisionInvalid("invalid");
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
