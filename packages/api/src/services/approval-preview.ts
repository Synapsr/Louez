import { z } from "zod";

import { plainText } from "../contracts/handoffs";
import { isConsequence, type Consequence } from "../platform/approval-rule";
import {
  CHOICES,
  FACTS,
  FACTS_MAX,
  HEADLINES,
  isChoice,
  type ChoiceList,
  type DisplayValue,
  type FactKey,
  type HeadlineKey,
} from "./approval-display";

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
const MARK = /\p{M}/gu;
const VISIBLE = /[\p{L}\p{N}]/gu;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The combining marks one character carries, as a person sees a character
 * (a grapheme cluster): every mark of the cluster, whatever sits between
 * them (a kept joiner breaks no run here), but the variation selectors,
 * which choose a form and stack nothing.
 */
const marksOf = (cluster: string) =>
  [...cluster.matchAll(MARK)].filter(([mark]) => !shapesText(mark)).length;

/** Whether a text draws within its line: no character carries more marks than `MARK_RUN_MAX`. */
const staysOnItsLine = (text: string) => {
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (marksOf(segment) > MARK_RUN_MAX) return false;
  }
  return true;
};

/**
 * Whether a text once on one line says something a person can read: at
 * least `minimum` letters or digits, and no character carrying more than
 * `MARK_RUN_MAX` marks. The summary and the store's name on the screen hold
 * `VISIBLE_MIN`; who asks, one letter or digit, else the page names it by
 * its kind ("an API key").
 */
export function isReadableText(text: string, minimum = VISIBLE_MIN): boolean {
  const line = oneLine(text);
  return (line.match(VISIBLE) ?? []).length >= minimum && staysOnItsLine(line);
}

/** The most characters a name takes on the screen's one line; the details keep it whole. */
export const NAME_DISPLAY_MAX = 40;

/**
 * A name for the screen's one line: on one line, at most `NAME_DISPLAY_MAX`
 * characters as a person counts them (grapheme clusters, so an emoji is
 * never cut in two), an ellipsis last when it was cut.
 */
