const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No 0, O, 1, I
const REFERRAL_PREFIX = 'LOUEZ'
const REFERRAL_RANDOM_LENGTH = 7
const REFERRAL_REGEX = /^LOUEZ[A-HJ-NP-Z2-9]{7}$/

/**
 * Generates a unique referral code with the format LOUEZ + 7 random chars.
 * Uses an unambiguous alphabet (no 0/O/1/I) for readability.
 */
export function generateReferralCode(): string {
  let code = REFERRAL_PREFIX
  for (let i = 0; i < REFERRAL_RANDOM_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * REFERRAL_ALPHABET.length)
    code += REFERRAL_ALPHABET[randomIndex]
  }
  return code
}

/**
 * Validates a referral code format (does not check DB existence).
 */
export function isValidReferralCode(code: string): boolean {
  return REFERRAL_REGEX.test(code)
}
