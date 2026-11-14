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

/**
 * A value of the preview's details, as a page writes it: the kind is read
 * from the value itself, the page formats it in its own locale.
 */
export type ShownValue =
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  | { kind: "yes" }
  | { kind: "no" }
  /** An ISO date (`dateOnly`) or date-time, which the page writes in the store's time zone. */
  | { kind: "date"; iso: string; dateOnly: boolean }
  /** A number in a group that names its currency: an amount in that currency. */
  | { kind: "money"; amount: number; currency: string }
  /** An object, or a list, as a titled group of entries. */
  | { kind: "group"; entries: ShownDetail[] };

/** One entry of the preview's details; an empty label for a value with no name. */
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
 * subdivision flag (England's) shows as a black flag. The object replacement
 * character (U+FFFC), which stands for an object the text does not hold and
 * draws nothing readable, goes with them.
 */
const IGNORABLE = /[\p{Default_Ignorable_Code_Point}\ufffc]/gu;

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
 * ellipsis (`truncated`), and its details as a person reads them
 * (`shownValue`): each string on one line, dates, amounts, numbers and
 * yes or no told apart for the page to write in its locale, nothing empty,
 * no technical identifier, the names of the details spelled out
 * ("turnoverBuffer" reads "Turnover buffer"). The details come in the order
 * the database keeps a JSON object's keys (MySQL sorts them by length), not
 * the order the procedure wrote them. Null when it has no summary to show.
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
  if (isRecord(details)) return { ...shown, details: entriesOf(details, 1) };
  const value = shownValue(details, 1);
  return { ...shown, details: value ? [{ label: "", value }] : [] };
}

/**
 * The fewest letters or digits a summary holds to say anything: a word of
 * three letters in any script (an ideograph is a letter), while a run of
 * joiners, variation selectors or symbols holds none.
 */
export const VISIBLE_MIN = 3;

/**
 * The most combining marks one character carries in the scripts Louez's
 * stores write in: Vietnamese stacks two (ệ, ở), Thai two or three (a vowel
 * and a tone mark above a consonant), Arabic with harakat two or three
 * (shadda with a vowel, sometimes a small alef), Hebrew with points up to
 * four with cantillation. Past that, the marks draw above and below the line
 * over what surrounds them.
 */
export const MARK_RUN_MAX = 4;
const MARK_RUN = new RegExp(String.raw`\p{M}{${MARK_RUN_MAX + 1},}`, "u");
const VISIBLE = /[\p{L}\p{N}]/gu;

/** Whether a text draws within its line: no character carries more marks than `MARK_RUN_MAX`. */
const staysOnItsLine = (text: string) => !MARK_RUN.test(text);

/** Whether every label and text value of the details stays on its line. */
const detailsStayOnTheirLines = (entries: readonly ShownDetail[]): boolean =>
  entries.every(
    ({ label, value }) =>
      staysOnItsLine(label) &&
      (value.kind === "text"
        ? staysOnItsLine(value.text)
        : value.kind === "group"
          ? detailsStayOnTheirLines(value.entries)
          : true),
  );

/**
 * Whether an approval can be approved: its page shows its preview whole and
 * readable. A sentence within `SUMMARY_MAX`, holding at least `VISIBLE_MIN`
 * letters or digits once on one line (a summary of joiners, variation
 * selectors or U+FFFC shows nothing), and no character in it or in the
 * details carrying more than `MARK_RUN_MAX` combining marks. One that is not
 * is `unreadable` on its page, and its decision refuses an approval of it
 * under its lock; refusing it stays possible.
 */
export function approvalIsReadable(payload: { preview?: unknown } | null | undefined): boolean {
  const preview = shownPreview(payload?.preview);
  if (preview === null || preview.truncated) return false;
  if ((preview.summary.match(VISIBLE) ?? []).length < VISIBLE_MIN) return false;
  return staysOnItsLine(preview.summary) && detailsStayOnTheirLines(preview.details);
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

/** Past four levels of groups, a value is shown as its JSON text. */
const MAX_DEPTH = 4;

/**
 * The keys of technical identifiers and digests, never shown: a record is
 * named by its number or its name, which the preview carries next to them.
 */
const HIDDEN_KEY = /^id$|Id$|_id$|Hash$|_hash$/;

/** The keys an item of a list is named by, when it has one: its group's title. */
const NAME_KEYS = ["name", "title", "label", "productName", "product"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const DECIMAL = /^-?\d+\.\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An amount next to a currency: a finite number, or a decimal written as text ("180.00"). */
const amountOf = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && DECIMAL.test(value.trim())) return Number(value.trim());
  return null;
};

/**
 * An object's entries, as a page shows them: technical identifiers left
 * out, empty values left out, and, in an object that names its currency,
 * every amount an amount of money in it (the currency itself then said by
 * the amounts).
 */
function entriesOf(record: Record<string, unknown>, depth: number): ShownDetail[] {
  const code = typeof record.currency === "string" ? record.currency.trim() : "";
  const currency = CURRENCY.test(code) ? code.toUpperCase() : null;
  const entries: ShownDetail[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (HIDDEN_KEY.test(key) || (currency && key === "currency")) continue;
    const amount = currency ? amountOf(value) : null;
    const shown: ShownValue | null =
      currency && amount !== null
        ? { kind: "money", amount, currency }
        : shownValue(value, depth + 1);
    if (shown) entries.push({ label: labelOf(key), value: shown });
  }
  return entries;
}

/** A value as a page shows it, or null when there is nothing to show (empty, or only identifiers). */
function shownValue(value: unknown, depth: number): ShownValue | null {
  if (value === null || value === undefined) return null;
  if (value === true) return { kind: "yes" };
  if (value === false) return { kind: "no" };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "number", value } : { kind: "text", text: String(value) };
  }
  if (typeof value === "bigint") return { kind: "text", text: String(value) };
  if (typeof value === "string") return textValue(value);
  if (depth > MAX_DEPTH) return textValue(JSON.stringify(value) ?? "");
  if (Array.isArray(value)) {
    const entries = value.flatMap((item, index): ShownDetail[] => {
      const named = isRecord(item) ? NAME_KEYS.find((key) => typeof item[key] === "string") : undefined;
      const title = named && isRecord(item) ? oneLine(String(item[named])) : "";
      if (named && title && isRecord(item)) {
        const { [named]: _name, ...rest } = item;
        const group = entriesOf(rest, depth + 1);
        return [{ label: title, value: { kind: "group", entries: group } }];
      }
      const shown = shownValue(item, depth + 1);
      return shown ? [{ label: String(index + 1), value: shown }] : [];
    });
    return entries.length > 0 ? { kind: "group", entries } : null;
  }
  if (isRecord(value)) {
    const entries = entriesOf(value, depth);
    return entries.length > 0 ? { kind: "group", entries } : null;
  }
  return textValue(String(value));
}

/** A text on one line: a date when it is one, nothing when it is empty. */
function textValue(raw: string): ShownValue | null {
  const text = oneLine(raw);
  if (text === "") return null;
  if (ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))) {
    return { kind: "date", iso: text, dateOnly: true };
  }
  if (ISO_DATE_TIME.test(text) && !Number.isNaN(Date.parse(text))) {
    return { kind: "date", iso: text, dateOnly: false };
  }
  return { kind: "text", text };
}

/**
 * A detail's name spelled out, abbreviations kept: "turnoverBufferMinutes"
 * reads "Turnover buffer minutes", "reservation_number" "Reservation
 * number", "vatID" "Vat ID" and "productSKU" "Product SKU".
 */
function labelOf(key: string): string {
  const words = oneLine(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
