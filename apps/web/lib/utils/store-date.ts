/**
 * Centralized timezone-aware date formatting for Louez.
 *
 * All date+time formatting across the app should go through this module.
 * It wraps date-fns-tz's formatInTimeZone to ensure dates are always
 * displayed in the store's timezone, not the server/browser timezone.
 *
 * Usage:
 *   import { formatStoreDate, DATE_FORMATS } from '@/lib/utils/store-date'
 *   formatStoreDate(date, timezone, 'SHORT_DATETIME')
 *   formatStoreDate(date, timezone, "d MMM yyyy 'à' HH:mm") // custom pattern
 */

// eslint-disable-next-line no-restricted-imports
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { fr, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

const DEFAULT_TIMEZONE = 'UTC'

const LOCALE_MAP: Record<string, Locale> = {
  fr,
  en: enUS,
}

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

/**
 * Format a date in the store's timezone.
 *
 * This is THE function to use for all date+time formatting in Louez.
 * Accepts either a named preset or a custom date-fns format pattern.
 *
 * @param date      Date object or ISO string (typically UTC from database)
 * @param timezone  IANA timezone string (e.g. 'Europe/Paris'). Falls back gracefully if undefined.
 * @param preset    A key from DATE_FORMATS, or a custom date-fns format string
 * @param locale    Locale code ('fr' | 'en'). Defaults to 'fr'.
 */
export function formatStoreDate(
  date: Date | string,
  timezone: string | undefined | null,
  preset: DateFormatPreset | (string & {}),
  locale: string = 'fr'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const pattern =
    (DATE_FORMATS as Record<string, string>)[preset] ?? preset
  const dateFnsLocale = LOCALE_MAP[locale] ?? fr

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
 */
export function formatStoreDateRange(
  startDate: Date | string,
  endDate: Date | string,
  timezone: string | undefined | null,
  locale: string = 'fr'
): string {
  const startShort = formatStoreDate(startDate, timezone, 'SHORTEST_DATE', locale)
  const endShort = formatStoreDate(endDate, timezone, 'SHORTEST_DATE', locale)

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
  timezone: string | undefined | null
): string {
  return formatStoreDate(date, timezone, 'TIME_ONLY')
}
