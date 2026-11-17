/**
 * The pure rules of a test reservation's messages (message-policy.ts).
 */

import type { TestEmailMark } from "./email-mark";

/**
 * What a message's reservation says of it, read when the message goes out:
 * - `real`: no reservation, or an ordinary one; sent as it is;
 * - `missing`: the reservation is gone (only a test reservation is ever deleted,
 *   by its purge); nothing is sent;
 * - `test`: e-mails only, marked, to the member who started the test.
 */
export type ReservationMessagePolicy =
  | { kind: "real" }
  | { kind: "missing" }
  | { kind: "test"; mark: TestEmailMark };

/** What a send made once (the dispatchers) may do. */
export interface DispatchPlan {
  /** Whether anything goes out at all. */
  send: boolean;
  /** Only the e-mail: no SMS, push, Discord or platform notice. */
  emailOnly: boolean;
  /** The test mark and recipient of its e-mails, or null to send them as they are. */
  mark: TestEmailMark | null;
}

/**
 * The plan of a one-shot send. A policy that could not be read (`unknown`) still
 * sends the e-mail, as it is, rather than lose a real customer's or owner's
 * message, but nothing else: an SMS, a push or a Discord message to someone a test
 * must never reach costs more than one e-mail that lacks its mark.
 */
export function planDispatch(policy: ReservationMessagePolicy | "unknown"): DispatchPlan {
  if (policy === "unknown") return { send: true, emailOnly: true, mark: null };
  switch (policy.kind) {
    case "real":
      return { send: true, emailOnly: false, mark: null };
    case "missing":
      return { send: false, emailOnly: true, mark: null };
    case "test":
      return { send: true, emailOnly: true, mark: policy.mark };
  }
}

/** What an outbox row does: skipped, or sent with or without the test mark. */
export type OutboxRowPlan =
  | { send: false; reason: string }
  | { send: true; mark: TestEmailMark | null };

/** The plan of an outbox row, from its reservation's policy, its type and its payload. */
export function planOutboxRow(
  policy: ReservationMessagePolicy,
  type: string,
  payload: unknown,
): OutboxRowPlan {
  switch (policy.kind) {
    case "real":
      return { send: true, mark: null };
    case "missing":
      return { send: false, reason: "the reservation is gone" };
    case "test":
      return isWithheldForTestReservation(type, payload)
        ? { send: false, reason: "a test reservation sends e-mails only" }
        : { send: true, mark: policy.mark };
  }
}

/** Outbox rows a test reservation never sends: platform notices and analytics. */
const NEVER_SENT_FOR_TEST: ReadonlySet<string> = new Set([
  "reservation.platformNotification",
  "reservation.createdPlatformNotification",
  "reservation.statusAnalytics",
  "reservation.notesAnalytics",
]);

/**
 * Whether a test reservation's outbox row stays unsent: a platform notice, an
 * analytics event, an SMS (its credit included), or any channel but e-mail (the
 * customer's SMS, the store's SMS, push and Discord).
 */
export function isWithheldForTestReservation(type: string, payload: unknown): boolean {
  if (NEVER_SENT_FOR_TEST.has(type) || type.startsWith("sms.")) return true;
  const channel =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, "channel") : undefined;
  return typeof channel === "string" && channel !== "email";
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const BANNER_MARKER = 'data-test-reservation="1"';

const bannerHtml = (text: string): string =>
  `<div ${BANNER_MARKER} style="background-color:#fff4e5;border-bottom:1px solid #f5c27a;color:#7a4a00;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;line-height:20px;padding:12px 16px;text-align:center">${escapeHtml(text)}</div>`;

/** Puts the banner first in the e-mail's body, once. */
export function addTestReservationBanner(html: string, text: string): string {
  if (html.includes(BANNER_MARKER)) return html;
  const body = /<body[^>]*>/i.exec(html);
  if (!body) return bannerHtml(text) + html;
  const at = body.index + body[0].length;
  return html.slice(0, at) + bannerHtml(text) + html.slice(at);
}

/** Prefixes the subject, once. */
export function addTestReservationSubjectPrefix(subject: string, prefix: string): string {
  return subject.startsWith(prefix) ? subject : `${prefix}${subject}`;
}