export function displayName(name: string): string {
  const clusters = [...GRAPHEMES.segment(oneLine(name))].map(({ segment }) => segment);
  return clusters.length <= NAME_DISPLAY_MAX
    ? clusters.join("")
    : `${clusters.slice(0, NAME_DISPLAY_MAX - 1).join("").trimEnd()}…`;
}

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
 * details (a label, a group's heading, a value) carrying more than
 * `MARK_RUN_MAX` combining marks. The store's name the screen shows is
 * checked apart (`isReadableText`), as it is the store's. One that is not
 * is `unreadable` on its page, and its decision refuses an approval of it
 * under its lock; refusing it stays possible.
 */
export function approvalIsReadable(
  payload: { preview?: unknown; display?: unknown } | null | undefined,
): boolean {
  const preview = shownPreview(payload?.preview);
  if (preview === null || preview.truncated) return false;
  if (!isReadableText(preview.summary) || !detailsStayOnTheirLines(preview.details)) return false;
  // A display the page shows must read whole too; one it cannot read as
  // Louez wrote it is not shown, and the summary decides alone.
  return shownDisplay(payload?.display)?.readable ?? true;
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

/** The keys of digests, never shown: a hash says nothing to a person. */
const DIGEST_KEY = /Hash$|_hash$/;

/**
 * The keys of technical identifiers: hidden when their group names the same
 * record another way, readably (`namedOtherwise`), shown otherwise, as then
 * nothing else says which record it is.
 */
const IDENTIFIER_KEY = /^id$|Id$|_id$/;

/** What an identifier's key is about: `""` for a bare `id`, `customer` for `customerId` or `customer_id`. */
const subjectOf = (key: string) =>
  key === "id" ? "" : key.endsWith("_id") ? key.slice(0, -3) : key.slice(0, -2);

/** A value that names a record to a person: a number, or a text with a letter or a digit to read. */
const readableName = (value: unknown) =>
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" && isReadableText(value, 1));

/**
 * Whether the group names readably the very record an identifier is about:
 * for `customerId` (or `customer_id`), an entry `customerName`,
 * `customerNumber`, `customerEmail`, `customerTitle` or `customerLabel` (or
 * their snake-case forms), or the item's own heading when it was taken from
 * `customer` or one of those; for a bare `id`, a bare `name`, `number`,
 * `email`, `title` or `label`, or the item's own heading. Another record
 * named in the group (`productName` next to `customerId`) names the
 * customer not at all.
 */
function namedOtherwise(
  key: string,
  record: Record<string, unknown>,
  heading: { key: string } | null,
): boolean {
  const subject = subjectOf(key);
  const snake = key.endsWith("_id");
  const namers = NAMING_ENDINGS.map((ending) =>
    subject === ""
      ? ending
      : snake
        ? `${subject}_${ending}`
        : `${subject}${ending.charAt(0).toUpperCase()}${ending.slice(1)}`,
  );
  if (heading && (subject === "" || heading.key === subject || namers.includes(heading.key))) {
    return true;
  }
  return namers.some((namer) => readableName(record[namer]));
}

/**
 * Whether a key ends with one of `endings`: the key itself ("amount"), a
 * camel-case ending ("totalAmount") or a snake-case one ("total_amount").
 */
const endsWithWord = (key: string, endings: readonly string[]) =>
  endings.some(
    (ending) =>
      key.toLowerCase() === ending ||
      key.endsWith(ending.charAt(0).toUpperCase() + ending.slice(1)) ||
      key.toLowerCase().endsWith(`_${ending}`),
  );

/** The keys that name a record to a person: its name, number, e-mail, title or label. */
export const NAMING_ENDINGS = ["name", "number", "email", "title", "label"] as const;

/**
 * The keys of an amount of money, from the previews Louez writes (a
 * payment's `amount`, a reservation's `totalAmount`, a deposit return's
 * `returnable`, a cancellation's `rentalPaid` and `depositCollected`): a
 * number under one of them, in a group that names its currency, is that
 * amount in that currency; under any other key it stays a number.
 */
export const AMOUNT_ENDINGS = [
  "amount",
  "total",
  "subtotal",
  "price",
  "deposit",
  "balance",
  "fee",
  "paid",
  "collected",
  "returnable",
  "refund",
] as const;

/**
 * The keys of a date or a date and time (`startDate`, `expiresAt`,
 * `pickupTime`): a value under one of them that reads as ISO is written as
 * a date; under any other key it stays as stored.
 */
export const DATE_ENDINGS = ["at", "date", "time", "day"] as const;

/** The keys an item of a list is named by, when it has one: its group's heading. */
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
 * An object's entries, as a page shows them: digests left out, empty values
 * left out, each identifier left out when the group names that same record
 * readably (`namedOtherwise`: `heading` is the key the item's own heading
 * was taken from, for an item of a list); amounts under `AMOUNT_ENDINGS`,
 * in a group that names its currency, in that currency (the currency
 * itself then said by them).
 */
function entriesOf(
  record: Record<string, unknown>,
  depth: number,
  heading: { key: string } | null = null,
): ShownDetail[] {
  const code = typeof record.currency === "string" ? record.currency.trim() : "";
  const currency = CURRENCY.test(code) ? code.toUpperCase() : null;
  const entries: ShownDetail[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (DIGEST_KEY.test(key)) continue;
    if (IDENTIFIER_KEY.test(key) && namedOtherwise(key, record, heading)) continue;
    const amount = currency && endsWithWord(key, AMOUNT_ENDINGS) ? amountOf(value) : null;
    if (currency && key === "currency" && amountsIn(record)) continue;
    const shown: ShownValue | null =
      currency && amount !== null
        ? { kind: "money", amount, currency }
        : shownValue(value, depth + 1, endsWithWord(key, DATE_ENDINGS));
    if (shown) entries.push({ label: labelOf(key), value: shown });
  }
  return entries;
}

/** Whether a group holds an amount its currency is said by. */
const amountsIn = (record: Record<string, unknown>) =>
  Object.entries(record).some(
    ([key, value]) => endsWithWord(key, AMOUNT_ENDINGS) && amountOf(value) !== null,
  );

/**
 * A value as a page shows it, or null when there is nothing to show (null,
 * an empty text, an object with nothing to show, a list whose items all
 * had nothing to show). A list stored empty is a fact ("no message") and
 * shows as a group with no entries; an item named by a heading and with
 * nothing else to show is its heading alone. `dated`: its key names a
 * date, so an ISO text under it is one.
 */
function shownValue(value: unknown, depth: number, dated = false): ShownValue | null {
  if (value === null || value === undefined) return null;
  if (value === true) return { kind: "yes" };
  if (value === false) return { kind: "no" };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "number", value } : { kind: "text", text: String(value) };
  }
  if (typeof value === "bigint") return { kind: "text", text: String(value) };
  if (typeof value === "string") return textValue(value, dated);
  if (depth > MAX_DEPTH) return textValue(JSON.stringify(value) ?? "");
  if (Array.isArray(value)) {
    const entries = value.flatMap((item, index): ShownDetail[] => {
      const named = isRecord(item) ? NAME_KEYS.find((key) => typeof item[key] === "string") : undefined;
      const title = named && isRecord(item) ? oneLine(String(item[named])) : "";
      // A heading names its item only when it can be read: otherwise the item
      // keeps every entry, its identifier and its unreadable name included.
      if (named && isReadableText(title, 1) && isRecord(item)) {
        const { [named]: _name, ...rest } = item;
        const group = entriesOf(rest, depth + 1, { key: named });
        return group.length > 0
          ? [{ label: title, value: { kind: "group", entries: group } }]
          : [{ label: "", value: { kind: "text", text: title } }];
      }
      const shown = shownValue(item, depth + 1);
      return shown ? [{ label: String(index + 1), value: shown }] : [];
    });
    return entries.length > 0 || value.length === 0 ? { kind: "group", entries } : null;
  }
  if (isRecord(value)) {
    const entries = entriesOf(value, depth);
    return entries.length > 0 ? { kind: "group", entries } : null;
  }
  return textValue(String(value));
}

