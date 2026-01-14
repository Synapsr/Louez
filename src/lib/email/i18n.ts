import { fr, enUS } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'

// Import message files
import frMessages from '@/messages/fr.json'
import enMessages from '@/messages/en.json'

export type EmailLocale = 'fr' | 'en'

// Type for email messages structure
type EmailMessages = typeof frMessages

// Map of locale to messages
const messagesMap: Record<EmailLocale, EmailMessages> = {
  fr: frMessages,
  en: enMessages,
}

// Map of locale to date-fns locale
const dateFnsLocaleMap: Record<EmailLocale, DateFnsLocale> = {
  fr: fr,
  en: enUS,
}

// Date format patterns by locale
const dateFormatPatterns: Record<EmailLocale, { full: string; short: string; dateTime: string }> = {
  fr: {
    full: "EEEE d MMMM yyyy 'à' HH:mm",
    short: "d MMM 'à' HH:mm",
    dateTime: "d MMMM yyyy 'à' HH:mm",
  },
  en: {
    full: "EEEE, MMMM d, yyyy 'at' h:mm a",
    short: "MMM d 'at' h:mm a",
    dateTime: "MMMM d, yyyy 'at' h:mm a",
  },
}

/**
 * Get email translations for a given locale
 */
export function getEmailMessages(locale: EmailLocale = 'fr') {
  return messagesMap[locale] || messagesMap.fr
}

/**
 * Get email-specific translations
 */
export function getEmailTranslations(locale: EmailLocale = 'fr') {
  const messages = getEmailMessages(locale)
  return messages.emails
}

/**
 * Get date-fns locale for formatting dates
 */
export function getDateLocale(locale: EmailLocale = 'fr'): DateFnsLocale {
  return dateFnsLocaleMap[locale] || dateFnsLocaleMap.fr
}

/**
 * Get date format patterns for a locale
 */
export function getDateFormatPatterns(locale: EmailLocale = 'fr') {
  return dateFormatPatterns[locale] || dateFormatPatterns.fr
}

/**
 * Get currency formatter for a locale and currency
 */
export function getCurrencyFormatter(locale: EmailLocale = 'fr', currency: string = 'EUR') {
  // Map of currency to best locale for formatting
  const currencyLocaleMap: Record<string, string> = {
    EUR: locale === 'fr' ? 'fr-FR' : 'en-IE',
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
    NZD: 'en-NZ',
  }

  const formatLocale = currencyLocaleMap[currency] || (locale === 'fr' ? 'fr-FR' : 'en-US')

  return (amount: number) =>
    new Intl.NumberFormat(formatLocale, {
      style: 'currency',
      currency: currency,
    }).format(amount)
}

/**
 * Default locale for emails
 */
export const defaultEmailLocale: EmailLocale = 'fr'
