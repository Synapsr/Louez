/**
 * Seed Script Utilities
 *
 * Helper functions for ID generation, date manipulation, and random selection.
 */

import { nanoid } from 'nanoid'
import { faker } from '@faker-js/faker/locale/fr'

/**
 * Generate a nanoid (21 characters) - matches the schema
 */
export function generateId(): string {
  return nanoid()
}

/**
 * Generate a fake Stripe ID with seed_ prefix
 */
export function generateStripeId(prefix: string): string {
  return `seed_${prefix}_${nanoid(24)}`
}

/**
 * Generate a referral code (12 characters)
 */
export function generateReferralCode(): string {
  return nanoid(12).toUpperCase()
}

/**
 * Generate an ICS token (32 characters)
 */
export function generateIcsToken(): string {
  return nanoid(32)
}

/**
 * Generate a session token
 */
export function generateToken(length = 64): string {
  return nanoid(length)
}

/**
 * Generate a UUID v4 for analytics session tracking
 */
export function generateSessionId(): string {
  return faker.string.uuid()
}

/**
 * Pick a random item from an array
 */
export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * Pick multiple random items from an array (without duplicates)
 */
export function pickRandomMultiple<T>(items: T[], count: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, items.length))
}

/**
 * Generate a random number in a range
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Generate a random decimal in a range
 */
export function randomDecimal(min: number, max: number, decimals = 2): string {
  const value = Math.random() * (max - min) + min
  return value.toFixed(decimals)
}

/**
 * Return true with given probability (0-1)
 */
export function chance(probability: number): boolean {
  return Math.random() < probability
}

/**
 * Generate a random date between two dates
 */
export function randomDate(start: Date, end: Date): Date {
  const startTime = start.getTime()
  const endTime = end.getTime()
  const randomTime = startTime + Math.random() * (endTime - startTime)
  return new Date(randomTime)
}

/**
 * Add hours to a date
 */
export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Add minutes to a date
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

/**
 * Set time on a date
 */
export function setTime(date: Date, hours: number, minutes = 0): Date {
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result
}

/**
 * Get start of day
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * Get end of day
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

/**
 * Check if date is in the past
 */
export function isPast(date: Date): boolean {
  return date < new Date()
}

/**
 * Check if date is in the future
 */
export function isFuture(date: Date): boolean {
  return date > new Date()
}

/**
 * Generate a French phone number
 */
export function generateFrenchPhone(): string {
  const prefixes = ['06', '07']
  const prefix = pickRandom(prefixes)
  const rest = faker.string.numeric(8)
  return `${prefix}${rest}`
}

/**
 * Generate a formatted French phone number
 */
export function generateFormattedFrenchPhone(): string {
  const phone = generateFrenchPhone()
  return phone.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
}

/**
 * Generate a French postal code
 */
export function generateFrenchPostalCode(): string {
  // Major French cities
  const commonPostalCodes = [
    '75001', '75002', '75003', '75004', '75005', '75006', '75007', '75008', // Paris
    '69001', '69002', '69003', // Lyon
    '13001', '13002', '13003', // Marseille
    '31000', '31100', '31200', // Toulouse
    '33000', '33100', '33200', // Bordeaux
    '44000', '44100', '44200', // Nantes
    '59000', '59100', '59200', // Lille
    '67000', '67100', '67200', // Strasbourg
    '06000', '06100', '06200', // Nice
  ]
  return pickRandom(commonPostalCodes)
}

/**
 * Get city name from postal code
 */
export function getCityFromPostalCode(postalCode: string): string {
  const cities: Record<string, string> = {
    '75': 'Paris',
    '69': 'Lyon',
    '13': 'Marseille',
    '31': 'Toulouse',
    '33': 'Bordeaux',
    '44': 'Nantes',
    '59': 'Lille',
    '67': 'Strasbourg',
    '06': 'Nice',
  }
  const prefix = postalCode.substring(0, 2)
  return cities[prefix] || 'Paris'
}

/**
 * Generate a random IP address
 */
export function generateIpAddress(): string {
  return `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`
}

/**
 * Generate a reservation number for a store
 */
export function generateReservationNumber(counter: number): string {
  return `R-${counter.toString().padStart(5, '0')}`
}

/**
 * Generate a product unit identifier (serial number style)
 */
export function generateUnitIdentifier(prefix: string, index: number): string {
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${(index + 1).toString().padStart(3, '0')}`
}

/**
 * Weighted random selection
 */
export function weightedRandom<T>(items: { item: T; weight: number }[]): T {
  const totalWeight = items.reduce((sum, { weight }) => sum + weight, 0)
  let random = Math.random() * totalWeight

  for (const { item, weight } of items) {
    random -= weight
    if (random <= 0) {
      return item
    }
  }

  return items[items.length - 1].item
}

/**
 * Progress logger
 */
export function logProgress(current: number, total: number, label: string): void {
  const percent = Math.round((current / total) * 100)
  const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5))
  process.stdout.write(`\r  [${bar}] ${percent}% ${label}`)
  if (current === total) {
    console.log('')
  }
}

/**
 * Console colors
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

/**
 * Log a success message
 */
export function logSuccess(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

/**
 * Log an info message
 */
export function logInfo(message: string): void {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`)
}

/**
 * Log a warning message
 */
export function logWarning(message: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

/**
 * Log an error message
 */
export function logError(message: string): void {
  console.log(`${colors.red}✗${colors.reset} ${message}`)
}

/**
 * Log a section header
 */
export function logSection(title: string): void {
  console.log('')
  console.log(`${colors.cyan}${colors.bold}▶ ${title}${colors.reset}`)
}
