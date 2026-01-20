import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Currency formatting
export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  // Determine the best locale for the currency
  const localeMap: Record<string, string> = {
    EUR: 'fr-FR',
    USD: 'en-US',
    GBP: 'en-GB',
    CHF: 'de-CH',
    CAD: 'en-CA',
    AUD: 'en-AU',
    JPY: 'ja-JP',
    CNY: 'zh-CN',
    INR: 'en-IN',
    BRL: 'pt-BR',
    MXN: 'es-MX',
    SEK: 'sv-SE',
    NOK: 'nb-NO',
    DKK: 'da-DK',
    PLN: 'pl-PL',
    CZK: 'cs-CZ',
    HUF: 'hu-HU',
    RON: 'ro-RO',
    SGD: 'en-SG',
    HKD: 'zh-HK',
    KRW: 'ko-KR',
    TWD: 'zh-TW',
    THB: 'th-TH',
    MYR: 'ms-MY',
    PHP: 'fil-PH',
    VND: 'vi-VN',
    AED: 'ar-AE',
    SAR: 'ar-SA',
    ILS: 'he-IL',
    ZAR: 'en-ZA',
    MAD: 'ar-MA',
    NZD: 'en-NZ',
    ARS: 'es-AR',
    CLP: 'es-CL',
    COP: 'es-CO',
  }

  const locale = localeMap[currency] || 'fr-FR'

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(amount)
}

/**
 * Format currency for SMS (uses text instead of symbol to stay in GSM-7)
 * Example: "54,00 euros" instead of "54,00 €"
 */
export function formatCurrencyForSms(amount: number, currency: string = 'EUR'): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)

  // Use readable currency names for common currencies
  const currencyNames: Record<string, string> = {
    EUR: 'euros',
    USD: 'dollars',
    GBP: 'livres',
    CHF: 'CHF',
  }

  const currencyName = currencyNames[currency] || currency
  return `${formatted} ${currencyName}`
}

// Number formatting
export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

// Percentage formatting
export function formatPercent(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value / 100)
}

// Date formatting
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  }).format(d)
}

// Short date formatting (e.g., "15 jan.")
export function formatDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(d)
}

// Date with time formatting
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// Time only formatting
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// Date range formatting (e.g., "15 - 18 janvier 2025")
export function formatDateRange(startDate: Date | string, endDate: Date | string): string {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate

  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear = start.getFullYear() === end.getFullYear()

  if (sameMonth && sameYear) {
    return `${start.getDate()} - ${formatDate(end)}`
  } else if (sameYear) {
    return `${formatDateShort(start)} - ${formatDate(end)}`
  } else {
    return `${formatDate(start)} - ${formatDate(end)}`
  }
}

// Relative time formatting (e.g., "il y a 2 jours", "dans 3 heures")
export function formatRelativeTime(date: Date | string, locale: string = 'fr'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const diffMin = Math.round(diffSec / 60)
  const diffHours = Math.round(diffMin / 60)
  const diffDays = Math.round(diffHours / 24)
  const diffWeeks = Math.round(diffDays / 7)
  const diffMonths = Math.round(diffDays / 30)
  const diffYears = Math.round(diffDays / 365)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (Math.abs(diffYears) >= 1) {
    return rtf.format(diffYears, 'year')
  } else if (Math.abs(diffMonths) >= 1) {
    return rtf.format(diffMonths, 'month')
  } else if (Math.abs(diffWeeks) >= 1) {
    return rtf.format(diffWeeks, 'week')
  } else if (Math.abs(diffDays) >= 1) {
    return rtf.format(diffDays, 'day')
  } else if (Math.abs(diffHours) >= 1) {
    return rtf.format(diffHours, 'hour')
  } else if (Math.abs(diffMin) >= 1) {
    return rtf.format(diffMin, 'minute')
  } else {
    return rtf.format(diffSec, 'second')
  }
}

// Duration in days - uses Math.ceil (round up): any partial day = full day billed
export function calculateDurationDays(startDate: Date | string, endDate: Date | string): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  const diffMs = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

// Format duration in human readable format
export function formatDuration(days: number): string {
  if (days === 1) return '1 jour'
  if (days < 7) return `${days} jours`
  const weeks = Math.floor(days / 7)
  const remainingDays = days % 7
  if (remainingDays === 0) {
    return weeks === 1 ? '1 semaine' : `${weeks} semaines`
  }
  return `${weeks === 1 ? '1 semaine' : `${weeks} semaines`} et ${remainingDays} jour${remainingDays > 1 ? 's' : ''}`
}

// Get currency symbol
export function getCurrencySymbol(currency: string = 'EUR'): string {
  const symbolMap: Record<string, string> = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    CHF: 'CHF',
    CAD: 'CA$',
    AUD: 'A$',
    JPY: '¥',
    CNY: '¥',
    INR: '₹',
    BRL: 'R$',
    MXN: 'MX$',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    CZK: 'Kč',
    HUF: 'Ft',
    RON: 'lei',
    SGD: 'S$',
    HKD: 'HK$',
    KRW: '₩',
    TWD: 'NT$',
    THB: '฿',
    MYR: 'RM',
    PHP: '₱',
    VND: '₫',
    AED: 'د.إ',
    SAR: '﷼',
    ILS: '₪',
    ZAR: 'R',
    MAD: 'د.م.',
    NZD: 'NZ$',
    ARS: 'AR$',
    CLP: 'CL$',
    COP: 'CO$',
  }

  return symbolMap[currency] || currency
}

// Format amount with symbol suffix (e.g., "10.50€")
export function formatAmountWithSymbol(
  amount: number,
  currency: string = 'EUR',
  decimals: number = 2
): string {
  const symbol = getCurrencySymbol(currency)
  return `${amount.toFixed(decimals)}${symbol}`
}