/** A text on one line: a date when its key names one and it reads as one, nothing when it is empty. */
function textValue(raw: string, dated = false): ShownValue | null {
  const text = oneLine(raw);
  if (text === "") return null;
  if (!dated) return { kind: "text", text };
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

// --- The display: what the page shows first, when the request carries one ---

/** A display as the page shows it: its keys, and its values with each text on one line. */
export interface ShownDisplay {
  headline: { key: HeadlineKey; values: Record<string, DisplayValue> };
  facts: Array<{ key: FactKey; values: Record<string, DisplayValue> }>;
}

/**
 * The most characters a text value of a display shows, once on one line: a
 * product's name of a few hundred characters still wraps on a phone; past
 * this, the request cannot be shown whole.
 */
export const DISPLAY_TEXT_MAX = 500;

const isoInstant = z
  .string()
  .regex(ISO_DATE_TIME)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const isChoiceList = (list: unknown): list is ChoiceList =>
  typeof list === "string" && Object.hasOwn(CHOICES, list);

/** Each value as Louez writes it, nothing more: a key it does not know makes the display unknown. */
const displayValue = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({
    type: z.literal("money"),
    amount: z.string().regex(/^-?\d{1,12}(?:\.\d{1,4})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.strictObject({ type: z.literal("dateTime"), at: isoInstant }),
  z
    .strictObject({ type: z.literal("dateRange"), start: isoInstant, end: isoInstant })
    .refine((range) => Date.parse(range.start) <= Date.parse(range.end)),
  z.strictObject({ type: z.literal("count"), value: z.number().int().min(0).max(1_000_000) }),
  z.strictObject({ type: z.literal("duration"), minutes: z.number().int().min(1).max(525_600) }),
  z.strictObject({
    type: z.literal("choice"),
    list: z.custom<ChoiceList>(isChoiceList),
    value: z.string(),
  }),
]);

const displayLine = z.strictObject({
  key: z.string(),
  values: z.record(z.string(), displayValue),
  ref: z.string().optional(),
});

const storedDisplay = z.strictObject({
  headline: displayLine.omit({ ref: true }),
  facts: z.array(displayLine).min(1).max(FACTS_MAX),
});

type ValueSpecs = Record<string, { type: string; list?: ChoiceList }>;

/**
 * A line's values, as its key declares them, or null: every value its key
 * names, of the type and the list it names, a choice one of its list's, and
 * no value its key does not name.
 */
function valuesAsDeclared(
  specs: ValueSpecs,
  values: Record<string, z.infer<typeof displayValue>>,
): Record<string, DisplayValue> | null {
  const names = Object.keys(specs);
  if (Object.keys(values).length !== names.length) return null;
  const shown: Record<string, DisplayValue> = {};
  for (const name of names) {
    const spec = specs[name];
    const value = values[name];
    if (!spec || !value || value.type !== spec.type) return null;
    if (value.type === "choice") {
      if (value.list !== spec.list || !isChoice(value.list, value.value)) return null;
      shown[name] = { type: "choice", list: value.list, value: value.value };
    } else {
      shown[name] = value.type === "text" ? { type: "text", text: oneLine(value.text) } : value;
    }
  }
  return shown;
}

const hasKey = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(table, key);

/**
 * Whether a text value shows whole, on its line: what a name needs to say
 * something (`isReadableText`, one letter or digit: a name of joiners and
 * variation selectors says nothing), within `DISPLAY_TEXT_MAX`.
 */
const textReads = (value: string) =>
  [...value].length <= DISPLAY_TEXT_MAX && isReadableText(value, 1);

/**
 * The display an approval carries, as the page shows it, or null when it
 * carries none or one Louez cannot read as it writes them (a key or a value
 * it does not know, a value of another type, more facts than it shows: an
 * older or forged payload). The page then shows the summary, as for any
 * other action. `readable` is false when a text value shows nothing, runs
 * past `DISPLAY_TEXT_MAX` or draws off its line: the request then cannot be
 * approved (`approvalIsReadable`).
 */
export function shownDisplay(
  stored: unknown,
): { display: ShownDisplay; readable: boolean } | null {
  if (stored === undefined || stored === null) return null;
  const parsed = storedDisplay.safeParse(stored);
  if (!parsed.success) return null;
  const { headline, facts } = parsed.data;
  if (!hasKey(HEADLINES, headline.key)) return null;
  const headlineValues = valuesAsDeclared(HEADLINES[headline.key], headline.values);
  if (!headlineValues) return null;
  const shownFacts: ShownDisplay["facts"] = [];
  for (const line of facts) {
    if (!hasKey(FACTS, line.key)) return null;
    const values = valuesAsDeclared(FACTS[line.key], line.values);
    if (!values) return null;
    shownFacts.push({ key: line.key, values });
  }
  const texts = [headlineValues, ...shownFacts.map((line) => line.values)].flatMap((values) =>
    Object.values(values).flatMap((value) => (value.type === "text" ? [value.text] : [])),
  );
  return {
    display: { headline: { key: headline.key, values: headlineValues }, facts: shownFacts },
    readable: texts.every(textReads),
  };
}
