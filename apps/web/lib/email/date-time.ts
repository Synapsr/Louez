import { formatInTimeZone } from 'date-fns-tz'
import type { EmailLocale } from './i18n'
import { getDateLocale } from './i18n'
import { getTimezoneForCountry } from '@/lib/utils/countries'

const DEFAULT_TIMEZONE = 'UTC'

export function resolveStoreTimezone(
  timezone?: string | null,
  countryCode?: string | null
): string {
  if (timezone && timezone.trim().length > 0) {
    return timezone
  }

  if (countryCode && countryCode.trim().length > 0) {
    return getTimezoneForCountry(countryCode)
  }

  return DEFAULT_TIMEZONE
}

export function formatEmailDateInStoreTimezone(
  date: Date,
  locale: EmailLocale,
  pattern: string,
  timezone?: string | null,
  countryCode?: string | null
): string {
  const dateLocale = getDateLocale(locale)
  const resolvedTimezone = resolveStoreTimezone(timezone, countryCode)

  try {
    return formatInTimeZone(date, resolvedTimezone, pattern, {
      locale: dateLocale,
    })
  } catch {
    return formatInTimeZone(date, DEFAULT_TIMEZONE, pattern, {
      locale: dateLocale,
    })
  }
}

export function getStoreTimezoneLabel(
  date: Date,
  timezone?: string | null,
  countryCode?: string | null
): string {
  const resolvedTimezone = resolveStoreTimezone(timezone, countryCode)

  try {
    const offset = formatInTimeZone(date, resolvedTimezone, 'xxx')
    return `${resolvedTimezone} (UTC${offset})`
  } catch {
    return `${DEFAULT_TIMEZONE} (UTC+00:00)`
  }
}
