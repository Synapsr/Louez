import { APPROVAL_POLL_SECONDS } from "./errors";
import { APPROVAL_COOL_DOWN_MS } from "../services/approvals";
import { APPROVAL_DECIDE_HOURS, APPROVAL_EXECUTE_HOURS } from "../services/handoffs";

/**
 * What the description of an action a person must approve says of the flow
 * (docs/architecture/api-and-agents.md, "The flow, by transport"): the
 * tool's text, for a model, and the reference's, for a developer. Each
 * procedure that declares `personApproval` says it with these, naming what
 * its preview shows; the numbers are the approval's own (`APPROVAL_*` in
 * services/handoffs.ts and platform/errors.ts).
 */

const hours = (count: number) => (count === 1 ? "an hour" : `${count} hours`);

/**
 * How long the person has to decide, how long the agent has to carry the
 * action out once approved, and how long a refused request is refused again.
 */
export const APPROVAL_DECIDE_TIME = hours(APPROVAL_DECIDE_HOURS);
export const APPROVAL_EXECUTE_TIME = hours(APPROVAL_EXECUTE_HOURS);
export const APPROVAL_COOL_DOWN_TIME = hours(APPROVAL_COOL_DOWN_MS / 3_600_000);

/**
 * The tool's sentences, after what the first call answers with (`preview`,
 * such as "a preview of the payment"). Facts, never orders: the server's
 * instructions say how to chain the tools.
 */
export const approvalAsked = (preview: string) =>
  `A connection needs the user's approval for it, whatever its confirmation setting: the first call does nothing and answers APPROVAL_REQUIRED with ${preview} and approval.url, a Louez page where the user, signed in, approves or refuses within ${APPROVAL_DECIDE_TIME}. handoffs_get with the approval's id says where it stands (pending, approved, completed, failed or expired). Once it is approved, the same arguments with the approval's id as confirmationToken carry it out, once, within ${APPROVAL_EXECUTE_TIME} and while the store is still as the preview showed. The action's own refusals (a record not found, a balance exceeded) answer first, so an approval's answer comes only for a call that could otherwise still run. A refusal answers APPROVAL_DECLINED. For APPROVAL_INVALID, check details.reason: used means the action already ran, so read the record before acting again; approver_not_allowed means someone allowed must act in Louez; expired or state_changed requires a new preview, requested with the same call without confirmationToken; other_request requires this request's approval, or a new approval.`;

/** The reference's sentences, after what the first call answers with: for a developer. */
export const restApprovalAsked = (preview: string) =>
  `It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 \`APPROVAL_REQUIRED\` with ${preview} and \`data.details.approval.url\`, a Louez page where the key's owner, signed in, approves or refuses within ${APPROVAL_DECIDE_TIME}. \`GET /handoffs/{id}\`, with the approval's id, says where it stands; read it every ${APPROVAL_POLL_SECONDS} seconds or more. Once it is approved, the same request with the approval's id in \`Louez-Confirmation\` carries it out, once, within ${APPROVAL_EXECUTE_TIME} and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 \`APPROVAL_DECLINED\`. For 412 \`APPROVAL_INVALID\`, check \`details.reason\` before retrying: \`used\` means the action already ran; \`approver_not_allowed\` means someone allowed must act in Louez; \`expired\` or \`state_changed\` requires a new preview, requested without \`Louez-Confirmation\`; \`other_request\` requires this request's approval, or a new approval. Too many approval requests answers 429 \`APPROVALS_FULL\`, with \`Retry-After\`. The guide's "Approvals" section describes each answer.`;
