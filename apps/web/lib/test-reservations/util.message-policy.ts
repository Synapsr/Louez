/**
 * The pure rules of a test reservation's messages (message-policy.ts).
 */

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
