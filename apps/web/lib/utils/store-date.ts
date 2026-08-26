/**
 * Centralized timezone-aware date formatting for Louez.
 *
 * All date+time formatting across the app should go through this module.
 * It wraps date-fns-tz's formatInTimeZone to ensure dates are always
 * displayed in the store's timezone, not the server/browser timezone.
 *
 * Usage:
 *   import { formatStoreDate, DATE_FORMATS } from '@/lib/utils/store-date'
 *   formatStoreDate(date, timezone, 'SHORT_DATETIME', locale)
 *   formatStoreDate(date, timezone, "d MMM yyyy 'à' HH:mm", locale) // custom pattern
 */

// eslint-disable-next-line no-restricted-imports
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { resolveFormatLocale } from '@/lib/i18n/format-locale'

const DEFAULT_TIMEZONE = 'UTC'

/**
 * Named format presets covering every pattern used across the codebase.
 * Prefer these over raw format strings for consistency and discoverability.
 */
export const DATE_FORMATS = {
  /** "lundi 5 janvier 2026 à 14:00" — confirmation pages, full display */
  FULL_DATETIME: "EEEE d MMMM yyyy 'à' HH:mm",

  /** "lun. 5 janv. à 14:00" — dashboard period summary, reservation detail */
  SHORT_DATETIME: "EEE d MMM 'à' HH:mm",

  /** "05 janv. 2026 14:00" — activity timeline, audit logs */
  COMPACT_DATETIME: 'dd MMM yyyy HH:mm',

  /** "05/01/26 14:00" — payment summary, compact timestamps */
  TIMESTAMP: 'dd/MM/yy HH:mm',

  /** "5 janv. 2026 à 14:00" — online payment status */
  DATE_AT_TIME: "d MMM yyyy 'à' HH:mm",

  /** "5 janv. à 14:00" — short date at time */
  SHORT_DATE_AT_TIME: "d MMM 'à' HH:mm",

  /** "5 janv. 14:00" — date range elements */
  RANGE_ELEMENT: 'd MMM HH:mm',

  /** "14:00" — time only */
  TIME_ONLY: 'HH:mm',

  /** "lundi 5 janvier 2026" — PDF full date (no time) */
  FULL_DATE: 'EEEE d MMMM yyyy',

  /** "5 janvier 2026" — PDF medium date */
  MEDIUM_DATE: 'd MMMM yyyy',

  /** "05 janv. 2026" — short date with year */
  SHORT_DATE: 'dd MMM yyyy',

  /** "5 janv." — shortest date, used in pickers and ranges */
  SHORTEST_DATE: 'd MMM',

  /** "lundi 05 janvier" — day name + date */
  DAY_AND_DATE: 'EEEE dd MMMM',

  /** "05/01" — compact date */
  COMPACT_DATE: 'dd/MM',

  /** "5 janvier 2026 à 14:00:00" — PDF precise datetime */
  PRECISE_DATETIME: "d MMMM yyyy 'à' HH:mm:ss",
} as const

export type DateFormatPreset = keyof typeof DATE_FORMATS

const LOCALIZED_DATE_TIME_PARTS: Partial<
  Record<DateFormatPreset, { date: string; time: string }>
> = {
  FULL_DATETIME: { date: 'EEEE d MMMM yyyy', time: 'HH:mm' },
  SHORT_DATETIME: { date: 'EEE d MMM', time: 'HH:mm' },
  DATE_AT_TIME: { date: 'd MMM yyyy', time: 'HH:mm' },
  SHORT_DATE_AT_TIME: { date: 'd MMM', time: 'HH:mm' },
  PRECISE_DATETIME: { date: 'd MMMM yyyy', time: 'HH:mm:ss' },
}

const isDateFormatPreset = (value: string): value is DateFormatPreset => value in DATE_FORMATS

/**
 * Format a date in the store's timezone.
 *
 * This is THE function to use for all date+time formatting in Louez.
 * Accepts either a named preset or a custom date-fns format pattern.
 *
 * @param date      Date object or ISO string (typically UTC from database)
 * @param timezone  IANA timezone string (e.g. 'Europe/Paris'). Falls back gracefully if undefined.
 * @param preset    A key from DATE_FORMATS, or a custom date-fns format string
 * @param locale    Active UI locale. Required so callers cannot silently fall back to French.
 */
export function formatStoreDate(
  date: Date | string,
  timezone: string | undefined | null,
  preset: DateFormatPreset | (string & {}),
  locale: string
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const dateFnsLocale = resolveFormatLocale(locale).dateFns
  const localizedParts = isDateFormatPreset(preset)
    ? LOCALIZED_DATE_TIME_PARTS[preset]
    : undefined
  const localizedDateTimePattern = localizedParts
    ? dateFnsLocale.formatLong?.dateTime({ width: 'long' })
    : undefined
  const pattern = localizedParts && localizedDateTimePattern
    ? localizedDateTimePattern
        .replace('{{date}}', localizedParts.date)
        .replace('{{time}}', localizedParts.time)
    : isDateFormatPreset(preset)
      ? DATE_FORMATS[preset]
      : preset

  const tz = timezone?.trim() || null

  if (tz) {
    try {
      return formatInTimeZone(d, tz, pattern, { locale: dateFnsLocale })
    } catch {
      // Invalid timezone string — fall back to UTC
      return formatInTimeZone(d, DEFAULT_TIMEZONE, pattern, {
        locale: dateFnsLocale,
      })
    }
  }

  // No timezone provided — use local format (server or browser TZ)
  return format(d, pattern, { locale: dateFnsLocale })
}

/**
 * Format a date range for reservation tables.
 *
 * Same-day:  "5 janv. • 14:00 - 18:00"
 * Multi-day: "5 janv. 14:00 → 7 janv. 18:00"
 *
 * Compact mode (for table views):
 * Same-day:  "5 janv."
 * Multi-day: "5 janv. → 7 janv."
 */
export function formatStoreDateRange(
  startDate: Date | string,
  endDate: Date | string,
  timezone: string | undefined | null,
  locale: string,
  options?: { compact?: boolean }
): string {
  const startShort = formatStoreDate(startDate, timezone, 'SHORTEST_DATE', locale)
  const endShort = formatStoreDate(endDate, timezone, 'SHORTEST_DATE', locale)

  if (options?.compact) {
    if (startShort === endShort) return startShort
    return `${startShort} → ${endShort}`
  }

  if (startShort === endShort) {
    const startTime = formatStoreDate(startDate, timezone, 'TIME_ONLY', locale)
    const endTime = formatStoreDate(endDate, timezone, 'TIME_ONLY', locale)
    return `${startShort} • ${startTime} - ${endTime}`
  }

  return `${formatStoreDate(startDate, timezone, 'RANGE_ELEMENT', locale)} → ${formatStoreDate(endDate, timezone, 'RANGE_ELEMENT', locale)}`
}

/**
 * Format time only in store timezone.
 */
export function formatStoreTime(
  date: Date | string,
  timezone: string | undefined | null,
  locale: string,
): string {
  return formatStoreDate(date, timezone, 'TIME_ONLY', locale)
}
