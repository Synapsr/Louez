/**
 * Store-local dates of demo stores: a demo store lives in Europe/Paris,
 * whatever the server's time zone.
 */

export const DEMO_TIMEZONE = "Europe/Paris";

const MINUTE = 60_000;

export function parisParts(at: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEMO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function parisOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: DEMO_TIMEZONE, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const match = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 60;
  const hours = Number(match[1]);
  return hours * 60 + Math.sign(hours) * Number(match[2] ?? 0);
}

/** `hour:minute` in Paris, `dayOffset` days after the Paris day of `base`. */
export function parisDayAt(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const { year, month, day } = parisParts(base);
  const guess = Date.UTC(year, month - 1, day + dayOffset, hour, minute);
  const offset = parisOffsetMinutes(new Date(guess));
  return new Date(guess - offset * MINUTE);
}

export const monthDayOf = (date: Date) => {
  const { month, day } = parisParts(date);
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
