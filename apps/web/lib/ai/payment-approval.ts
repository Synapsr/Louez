import { ORPCError } from "@louez/api";
import { ASSISTANT_APPROVAL_TEXTS } from "@louez/api/platform/approval-help";
import type { ApprovalInvalidReason } from "@louez/api/platform/errors";
import { displayName, oneLine } from "@louez/api/services/approval-preview";

import { APPROVAL_ID_PATTERN, CARD_SUMMARY_MAX } from "./approval-card";

/**
 * What the assistant's payment tools answer when the payment procedure asks
 * the person's approval, or refuses the approval a call presents
 * (docs/architecture/api-and-agents.md, "A person's approval"): a result
 * the model reads, never an error thrown at it, and the card the chat draws
 * from an `approval_required` one. The procedure decides; this only says
 * what it decided, with the chat's texts (`ASSISTANT_APPROVAL_TEXTS`).
 */

export type ApprovalToolResult =
  | {
      status: "approval_required";
      approvalId: string;
      /** The approval's page, absolute: the card opens it. */
      url: string;
      /** The preview's one-line summary, as the approval stores it. */
      summary: string;
      /** The amount the preview names, a plain decimal, or null. */
      amount: string | null;
      /** The booking's number the preview names, or null. */
      bookingNumber: string | null;
      expiresAt: string;
      message: string;
    }
  | { status: "approved"; approvalId: string; message: string }
  | { status: "pending"; approvalId: string | null; message: string }
  | { status: "declined"; reason: string | null; message: string }
  | { status: "expired"; message: string }
  | {
      status: "invalid";
      reason: Exclude<ApprovalInvalidReason, "expired">;
      message: string;
    }
  | { status: "unavailable"; message: string };

type Data = { code?: unknown; details?: Record<string, unknown> };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A summary on one line, cut at `CARD_SUMMARY_MAX` characters with an ellipsis. */
function cardSummary(raw: unknown): string {
  const characters = [...oneLine(text(raw) ?? "")];
  return characters.length <= CARD_SUMMARY_MAX
    ? characters.join("")
    : `${characters
        .slice(0, CARD_SUMMARY_MAX - 1)
        .join("")
        .trimEnd()}…`;
}

/** A decimal as the payment previews write it, else nothing. */
const plainAmount = (raw: unknown): string | null => {
  const value = text(raw)?.trim() ?? "";
  return /^-?\d{1,10}(?:\.\d{1,4})?$/.test(value) ? value : null;
};

/** A booking's number, on one line and short, else nothing. */
const shortNumber = (raw: unknown): string | null => {
  const value = text(raw);
  if (value === null) return null;
  const shown = displayName(value);
  return shown.length > 0 ? shown : null;
};

const INVALID: readonly ApprovalInvalidReason[] = [
  "used",
  "expired",
  "state_changed",
  "approver_not_allowed",
  "other_request",
];

/**
 * The platform's answer to an approval as the chat says it, or null for any
 * other error (the tool's own refusals, or one to throw). Each reads the
 * answer's code and its details, and nothing a model wrote.
 */
export function approvalResultOf(error: unknown): ApprovalToolResult | null {
  if (!(error instanceof ORPCError)) return null;
  const data = record(error.data) as Data;
  const details = record(data.details);
  const texts = ASSISTANT_APPROVAL_TEXTS;
  switch (data.code) {
    case "APPROVAL_REQUIRED": {
      const approval = record(details.approval);
      const id = text(approval.id);
      if (!id || !APPROVAL_ID_PATTERN.test(id)) return null;
      if (approval.status === "approved") {
        // Approved, and this call is not the one approved: nothing runs.
        return approval.stillAsApproved === true
          ? { status: "approved", approvalId: id, message: texts.approved }
          : { status: "invalid", reason: "other_request", message: texts.invalid.other_request };
      }
      const preview = record(details.preview);
      const shown = record(preview.details);
      return {
        status: "approval_required",
        approvalId: id,
        url: text(approval.url) ?? "",
        summary: cardSummary(preview.summary),
        amount: plainAmount(shown.amount),
        bookingNumber: shortNumber(shown.number),
        expiresAt: text(approval.expiresAt) ?? "",
        message: texts.required,
      };
    }
    case "APPROVAL_PENDING": {
      const id = text(record(details.approval).id);
      return {
        status: "pending",
        approvalId: id && APPROVAL_ID_PATTERN.test(id) ? id : null,
        message: texts.pending,
      };
    }
    case "APPROVAL_DECLINED":
      return {
        status: "declined",
        reason: text(details.reason) ? oneLine(text(details.reason) ?? "") : null,
        message: texts.declined,
      };
    case "APPROVAL_RECENTLY_DECLINED":
      return { status: "declined", reason: null, message: texts.recentlyDeclined };
    case "APPROVALS_FULL":
      return { status: "unavailable", message: texts.full };
    case "APPROVAL_INVALID": {
      const reason = INVALID.find((known) => known === details.reason) ?? "other_request";
      if (reason === "expired") return { status: "expired", message: texts.invalid.expired };
      return { status: "invalid", reason, message: texts.invalid[reason] };
    }
    default:
      return null;
  }
}
