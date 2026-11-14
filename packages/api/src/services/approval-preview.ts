import { plainText } from "../contracts/handoffs";
import { isConsequence, type Consequence } from "../platform/approval-rule";

/**
 * What an operation's approval shows a person of the preview Louez stored,
 * and the two rules that follow from it, each in one place: whether it can
 * be approved at all (`approvalIsReadable`), and whether approving asks for
 * the box "I have read what Louez will do" (`approvalAsksToTick`). The
 * approval's page (services/approval-page.ts), the decision's dispatch
 * (services/handoff-decisions.ts) and the decision under its lock
 * (`answerApproval`, services/approvals.ts) all read them from here.
 */

/** A value of the preview's details, as text a page shows. */
export type ShownValue =
  | { kind: "text"; text: string }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "none" }
  | { kind: "list"; entries: ShownDetail[] };

/** One line of the preview's details; an empty label for a value with no name. */
export interface ShownDetail {
  label: string;
  value: ShownValue;
}

export interface ShownPreview {
  /** One line, at most `SUMMARY_MAX` characters, an ellipsis last when it was cut. */
  summary: string;
  /** The stored summary was longer than `SUMMARY_MAX`: the page cannot show it whole. */
  truncated: boolean;
  details: ShownDetail[];
}

/** The most of a summary the page shows, in characters, once on one line (`oneLine`). */
export const SUMMARY_MAX = 1_000;

/**
 * Every character that renders as blank space: Unicode's white space (line
 * breaks, tabs, the line and paragraph separators, the no-break and
 * ideographic spaces…), and the blank characters it does not call white
 * space: the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0) and the
 * braille blank (U+2800). A run of them is one space.
 */
const BLANK = /[\p{White_Space}\u115f\u1160\u3164\uffa0\u2800]+/gu;

/**
 * Unicode's default-ignorable characters, which render as nothing (the
 * zero-width space, the word joiner, the byte order mark, the soft hyphen,
 * the tag characters…), removed, never made a space: but the ones that
 * shape text, kept: the zero-width non-joiner and joiner (U+200C, U+200D),
 * which join or part letters in several scripts and join the members of a
 * family emoji into one, and the variation selectors (U+FE00 to U+FE0F,
 * U+E0100 to U+E01EF), which choose a character's form (a heart drawn as an
 * emoji). Both draw nothing of their own. The tag characters go: an emoji
 * subdivision flag (England's) shows as a black flag.
 */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** The default-ignorable characters that shape text, kept: ZWNJ, ZWJ and the variation selectors. */
const shapesText = (character: string) => {
  const code = character.codePointAt(0) ?? 0;
  return (
    code === 0x200c ||
    code === 0x200d ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  );
};

/**
 * Text as one line of plain text (`plainText`): every run of blank
 * characters one space, every default-ignorable character but the ones that
 * shape text removed. Text from the store's records (a customer's name) then
 * cannot draw lines, or blank space, of its own inside what Louez says.
 */
export const oneLine = (raw: string) =>
  plainText(raw)
    .replace(BLANK, " ")
    .replace(IGNORABLE, (character) => (shapesText(character) ? character : ""))
    .replace(/ {2,}/g, " ")
    .trim();

/**
 * The stored preview as text, whatever it holds: its summary on one line,
 * cut at `SUMMARY_MAX` characters, counted once on one line, with an
 * ellipsis (`truncated`), and its details, each string on one line,
 * numbers written as JavaScript writes them, the names of the details
 * spelled out ("reservationId" reads "Reservation id"). The details come in
 * the order the database keeps a JSON object's keys (MySQL sorts them by
 * length), not the order the procedure wrote them. Null when it has no
 * summary to show.
 */
export function shownPreview(stored: unknown): ShownPreview | null {
  if (!isRecord(stored)) return null;
  const { summary, details } = stored;
  if (typeof summary !== "string") return null;
  const characters = [...oneLine(summary)];
  if (characters.length === 0) return null;
  const truncated = characters.length > SUMMARY_MAX;
  const text = truncated
    ? `${characters.slice(0, SUMMARY_MAX - 1).join("").trimEnd()}…`
    : characters.join("");
  const shown = { summary: text, truncated };
  if (details === undefined || details === null) return { ...shown, details: [] };
  if (isRecord(details)) return { ...shown, details: entriesOf(details, 1) };
  return { ...shown, details: [{ label: "", value: shownValue(details, 1) }] };
}

/**
 * Whether an approval can be approved: its page shows its preview whole (a
 * sentence, within `SUMMARY_MAX`). One that cannot is `unreadable` on its
 * page, and its decision refuses an approval of it under its lock; refusing
 * it stays possible.
 */
export function approvalIsReadable(payload: { preview?: unknown } | null | undefined): boolean {
  const preview = shownPreview(payload?.preview);
  return preview !== null && !preview.truncated;
}

/** The consequences that are not a plain change the store can put back. */
const ASK_TO_TICK: ReadonlySet<Consequence> = new Set([
  "money",
  "stock_override",
  "access_removed",
  "deletion",
  "customer_message",
  "credits",
]);

/**
 * Whether approving asks for the box, from the consequences as stored: it
 * does unless they are a non-empty list in which every entry is a
 * consequence Louez knows and none asks for it. A missing or empty list, or
 * any entry Louez does not know (`["change", {}]`), asks for it: a partly
 * malformed list is never read as a plain change.
 */
export function approvalAsksToTick(stored: unknown): boolean {
  if (!Array.isArray(stored) || stored.length === 0) return true;
  if (!stored.every(isConsequence)) return true;
  return stored.some((consequence) => ASK_TO_TICK.has(consequence));
}

/** The consequences as stored that Louez knows, once each, for the page to name. */
export const knownConsequences = (stored: unknown): Consequence[] =>
  Array.isArray(stored) ? [...new Set(stored.filter(isConsequence))] : [];

/** Past four levels of lists, a value is shown as its JSON text. */
const MAX_DEPTH = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function entriesOf(record: Record<string, unknown>, depth: number): ShownDetail[] {
  return Object.entries(record).map(([key, value]) => ({
    label: labelOf(key),
    value: shownValue(value, depth + 1),
  }));
}

function shownValue(value: unknown, depth: number): ShownValue {
  if (value === null || value === undefined) return { kind: "none" };
  if (value === true) return { kind: "yes" };
  if (value === false) return { kind: "no" };
  if (typeof value === "string") return { kind: "text", text: oneLine(value) };
  if (typeof value === "number" || typeof value === "bigint") {
    return { kind: "text", text: String(value) };
  }
  if (depth > MAX_DEPTH) return { kind: "text", text: oneLine(JSON.stringify(value) ?? "") };
  if (Array.isArray(value)) {
    return {
      kind: "list",
      entries: value.map((entry, index) => ({
        label: String(index + 1),
        value: shownValue(entry, depth + 1),
      })),
    };
  }
  if (isRecord(value)) return { kind: "list", entries: entriesOf(value, depth) };
  return { kind: "text", text: oneLine(String(value)) };
}

/** A detail's name spelled out: "reservationId" and "reservation_id" read "Reservation id". */
function labelOf(key: string): string {
  const words = oneLine(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
