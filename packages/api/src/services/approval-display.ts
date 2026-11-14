/**
 * What a person reads first on an approval's page (docs/architecture/
 * api-and-agents.md, "The approval page"): a short headline and a few facts,
 * each a key from a closed list with typed values, which the page renders in
 * the person's language. Louez builds it from typed fields, next to the
 * preview an agent receives and never inside it: it travels in the check
 * (`ConfirmationCheck.display`), is stored with the approval, and only the
 * page reads it (`shownDisplay`, services/approval-preview.ts). An agent, an
 * API client, `handoffs_get` and the inbox never see it.
 *
 * Nothing here formats: a value says what it is (an amount and its
 * currency, a date-time, a count), and the page writes it in the person's
 * locale and the store's time zone. Text from the store's records (a
 * person's name, a product's name, a record's number) is a `text` value,
 * which the page shows as data, apart from Louez's words.
 */

/** The closed lists a `choice` value is one of: the page names each value in the person's language. */
export const CHOICES = {
  paymentType: [
    "rental",
    "deposit",
    "deposit_hold",
    "deposit_capture",
    "deposit_return",
    "damage",
    "adjustment",
  ],
  paymentMethod: ["stripe", "cash", "card", "transfer", "check", "other"],
  customerMessage: ["request_accepted", "request_rejected", "reservation_cancelled"],
  /** Which channels a message goes on: the sentence names them itself. */
  messageChannels: ["email", "sms", "email_and_sms"],
  /** A target status, stated by the headline itself. */
  reservationStatus: ["confirmed"],
} as const;

export type ChoiceList = keyof typeof CHOICES;

/**
 * The lists the page names by a label of their own; the others are told by
 * the sentence that holds them (`{channels, select, …}`), never as a label.
 */
export const LABELLED_CHOICES = ["paymentType", "paymentMethod", "customerMessage"] as const;

export type TextValue = { type: "text"; text: string };
/**
 * An amount as a decimal string ("-20.00", "1500.00") and its ISO currency:
 * the value its row holds, every digit of which the page shows, and no
 * other (`storedAmount`, services/approval-presentations.ts).
 */
export type MoneyValue = { type: "money"; amount: string; currency: string };
/** An instant, ISO 8601 with its offset: the page writes it in the store's time zone. */
export type DateTimeValue = { type: "dateTime"; at: string };
export type DateRangeValue = { type: "dateRange"; start: string; end: string };
export type CountValue = { type: "count"; value: number };
export type DurationValue = { type: "duration"; minutes: number };
export type ChoiceValue<L extends ChoiceList = ChoiceList> = {
  type: "choice";
  list: L;
  value: (typeof CHOICES)[L][number];
};

export type DisplayValue =
  | TextValue
  | MoneyValue
  | DateTimeValue
  | DateRangeValue
  | CountValue
  | DurationValue
  | ChoiceValue;

type ValueSpec =
  | { type: Exclude<DisplayValue["type"], "choice"> }
  | { type: "choice"; list: ChoiceList };

const TEXT = { type: "text" } as const;
const MONEY = { type: "money" } as const;
const DATE_TIME = { type: "dateTime" } as const;
const DATE_RANGE = { type: "dateRange" } as const;
const COUNT = { type: "count" } as const;
const DURATION = { type: "duration" } as const;
const choiceOf = <L extends ChoiceList>(list: L) => ({ type: "choice", list }) as const;

/** The confirmation's headlines state its target status: always `confirmed`. */
const CONFIRMS = { to: choiceOf("reservationStatus") } as const;

/**
 * The headlines, one per branch a person approves, and the values each one
 * takes. A headline never holds text from the store's records: a name could
 * read as Louez's own words there.
 */
export const HEADLINES = {
  recordPayment: {},
  /** A negative adjustment: money the store paid back. */
  paidBack: {},
  /** A deposit the store collected, recorded through the generic write. */
  recordDeposit: {},
  returnDeposit: {},
  deletePayment: {},
  removeMember: {},
  cancelInvitation: {},
  /** Both flags may be sent with nothing short: the stock and the buffer cover it. */
  confirmWithinRules: CONFIRMS,
  confirmPastBuffer: CONFIRMS,
  confirmBeyondStock: CONFIRMS,
  confirmBeyondStockAndBuffer: CONFIRMS,
} as const satisfies Record<string, Record<string, ValueSpec>>;

