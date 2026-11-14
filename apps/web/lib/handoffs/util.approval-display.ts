import type { DateTimeFormatOptions, NumberFormatOptions } from "next-intl";

import { LABELLED_CHOICES, type DisplayValue } from "@louez/api/services/approval-display";

/** What the page formats a display's values with: the page's locale, its formatter, the store's time zone. */
export interface DisplayFormat {
  locale: string;
  timeZone: string;
  number: (value: number, options?: NumberFormatOptions) => string;
  dateTime: (value: Date, options?: DateTimeFormatOptions) => string;
  /** A choice of a labelled list, in the page's language. */
  choice: (list: string, value: string) => string;
}

/** The arguments a display's text takes, each value under its name. */
export type DisplayArguments = Record<string, string | number>;

const DATE: DateTimeFormatOptions = { dateStyle: "medium" };
const TIME: DateTimeFormatOptions = { timeStyle: "short" };

/** A duration in hours and minutes, as the page's language writes it ("2 h", "1 hr, 30 min"). */
function writeDuration(minutes: number, format: DisplayFormat): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = { ...(hours > 0 ? { hours } : {}), ...(rest > 0 || hours === 0 ? { minutes: rest } : {}) };
  if (typeof Intl.DurationFormat === "function") {
    return new Intl.DurationFormat(format.locale, { style: "short" }).format(parts);
  }
  return [
    hours > 0 ? format.number(hours, { style: "unit", unit: "hour" }) : null,
    rest > 0 || hours === 0 ? format.number(rest, { style: "unit", unit: "minute" }) : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The day an instant falls on in the store's time zone, to tell a range within one day. */
const dayOf = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(at);

/**
 * A display's values as its text takes them, in the page's locale: amounts
 * in their currency, instants in the store's time zone (its date and its
 * time apart too, `atDate` and `atTime`), a range as its two ends and
 * whether it holds one day (`periodSameDay`), counts as numbers for the
 * text's plurals, a labelled choice in the page's language and another one
 * as its value, for the text's own select.
 */
export function displayArguments(
  values: Record<string, DisplayValue>,
  format: DisplayFormat,
): DisplayArguments {
  const { timeZone } = format;
  const date = (iso: string) => format.dateTime(new Date(iso), { ...DATE, timeZone });
  const time = (iso: string) => format.dateTime(new Date(iso), { ...TIME, timeZone });
  const written: DisplayArguments = {};
  for (const [name, value] of Object.entries(values)) {
    switch (value.type) {
      case "text":
        written[name] = value.text;
        break;
      case "money":
        written[name] = format.number(Number(value.amount), {
          style: "currency",
          currency: value.currency,
        });
        break;
      case "dateTime":
        written[name] = format.dateTime(new Date(value.at), { ...DATE, ...TIME, timeZone });
        written[`${name}Date`] = date(value.at);
        written[`${name}Time`] = time(value.at);
        break;
      case "dateRange":
        written[`${name}StartDate`] = date(value.start);
        written[`${name}StartTime`] = time(value.start);
        written[`${name}EndDate`] = date(value.end);
        written[`${name}EndTime`] = time(value.end);
        written[`${name}SameDay`] =
          dayOf(new Date(value.start), timeZone) === dayOf(new Date(value.end), timeZone)
            ? "yes"
            : "no";
        break;
      case "count":
        written[name] = value.value;
        break;
      case "duration":
        written[name] = writeDuration(value.minutes, format);
        break;
      case "choice":
        written[name] = (LABELLED_CHOICES as readonly string[]).includes(value.list)
          ? format.choice(value.list, value.value)
          : value.value;
        break;
    }
  }
  return written;
}
