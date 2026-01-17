/**
 * Phone Number Validation and Normalization
 *
 * Handles international phone number formats for SMS sending.
 * Supports various input formats and normalizes to E.164 format (+XXXXXXXXXXX)
 */

/**
 * Common country codes and their national number lengths
 * This is a simplified list - real-world validation would use libphonenumber
 */
const COUNTRY_CODES: Record<string, { code: string; lengths: number[] }> = {
  FR: { code: '33', lengths: [9] }, // France: 9 digits after country code
  BE: { code: '32', lengths: [8, 9] }, // Belgium
  CH: { code: '41', lengths: [9] }, // Switzerland
  LU: { code: '352', lengths: [8, 9] }, // Luxembourg
  DE: { code: '49', lengths: [10, 11] }, // Germany
  ES: { code: '34', lengths: [9] }, // Spain
  IT: { code: '39', lengths: [9, 10] }, // Italy
  PT: { code: '351', lengths: [9] }, // Portugal
  NL: { code: '31', lengths: [9] }, // Netherlands
  GB: { code: '44', lengths: [10] }, // United Kingdom
  US: { code: '1', lengths: [10] }, // United States/Canada
  PL: { code: '48', lengths: [9] }, // Poland
  AT: { code: '43', lengths: [10, 11] }, // Austria
}

/**
 * Result of phone number validation
 */
export interface PhoneValidationResult {
  valid: boolean
  normalized: string | null
  error?: string
  detectedCountry?: string
}

/**
 * Clean a phone number by removing all non-digit characters except leading +
 */
function cleanPhoneNumber(phone: string): string {
  // Preserve leading + if present
  const hasPlus = phone.trim().startsWith('+')
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  return hasPlus ? `+${digits}` : digits
}

/**
 * Detect if a number starts with a known country code
 */
function detectCountryCode(digits: string): { country: string; code: string; nationalNumber: string } | null {
  // Sort by code length descending to match longer codes first (e.g., 352 before 32)
  const sortedCountries = Object.entries(COUNTRY_CODES).sort(
    (a, b) => b[1].code.length - a[1].code.length
  )

  for (const [country, { code }] of sortedCountries) {
    if (digits.startsWith(code)) {
      return {
        country,
        code,
        nationalNumber: digits.slice(code.length),
      }
    }
  }
  return null
}

/**
 * Validate and normalize a phone number to E.164 format
 *
 * Supported input formats:
 * - International with +: +33612345678, +33 6 12 34 56 78
 * - International with 00: 0033612345678, 00 33 6 12 34 56 78
 * - National French: 0612345678, 06 12 34 56 78
 * - With various separators: 06-12-34-56-78, (06) 12.34.56.78
 *
 * @param phone - The phone number to validate
 * @param defaultCountryCode - Default country code if none detected (default: FR)
 * @returns Validation result with normalized number or error
 */
export function validateAndNormalizePhone(
  phone: string,
  defaultCountryCode: keyof typeof COUNTRY_CODES = 'FR'
): PhoneValidationResult {
  if (!phone || typeof phone !== 'string') {
    return {
      valid: false,
      normalized: null,
      error: 'Phone number is required',
    }
  }

  // Clean the input
  const cleaned = cleanPhoneNumber(phone)

  // Handle empty after cleaning
  if (!cleaned || cleaned === '+') {
    return {
      valid: false,
      normalized: null,
      error: 'Invalid phone number format',
    }
  }

  let digits: string
  let detectedCountry: string | undefined

  // Case 1: Already has + prefix (international format)
  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1)
    const detection = detectCountryCode(digits)
    if (detection) {
      detectedCountry = detection.country
      // Validate national number length
      const countryInfo = COUNTRY_CODES[detection.country]
      if (!countryInfo.lengths.includes(detection.nationalNumber.length)) {
        // Allow some flexibility - just check minimum length
        if (detection.nationalNumber.length < 7) {
          return {
            valid: false,
            normalized: null,
            error: `Invalid phone number length for ${detection.country}`,
          }
        }
      }
    }
    // Return as-is if starts with +
    return {
      valid: true,
      normalized: `+${digits}`,
      detectedCountry,
    }
  }

  // Case 2: Starts with 00 (international prefix)
  if (cleaned.startsWith('00')) {
    digits = cleaned.slice(2)
    const detection = detectCountryCode(digits)
    if (detection) {
      detectedCountry = detection.country
    }
    return {
      valid: true,
      normalized: `+${digits}`,
      detectedCountry,
    }
  }

  // Case 3: National format - needs country code
  digits = cleaned

  // For French numbers starting with 0, remove the leading 0
  const defaultInfo = COUNTRY_CODES[defaultCountryCode]
  if (digits.startsWith('0') && defaultCountryCode === 'FR') {
    digits = digits.slice(1)
  } else if (digits.startsWith('0')) {
    // For other countries, also try removing leading 0 (common pattern)
    digits = digits.slice(1)
  }

  // Validate length for default country
  if (defaultInfo && !defaultInfo.lengths.includes(digits.length)) {
    // Be flexible - just check minimum viable length
    if (digits.length < 7) {
      return {
        valid: false,
        normalized: null,
        error: 'Phone number is too short',
      }
    }
    if (digits.length > 15) {
      return {
        valid: false,
        normalized: null,
        error: 'Phone number is too long',
      }
    }
  }

  // Add default country code
  return {
    valid: true,
    normalized: `+${defaultInfo.code}${digits}`,
    detectedCountry: defaultCountryCode,
  }
}

/**
 * Quick check if a phone number looks valid (basic format check)
 * Use validateAndNormalizePhone for full validation
 */
export function isValidPhoneFormat(phone: string): boolean {
  if (!phone) return false
  const cleaned = cleanPhoneNumber(phone)
  const digits = cleaned.replace('+', '')
  // Basic check: should have 7-15 digits
  return digits.length >= 7 && digits.length <= 15
}

/**
 * Format a phone number for display (adds spaces for readability)
 */
export function formatPhoneForDisplay(phone: string): string {
  const result = validateAndNormalizePhone(phone)
  if (!result.valid || !result.normalized) {
    return phone // Return original if can't normalize
  }

  const normalized = result.normalized
  // Format: +33 6 12 34 56 78
  if (normalized.startsWith('+33') && normalized.length === 12) {
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 4)} ${normalized.slice(4, 6)} ${normalized.slice(6, 8)} ${normalized.slice(8, 10)} ${normalized.slice(10, 12)}`
  }

  // Generic formatting: +XX XXX XXX XXXX
  return normalized.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d+)/, '$1 $2 $3 $4')
}
