// Country and timezone utilities for store settings

export interface Country {
  code: string      // ISO 3166-1 alpha-2
  timezone: string  // Primary IANA timezone
}

// Comprehensive list of countries with their primary timezones
// Sorted alphabetically by country code for easy lookup
export const SUPPORTED_COUNTRIES: Country[] = [
  // Europe
  { code: 'AT', timezone: 'Europe/Vienna' },
  { code: 'BE', timezone: 'Europe/Brussels' },
  { code: 'CH', timezone: 'Europe/Zurich' },
  { code: 'CZ', timezone: 'Europe/Prague' },
  { code: 'DE', timezone: 'Europe/Berlin' },
  { code: 'DK', timezone: 'Europe/Copenhagen' },
  { code: 'ES', timezone: 'Europe/Madrid' },
  { code: 'FI', timezone: 'Europe/Helsinki' },
  { code: 'FR', timezone: 'Europe/Paris' },
  { code: 'GB', timezone: 'Europe/London' },
  { code: 'GR', timezone: 'Europe/Athens' },
  { code: 'HR', timezone: 'Europe/Zagreb' },
  { code: 'HU', timezone: 'Europe/Budapest' },
  { code: 'IE', timezone: 'Europe/Dublin' },
  { code: 'IT', timezone: 'Europe/Rome' },
  { code: 'LU', timezone: 'Europe/Luxembourg' },
  { code: 'MC', timezone: 'Europe/Monaco' },
  { code: 'NL', timezone: 'Europe/Amsterdam' },
  { code: 'NO', timezone: 'Europe/Oslo' },
  { code: 'PL', timezone: 'Europe/Warsaw' },
  { code: 'PT', timezone: 'Europe/Lisbon' },
  { code: 'RO', timezone: 'Europe/Bucharest' },
  { code: 'SE', timezone: 'Europe/Stockholm' },

  // North America
  { code: 'CA', timezone: 'America/Toronto' },
  { code: 'MX', timezone: 'America/Mexico_City' },
  { code: 'US', timezone: 'America/New_York' },

  // South America
  { code: 'AR', timezone: 'America/Buenos_Aires' },
  { code: 'BR', timezone: 'America/Sao_Paulo' },
  { code: 'CL', timezone: 'America/Santiago' },
  { code: 'CO', timezone: 'America/Bogota' },

  // Asia Pacific
  { code: 'AU', timezone: 'Australia/Sydney' },
  { code: 'CN', timezone: 'Asia/Shanghai' },
  { code: 'HK', timezone: 'Asia/Hong_Kong' },
  { code: 'IN', timezone: 'Asia/Kolkata' },
  { code: 'JP', timezone: 'Asia/Tokyo' },
  { code: 'KR', timezone: 'Asia/Seoul' },
  { code: 'MY', timezone: 'Asia/Kuala_Lumpur' },
  { code: 'NZ', timezone: 'Pacific/Auckland' },
  { code: 'PH', timezone: 'Asia/Manila' },
  { code: 'SG', timezone: 'Asia/Singapore' },
  { code: 'TH', timezone: 'Asia/Bangkok' },
  { code: 'TW', timezone: 'Asia/Taipei' },
  { code: 'VN', timezone: 'Asia/Ho_Chi_Minh' },

  // Middle East & Africa
  { code: 'AE', timezone: 'Asia/Dubai' },
  { code: 'IL', timezone: 'Asia/Jerusalem' },
  { code: 'MA', timezone: 'Africa/Casablanca' },
  { code: 'SA', timezone: 'Asia/Riyadh' },
  { code: 'ZA', timezone: 'Africa/Johannesburg' },
]

// Sort by translated name for display (will be sorted at runtime)
export function getCountriesSortedByName(locale: string = 'fr'): Country[] {
  return [...SUPPORTED_COUNTRIES].sort((a, b) => {
    const nameA = getCountryName(a.code, locale)
    const nameB = getCountryName(b.code, locale)
    return nameA.localeCompare(nameB, locale)
  })
}

export function getCountryByCode(code: string): Country | undefined {
  return SUPPORTED_COUNTRIES.find((c) => c.code === code)
}

export function getTimezoneForCountry(countryCode: string): string {
  const country = getCountryByCode(countryCode)
  return country?.timezone || 'Europe/Paris' // Default to Paris
}

export function getCountryName(code: string, locale: string = 'fr'): string {
  try {
    const regionNames = new Intl.DisplayNames([locale], { type: 'region' })
    return regionNames.of(code) || code
  } catch {
    // Fallback to code if Intl API fails
    return code
  }
}
