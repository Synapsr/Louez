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

/**
 * The one case where an approval carried out ends in a failure: a refund through Stripe,
 * which Stripe may still refuse after the person approved (a dispute opened meanwhile, a
 * balance too low). Said by the refund's tool, its reference and here.
 */
export const STRIPE_MAY_STILL_REFUSE =
  "Even once approved, Stripe may still refuse the refund (a dispute opened meanwhile, a balance too low): it then answers failed with the reason, the approval is spent, and nothing else changes.";

/** The reference's sentences, after what the first call answers with: for a developer. */
export const restApprovalAsked = (preview: string) =>
  `It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 \`APPROVAL_REQUIRED\` with ${preview} and \`data.details.approval.url\`, a Louez page where the key's owner, signed in, approves or refuses within ${APPROVAL_DECIDE_TIME}. \`GET /handoffs/{id}\`, with the approval's id, says where it stands; read it every ${APPROVAL_POLL_SECONDS} seconds or more. Once it is approved, the same request with the approval's id in \`Louez-Confirmation\` carries it out, once, within ${APPROVAL_EXECUTE_TIME} and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 \`APPROVAL_DECLINED\`. For 412 \`APPROVAL_INVALID\`, check \`details.reason\` before retrying: \`used\` means the action already ran; \`approver_not_allowed\` means someone allowed must act in Louez; \`expired\` or \`state_changed\` requires a new preview, requested without \`Louez-Confirmation\`; \`other_request\` requires this request's approval, or a new approval. Too many approval requests answers 429 \`APPROVALS_FULL\`, with \`Retry-After\`. The guide's "Approvals" section describes each answer.`;

/**
 * What the in-app assistant's tools tell its model of the same flow, in a
 * chat: the person decides on a card the chat shows, which opens the
 * approval's page, and the chat tells the model once they approved. Facts
 * and the one next step, never an instruction to call again and again: the
 * model waits for the person, who is in the conversation.
 */
export const ASSISTANT_APPROVAL_TEXTS = {
  required: `Nothing was done yet. The chat shows the person a card that opens Louez's approval page, where they approve or refuse it within ${APPROVAL_DECIDE_TIME}. Tell them in one sentence what you prepared and that it waits for their decision on the card. Never say it is recorded, and never ask them for the approval's id: the chat tells you when they approved.`,
  pending:
    "The person has not decided yet, and nothing was done. Do not call this again: tell them it waits for their decision on the card.",
  approved: `The person already approved this exact request, and nothing was done yet. Call this tool once more with these same arguments and this approvalId to carry it out, within ${APPROVAL_EXECUTE_TIME}.`,
  declined:
    "The person refused it, and nothing was done. Do not ask again unless they ask you to; their words, if any, are in reason.",
  recentlyDeclined: `The person refused this same request a moment ago, and nothing was done. It cannot be asked again within ${APPROVAL_COOL_DOWN_TIME} unless something about it changes.`,
  full: "Too many approval requests are waiting in this store, and nothing was done. Tell the person to decide or let the waiting ones lapse before asking for another.",
  invalid: {
    used: "This approval was already used: the action ran once, and this call did nothing. Read the reservation's payments before saying anything else about it.",
    expired:
      "This approval lapsed, and nothing was done. If the person still wants it, call this tool again without approvalId to prepare a new request.",
    state_changed:
      "The store, or these arguments, changed since the person approved, so the approval no longer lets it run, and nothing was done. If they still want it, call this tool again without approvalId to prepare a new request with the figures as they are now.",
    approver_not_allowed:
      "The person who approved may no longer do this in the store, so nothing was done. Tell them; someone allowed must do it in Louez.",
    other_request:
      "This approval is not for this request, and nothing was done. Never make up an approvalId: use only the one the chat gave you for these same arguments, or call without it to prepare a new request.",
  },
} as const;
