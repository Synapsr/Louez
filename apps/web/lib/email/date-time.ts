import { formatStoreDate } from '@/lib/utils/store-date'
import type { EmailLocale } from './i18n'
import { getTimezoneForCountry } from '@/lib/utils/countries'

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

  return 'UTC'
}

export function formatEmailDateInStoreTimezone(
  date: Date,
  locale: EmailLocale,
  pattern: string,
  timezone?: string | null,
  countryCode?: string | null
): string {
  const resolvedTimezone = resolveStoreTimezone(timezone, countryCode)
  return formatStoreDate(date, resolvedTimezone, pattern, locale)
}

export function getStoreTimezoneLabel(
  date: Date,
  timezone?: string | null,
  countryCode?: string | null
): string {
  const resolvedTimezone = resolveStoreTimezone(timezone, countryCode)

  try {
    const offset = formatStoreDate(date, resolvedTimezone, 'xxx')
    return `${resolvedTimezone} (UTC${offset})`
  } catch {
    return 'UTC (UTC+00:00)'
  }
}
