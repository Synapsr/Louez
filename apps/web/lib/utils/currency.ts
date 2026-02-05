// Currency utilities for multi-currency support

export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'JPY' | 'CNY' | 'INR' | 'BRL' | 'MXN' | 'SEK' | 'NOK' | 'DKK' | 'PLN' | 'CZK' | 'HUF' | 'RON' | 'HRK' | 'SGD' | 'HKD' | 'KRW' | 'TWD' | 'THB' | 'MYR' | 'PHP' | 'VND' | 'AED' | 'SAR' | 'ILS' | 'ZAR' | 'MAD' | 'NZD' | 'ARS' | 'CLP' | 'COP'

export interface Currency {
  code: CurrencyCode
  symbol: string
  name: string
  locale: string // Primary locale for formatting
}

// Supported currencies with their display properties
export const SUPPORTED_CURRENCIES: Currency[] = [
  // Europe
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'fr-FR' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', locale: 'de-CH' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', locale: 'sv-SE' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', locale: 'nb-NO' },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', locale: 'da-DK' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', locale: 'pl-PL' },
  { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna', locale: 'cs-CZ' },
  { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint', locale: 'hu-HU' },
  { code: 'RON', symbol: 'lei', name: 'Romanian Leu', locale: 'ro-RO' },
  { code: 'HRK', symbol: 'kn', name: 'Croatian Kuna', locale: 'hr-HR' },

  // North America
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', locale: 'es-MX' },

  // South America
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', locale: 'pt-BR' },
  { code: 'ARS', symbol: 'AR$', name: 'Argentine Peso', locale: 'es-AR' },
  { code: 'CLP', symbol: 'CL$', name: 'Chilean Peso', locale: 'es-CL' },
  { code: 'COP', symbol: 'CO$', name: 'Colombian Peso', locale: 'es-CO' },

  // Asia Pacific
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', locale: 'en-NZ' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', locale: 'zh-HK' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', locale: 'ko-KR' },
  { code: 'TWD', symbol: 'NT$', name: 'New Taiwan Dollar', locale: 'zh-TW' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', locale: 'th-TH' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', locale: 'ms-MY' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', locale: 'fil-PH' },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', locale: 'vi-VN' },

  // Middle East & Africa
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', locale: 'ar-SA' },
  { code: 'ILS', symbol: '₪', name: 'Israeli Shekel', locale: 'he-IL' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
  { code: 'MAD', symbol: 'د.م.', name: 'Moroccan Dirham', locale: 'ar-MA' },
]

// Default currency for each country (ISO 3166-1 alpha-2 -> Currency code)
export const COUNTRY_DEFAULT_CURRENCY: Record<string, CurrencyCode> = {
  // Eurozone
  AT: 'EUR', // Austria
  BE: 'EUR', // Belgium
  DE: 'EUR', // Germany
  ES: 'EUR', // Spain
  FI: 'EUR', // Finland
  FR: 'EUR', // France
  GR: 'EUR', // Greece
  IE: 'EUR', // Ireland
  IT: 'EUR', // Italy
  LU: 'EUR', // Luxembourg
  MC: 'EUR', // Monaco
  NL: 'EUR', // Netherlands
  PT: 'EUR', // Portugal

  // Non-Eurozone Europe
  GB: 'GBP', // United Kingdom
  CH: 'CHF', // Switzerland
  SE: 'SEK', // Sweden
  NO: 'NOK', // Norway
  DK: 'DKK', // Denmark
  PL: 'PLN', // Poland
  CZ: 'CZK', // Czech Republic
  HU: 'HUF', // Hungary
  RO: 'RON', // Romania
  HR: 'EUR', // Croatia (joined Eurozone in 2023)

  // North America
  US: 'USD', // United States
  CA: 'CAD', // Canada
  MX: 'MXN', // Mexico

  // South America
  BR: 'BRL', // Brazil
  AR: 'ARS', // Argentina
  CL: 'CLP', // Chile
  CO: 'COP', // Colombia

  // Asia Pacific
  AU: 'AUD', // Australia
  NZ: 'NZD', // New Zealand
  JP: 'JPY', // Japan
  CN: 'CNY', // China
  IN: 'INR', // India
  SG: 'SGD', // Singapore
  HK: 'HKD', // Hong Kong
  KR: 'KRW', // South Korea
  TW: 'TWD', // Taiwan
  TH: 'THB', // Thailand
  MY: 'MYR', // Malaysia
  PH: 'PHP', // Philippines
  VN: 'VND', // Vietnam

  // Middle East & Africa
  AE: 'AED', // UAE
  SA: 'SAR', // Saudi Arabia
  IL: 'ILS', // Israel
  ZA: 'ZAR', // South Africa
  MA: 'MAD', // Morocco
}

/**
 * Get the default currency for a country
 */
export function getDefaultCurrencyForCountry(countryCode: string): CurrencyCode {
  return COUNTRY_DEFAULT_CURRENCY[countryCode] || 'EUR'
}

/**
 * Get currency by code
 */
export function getCurrencyByCode(code: CurrencyCode): Currency | undefined {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)
}

/**
 * Get currency symbol by code
 */
export function getCurrencySymbol(code: CurrencyCode): string {
  const currency = getCurrencyByCode(code)
  return currency?.symbol || code
}

/**
 * Get currencies sorted by name
 */
export function getCurrenciesSortedByName(): Currency[] {
  return [...SUPPORTED_CURRENCIES].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Format currency with dynamic currency code
 * @param amount - The amount to format
 * @param currency - The currency code (defaults to EUR)
 * @param locale - The locale for formatting (defaults to fr-FR)
 */
export function formatCurrencyValue(
  amount: number,
  currency: CurrencyCode = 'EUR',
  locale?: string
): string {
  const currencyInfo = getCurrencyByCode(currency)
  const formatLocale = locale || currencyInfo?.locale || 'fr-FR'

  return new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency: currency,
  }).format(amount)
}

/**
 * Format currency for display in charts (compact format like "10k€")
 */
export function formatCurrencyCompact(
  amount: number,
  currency: CurrencyCode = 'EUR'
): string {
  const symbol = getCurrencySymbol(currency)

  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M${symbol}`
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(0)}k${symbol}`
  }
  return `${amount.toFixed(0)}${symbol}`
}

/**
 * Format a number with currency symbol suffix (e.g., "10.50€")
 * Useful for input displays and tables
 */
export function formatAmountWithSymbol(
  amount: number,
  currency: CurrencyCode = 'EUR',
  decimals: number = 2
): string {
  const symbol = getCurrencySymbol(currency)
  return `${amount.toFixed(decimals)}${symbol}`
}
