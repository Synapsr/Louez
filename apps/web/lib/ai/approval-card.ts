/**
 * The chat's side of a payment the in-app assistant prepared: the card drawn
 * from the tool's `approval_required` result, where the person's request
 * stands, and the turn the chat sends once they approved it. Pure and
 * without dependencies: the tools (lib/ai/payment-approval.ts) and the chat's
 * components share it. The decision itself is the approval page's, recorded
 * by the server: nothing here decides, and the card only links to the page.
 */

/** The payment tools that need the person's approval, by the name the chat shows them under. */
export const PAYMENT_APPROVAL_TOOLS = [
  "record_payment",
  "delete_payment",
  "return_deposit",
] as const;
export type PaymentApprovalTool = (typeof PAYMENT_APPROVAL_TOOLS)[number];

const isPaymentApprovalTool = (name: string): name is PaymentApprovalTool =>
  (PAYMENT_APPROVAL_TOOLS as readonly string[]).includes(name);

/** An approval's id, as the platform makes it: what the card's link and a later call carry. */
export const APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

/** The most of the stored summary the card shows, in characters, on one line. */
export const CARD_SUMMARY_MAX = 280;

/** The most characters of a booking's number the card shows. */
export const CARD_NUMBER_MAX = 40;

/** What the card shows of a request, and what the follow-up turn needs. */
export interface ApprovalCard {
  approvalId: string;
  tool: PaymentApprovalTool;
  summary: string;
  amount: string | null;
  bookingNumber: string | null;
  expiresAt: Date | null;
  /** The tool's arguments as the model sent them, without an approval id: the follow-up repeats them. */
  arguments: Record<string, unknown>;
}

/** The approval's page, on this app: the card's one button opens it. */
export const approvalPagePath = (approvalId: string) =>
  `/handoffs/${encodeURIComponent(approvalId)}`;

/** Blank runs one space, controls and invisible formatting characters removed, on one line. */
const flat = (raw: string) =>
  raw
    .replace(/[\p{White_Space}⠀ㅤ]+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();

/** On one line, cut at `max` characters with an ellipsis. */
function shortened(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const characters = [...flat(raw)];
  if (characters.length === 0) return null;
  return characters.length <= max
    ? characters.join("")
    : `${characters
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

const AMOUNT = /^-?\d{1,10}(?:\.\d{1,4})?$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The card of a tool part, or null for anything but a payment tool's
 * `approval_required` result. Each value is read as the server's tool wrote
 * it and checked again here, as the part travels through the browser: an id
 * that is an approval's, a summary on one line and bounded, an amount that
 * is a plain decimal, a short number. Nothing else of the part is shown.
 */
export function approvalCardOf(part: {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}): ApprovalCard | null {
  if (!part.type.startsWith("tool-") || part.state !== "output-available") return null;
  const tool = part.type.slice("tool-".length);
  if (!isPaymentApprovalTool(tool)) return null;
  const output = record(part.output);
  if (!output || output.status !== "approval_required") return null;
  const id = output.approvalId;
  if (typeof id !== "string" || !APPROVAL_ID_PATTERN.test(id)) return null;
  const summary = shortened(output.summary, CARD_SUMMARY_MAX);
  if (!summary) return null;
  const amount =
    typeof output.amount === "string" && AMOUNT.test(output.amount) ? output.amount : null;
  const expires = typeof output.expiresAt === "string" ? new Date(output.expiresAt) : null;
  const { approvalId: _presented, ...args } = record(part.input) ?? {};
  return {
    approvalId: id,
    tool,
    summary,
    amount,
    bookingNumber: shortened(output.bookingNumber, CARD_NUMBER_MAX),
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
    arguments: args,
  };
}

/** Where the person's request stands, as the card says it. */
export type ApprovalCardStatus =
  | "pending"
  | "approved"
  | "completed"
  | "declined"
  | "expired"
  | "ended";

/**
 * The card's status from the request as the person's own session reads it
 * (`dashboard.handoffs.get`): its status, and why it failed.
 */
export function approvalCardStatus(
  view: { status: string; failure?: { code: string } | null } | null | undefined,
): ApprovalCardStatus {
  switch (view?.status) {
    case undefined:
    case "pending":
    case "opened":
      return "pending";
    case "approved":
      return "approved";
    case "completed":
      return "completed";
    case "expired":
      return "expired";
    case "failed":
      return view.failure?.code === "declined" ? "declined" : "ended";
    default:
      return "ended";
  }
}

/** Whether the card reads its request again: until it is over. */
export const approvalCardWaits = (status: ApprovalCardStatus) =>
  status === "pending" || status === "approved";

/**
 * How often the card reads a request while it waits, at most: the interval
 * the platform asks of a caller that waits for an approval
 * (`APPROVAL_POLL_SECONDS`, platform/errors.ts). The card also reads it
 * when the chat's tab comes back to the front.
 */
export const APPROVAL_CARD_POLL_MS = 30_000;

/**
 * The turn the chat sends once the person approved: it lets the model call
 * the tool once more with the very arguments it prepared, and the approval's
 * id. It names the request, it decides nothing: the procedure carries out
 * only an approval the person gave for these arguments, once.
 */
export function approvalFollowUp(card: ApprovalCard): string {
  const call = { ...card.arguments, approvalId: card.approvalId };
  return `Approved in Louez (request ${card.approvalId}). Call ${card.tool} once with exactly these arguments to carry it out, then tell me the result: ${JSON.stringify(call)}`;
}

/**
 * Whether a message is a follow-up turn this chat sent (`approvalFollowUp`),
 * shown as one quiet line: a user turn whose id the chat generated and kept
 * when it sent it (`sent`), never a message recognised by its text, and
 * never the assistant's.
 */
export const isChatFollowUp = (
  message: { id: string; role: string },
  sent: ReadonlySet<string>,
): boolean => message.role === "user" && sent.has(message.id);
