import { fr, enUS, de, es, it, nl, pl, ptBR } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { createTranslator } from 'next-intl'

// Email message files — the `emails` subtree lives in its own small per-locale
// files so the templates (also rendered in the browser for the dashboard
// preview) don't drag the full app messages into the client bundle.
import frEmails from '@/messages/emails/fr.json'
import enEmails from '@/messages/emails/en.json'
import deEmails from '@/messages/emails/de.json'
import esEmails from '@/messages/emails/es.json'
import itEmails from '@/messages/emails/it.json'
import nlEmails from '@/messages/emails/nl.json'
import plEmails from '@/messages/emails/pl.json'
import ptEmails from '@/messages/emails/pt.json'

import type { EmailLocale } from '@louez/email'
import { localeCountries } from '@/i18n/config'
import { FORMAT_LOCALE } from '@/lib/i18n/format-locale'
export type { EmailLocale }

// Type for email messages structure (use the French subtree as reference)
type EmailMessages = { emails: typeof frEmails }

// Map of locale to messages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messagesMap: Record<EmailLocale, any> = {
  fr: { emails: frEmails },
  en: { emails: enEmails },
  de: { emails: deEmails },
  es: { emails: esEmails },
  it: { emails: itEmails },
  nl: { emails: nlEmails },
  pl: { emails: plEmails },
  pt: { emails: ptEmails },
}

// Map of locale to date-fns locale
const dateFnsLocaleMap: Record<EmailLocale, DateFnsLocale> = {
  fr: fr,
  en: enUS,
  de: de,
  es: es,
  it: it,
  nl: nl,
  pl: pl,
  pt: ptBR,
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
  de: {
    full: "EEEE, d. MMMM yyyy 'um' HH:mm",
    short: "d. MMM 'um' HH:mm",
    dateTime: "d. MMMM yyyy 'um' HH:mm",
  },
  es: {
    full: "EEEE, d 'de' MMMM 'de' yyyy 'a las' HH:mm",
    short: "d MMM 'a las' HH:mm",
    dateTime: "d 'de' MMMM 'de' yyyy 'a las' HH:mm",
  },
  it: {
    full: "EEEE d MMMM yyyy 'alle' HH:mm",
    short: "d MMM 'alle' HH:mm",
    dateTime: "d MMMM yyyy 'alle' HH:mm",
  },
  nl: {
    full: "EEEE d MMMM yyyy 'om' HH:mm",
    short: "d MMM 'om' HH:mm",
    dateTime: "d MMMM yyyy 'om' HH:mm",
  },
  pl: {
    full: "EEEE, d MMMM yyyy 'o' HH:mm",
    short: "d MMM 'o' HH:mm",
    dateTime: "d MMMM yyyy 'o' HH:mm",
  },
  pt: {
    full: "EEEE, d 'de' MMMM 'de' yyyy 'às' HH:mm",
    short: "d MMM 'às' HH:mm",
    dateTime: "d 'de' MMMM 'de' yyyy 'às' HH:mm",
  },
}

/**
 * Map country code to email locale
 * Countries not in this map will default to English
 */
const countryToLocaleMap: Record<string, EmailLocale> = {
  // French
  FR: 'fr', // France
  BE: 'fr', // Belgium (French is more common for business)
  CH: 'fr', // Switzerland (French for Romandie)
  LU: 'fr', // Luxembourg
  MC: 'fr', // Monaco
  // German
  DE: 'de', // Germany
  AT: 'de', // Austria
  LI: 'de', // Liechtenstein
  // Spanish
  ES: 'es', // Spain
  MX: 'es', // Mexico
  AR: 'es', // Argentina
  CO: 'es', // Colombia
  CL: 'es', // Chile
  // Italian
  IT: 'it', // Italy
  SM: 'it', // San Marino
  // Dutch
  NL: 'nl', // Netherlands
  // Polish
  PL: 'pl', // Poland
  // Portuguese
  PT: 'pt', // Portugal
  BR: 'pt', // Brazil
  // English (explicit)
  GB: 'en', // United Kingdom
  US: 'en', // United States
  CA: 'en', // Canada
  AU: 'en', // Australia
  NZ: 'en', // New Zealand
  IE: 'en', // Ireland
}

/**
 * Get email locale from country code
 * Defaults to English if country is not mapped
 */
export function getLocaleFromCountry(countryCode: string | null | undefined): EmailLocale {
  if (!countryCode) return 'en'
  return countryToLocaleMap[countryCode.toUpperCase()] || 'en'
}

/**
 * Get email translations for a given locale
 */
export function getEmailMessages(locale: EmailLocale = 'fr'): EmailMessages {
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
 * Get a next-intl translator for email messages, including ICU interpolation.
 */
export function getEmailTranslator(locale: EmailLocale = 'fr') {
  return createTranslator({
    locale,
    messages: getEmailMessages(locale),
    namespace: 'emails',
  })
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
/**
 * Full BCP 47 tag for an email locale. A German mail should show German
 * dates and amounts — anything that was not French previously fell back to
 * an English tag.
 */
function localeToTag(locale: EmailLocale): string {
  const region = (localeCountries as Record<string, string>)[locale]
  return region ? `${locale}-${region}` : FORMAT_LOCALE
}

export function getCurrencyFormatter(locale: EmailLocale = 'fr', currency: string = 'EUR') {
  // Map of currency to best locale for formatting
  const currencyLocaleMap: Record<string, string> = {
    EUR: localeToTag(locale),
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

  const formatLocale = currencyLocaleMap[currency] || localeToTag(locale)

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
