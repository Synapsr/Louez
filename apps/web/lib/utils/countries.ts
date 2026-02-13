// Country and timezone utilities for store settings

export interface Country {
  code: string      // ISO 3166-1 alpha-2
  flag: string      // Emoji flag
  timezone: string  // Primary IANA timezone
}

// Comprehensive list of countries with their primary timezones
// Sorted alphabetically by country code for easy lookup
export const SUPPORTED_COUNTRIES: Country[] = [
  // Europe
  { code: 'AT', flag: '🇦🇹', timezone: 'Europe/Vienna' },
  { code: 'BE', flag: '🇧🇪', timezone: 'Europe/Brussels' },
  { code: 'CH', flag: '🇨🇭', timezone: 'Europe/Zurich' },
  { code: 'CZ', flag: '🇨🇿', timezone: 'Europe/Prague' },
  { code: 'DE', flag: '🇩🇪', timezone: 'Europe/Berlin' },
  { code: 'DK', flag: '🇩🇰', timezone: 'Europe/Copenhagen' },
  { code: 'ES', flag: '🇪🇸', timezone: 'Europe/Madrid' },
  { code: 'FI', flag: '🇫🇮', timezone: 'Europe/Helsinki' },
  { code: 'FR', flag: '🇫🇷', timezone: 'Europe/Paris' },
  { code: 'GB', flag: '🇬🇧', timezone: 'Europe/London' },
  { code: 'GR', flag: '🇬🇷', timezone: 'Europe/Athens' },
  { code: 'HR', flag: '🇭🇷', timezone: 'Europe/Zagreb' },
  { code: 'HU', flag: '🇭🇺', timezone: 'Europe/Budapest' },
  { code: 'IE', flag: '🇮🇪', timezone: 'Europe/Dublin' },
  { code: 'IT', flag: '🇮🇹', timezone: 'Europe/Rome' },
  { code: 'LU', flag: '🇱🇺', timezone: 'Europe/Luxembourg' },
  { code: 'MC', flag: '🇲🇨', timezone: 'Europe/Monaco' },
  { code: 'NL', flag: '🇳🇱', timezone: 'Europe/Amsterdam' },
  { code: 'NO', flag: '🇳🇴', timezone: 'Europe/Oslo' },
  { code: 'PL', flag: '🇵🇱', timezone: 'Europe/Warsaw' },
  { code: 'PT', flag: '🇵🇹', timezone: 'Europe/Lisbon' },
  { code: 'RO', flag: '🇷🇴', timezone: 'Europe/Bucharest' },
  { code: 'SE', flag: '🇸🇪', timezone: 'Europe/Stockholm' },

  // North America
  { code: 'CA', flag: '🇨🇦', timezone: 'America/Toronto' },
  { code: 'MX', flag: '🇲🇽', timezone: 'America/Mexico_City' },
  { code: 'US', flag: '🇺🇸', timezone: 'America/New_York' },

  // South America
  { code: 'AR', flag: '🇦🇷', timezone: 'America/Buenos_Aires' },
  { code: 'BR', flag: '🇧🇷', timezone: 'America/Sao_Paulo' },
  { code: 'CL', flag: '🇨🇱', timezone: 'America/Santiago' },
  { code: 'CO', flag: '🇨🇴', timezone: 'America/Bogota' },

  // Asia Pacific
  { code: 'AU', flag: '🇦🇺', timezone: 'Australia/Sydney' },
  { code: 'CN', flag: '🇨🇳', timezone: 'Asia/Shanghai' },
  { code: 'HK', flag: '🇭🇰', timezone: 'Asia/Hong_Kong' },
  { code: 'IN', flag: '🇮🇳', timezone: 'Asia/Kolkata' },
  { code: 'JP', flag: '🇯🇵', timezone: 'Asia/Tokyo' },
  { code: 'KR', flag: '🇰🇷', timezone: 'Asia/Seoul' },
  { code: 'MY', flag: '🇲🇾', timezone: 'Asia/Kuala_Lumpur' },
  { code: 'NZ', flag: '🇳🇿', timezone: 'Pacific/Auckland' },
  { code: 'PH', flag: '🇵🇭', timezone: 'Asia/Manila' },
  { code: 'SG', flag: '🇸🇬', timezone: 'Asia/Singapore' },
  { code: 'TH', flag: '🇹🇭', timezone: 'Asia/Bangkok' },
  { code: 'TW', flag: '🇹🇼', timezone: 'Asia/Taipei' },
  { code: 'VN', flag: '🇻🇳', timezone: 'Asia/Ho_Chi_Minh' },

  // Middle East & Africa
  { code: 'AE', flag: '🇦🇪', timezone: 'Asia/Dubai' },
  { code: 'IL', flag: '🇮🇱', timezone: 'Asia/Jerusalem' },
  { code: 'MA', flag: '🇲🇦', timezone: 'Africa/Casablanca' },
  { code: 'SA', flag: '🇸🇦', timezone: 'Asia/Riyadh' },
  { code: 'ZA', flag: '🇿🇦', timezone: 'Africa/Johannesburg' },
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

export function getCountryFlag(code: string): string {
  const country = getCountryByCode(code)
  return country?.flag || '🏳️'
}

// Format country for display: "🇫🇷 France"
export function formatCountryDisplay(code: string, locale: string = 'fr'): string {
  const flag = getCountryFlag(code)
  const name = getCountryName(code, locale)
  return `${flag} ${name}`
}