/** The facts, and the values each one takes, all of them. */
export const FACTS = {
  /** "Booking #R-00094 · Camille Simon" */
  booking: { number: TEXT, customer: TEXT },
  /** "Booking #R-00094", when the customer is not named. */
  bookingNumber: { number: TEXT },
  /** "Rental: €120.00 received · Cash" */
  received: { type: choiceOf("paymentType"), amount: MONEY, method: choiceOf("paymentMethod") },
  /** A negative adjustment: "Adjustment: -€20.00, paid back to the customer · Card" */
  paidBack: { type: choiceOf("paymentType"), amount: MONEY, method: choiceOf("paymentMethod") },
  /** "Deposit: €300.00 collected · Card" */
  depositCollected: {
    type: choiceOf("paymentType"),
    amount: MONEY,
    method: choiceOf("paymentMethod"),
  },
  /** "Deposit return: €150.00, given back to the customer · Cash" */
  depositGivenBack: {
    type: choiceOf("paymentType"),
    amount: MONEY,
    method: choiceOf("paymentMethod"),
  },
  /** "Deposit given back: €150.00 · Transfer" */
  returned: { amount: MONEY, method: choiceOf("paymentMethod") },
  /** "Deposit still held before this: €300.00" */
  depositHeld: { held: MONEY },
  /** Louez only records it: no money moves. */
  recordOnly: {},
  /** "Rental: €80.00 · Cash" */
  deleted: { type: choiceOf("paymentType"), amount: MONEY, method: choiceOf("paymentMethod") },
  /** "Recorded on Nov 12, 2026 at 4:30 PM" */
  recordedOn: { at: DATE_TIME },
  /** It leaves the booking's balance and the store's figures. */
  leavesBalance: {},
  /** "Lucas Bernard · lucas.bernard@example.com" */
  member: { name: TEXT, email: TEXT },
  /** A member with no name: their address alone. */
  memberEmail: { email: TEXT },
  /** "Member since Mar 3, 2026" */
  memberSince: { since: DATE_TIME },
  /** They lose access at once to the customers, bookings and payments. */
  losesAccess: {},
  /** "Invitation sent to nina.roux@example.com" */
  invited: { email: TEXT },
  /** "Sent on Nov 2, 2026" */
  invitedOn: { at: DATE_TIME },
  /** Their link stops working: they do not join. */
  linkStops: {},
  /** "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00" */
  period: { period: DATE_RANGE, total: MONEY },
  /** "Kayak biplace: 2 requested, only 1 free with your 2 hr turnover buffer" */
  pastBuffer: { product: TEXT, requested: COUNT, available: COUNT, buffer: DURATION },
  /** "Paddle: 2 requested, only 1 in stock: 1 missing" */
  beyondStock: { product: TEXT, requested: COUNT, available: COUNT, missing: COUNT },
  /** "And 2 more lines past your rules: see Details" */
  moreLines: { count: COUNT },
  /** Sent with an override, nothing short: the stock and the buffer cover it. */
  withinRules: {},
  /** "Camille Simon will receive the “request accepted” email" */
  message: {
    customer: TEXT,
    message: choiceOf("customerMessage"),
    channels: choiceOf("messageChannels"),
  },
  /** The same, the customer unnamed. */
  messageToCustomer: {
    message: choiceOf("customerMessage"),
    channels: choiceOf("messageChannels"),
  },
  noMessage: {},
} as const satisfies Record<string, Record<string, ValueSpec>>;

export type HeadlineKey = keyof typeof HEADLINES;
export type FactKey = keyof typeof FACTS;

type ValueOf<S> = S extends { type: "choice"; list: infer L extends ChoiceList }
  ? ChoiceValue<L>
  : S extends { type: infer T }
    ? Extract<DisplayValue, { type: T }>
    : never;

type ValuesOf<Spec> = { [Name in keyof Spec]: ValueOf<Spec[Name]> };

export interface DisplayHeadline {
  key: HeadlineKey;
  values: Record<string, DisplayValue>;
}

export interface DisplayFact {
  key: FactKey;
  values: Record<string, DisplayValue>;
  /**
   * The id of the record the fact is about (a reservation, a payment, a
   * membership, an invitation), which the page never shows: the request's
   * identity names its records by id, and the fact names them by number or
   * name (`approvalIdentity`, and the test that every identity fact is
   * shown).
   */
  ref?: string;
}

/** What the page shows first: one headline, and one to `FACTS_MAX` facts in order. */
export interface ApprovalDisplay {
  headline: DisplayHeadline;
  facts: DisplayFact[];
}

/** The most facts a display holds: a decision in ten seconds. */
export const FACTS_MAX = 5;

/**
 * What a branch a person approves hands its check with its preview: the
 * display, and the consequential facts that make the request's identity
 * (`approvalIdentity`), both built by one call from the values its preview
 * shows. Pull request 7 passes `facts` as the approval's.
 */
export interface ApprovalPresentation {
  display: ApprovalDisplay;
  facts: Record<string, unknown>;
}

// --- Builders ----------------------------------------------------------------

export const text = (raw: string): TextValue => ({ type: "text", text: raw });
export const money = (amount: string, currency: string): MoneyValue => ({
  type: "money",
  amount,
  currency: currency.toUpperCase(),
});
export const dateTime = (at: Date | string): DateTimeValue => ({
  type: "dateTime",
  at: typeof at === "string" ? at : at.toISOString(),
});
export const dateRange = (start: Date | string, end: Date | string): DateRangeValue => ({
  type: "dateRange",
  start: typeof start === "string" ? start : start.toISOString(),
  end: typeof end === "string" ? end : end.toISOString(),
});
export const count = (value: number): CountValue => ({ type: "count", value });
export const duration = (minutes: number): DurationValue => ({ type: "duration", minutes });
export const choice = <L extends ChoiceList>(
  list: L,
  value: (typeof CHOICES)[L][number],
): ChoiceValue<L> => ({ type: "choice", list, value });

export const headline = <K extends HeadlineKey>(
  key: K,
  values: ValuesOf<(typeof HEADLINES)[K]>,
): DisplayHeadline => ({ key, values });

export const fact = <K extends FactKey>(
  key: K,
  values: ValuesOf<(typeof FACTS)[K]>,
  ref?: string,
): DisplayFact => (ref === undefined ? { key, values } : { key, values, ref });

/** Whether a raw value is one of a list's: a value from the database is checked before it is used. */
export const isChoice = <L extends ChoiceList>(
  list: L,
  value: unknown,
): value is (typeof CHOICES)[L][number] =>
  typeof value === "string" && (CHOICES[list] as readonly string[]).includes(value);
