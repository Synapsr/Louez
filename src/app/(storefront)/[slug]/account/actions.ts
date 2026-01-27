'use server'

import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import {
  customers,
  verificationCodes,
  customerSessions,
  stores,
} from '@/lib/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { sendVerificationCodeEmail } from '@/lib/email/send'

const CUSTOMER_SESSION_COOKIE = 'customer_session'
const SESSION_DURATION_DAYS = 30

// ===== RATE LIMITING =====
// Prevents brute-force attacks on verification codes (6-digit = 1M combinations)
// Uses in-memory store - for multi-instance deployments, consider Redis

interface RateLimitEntry {
  attempts: number
  firstAttempt: number
  blockedUntil?: number
}

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 5 // Max attempts per window
const BLOCK_DURATION_MS = 30 * 60 * 1000 // 30 minutes block after max attempts

// In-memory rate limit store (use Redis in production for multi-instance)
const verifyRateLimits = new Map<string, RateLimitEntry>()
const sendCodeRateLimits = new Map<string, RateLimitEntry>()

// Cleanup old entries periodically (every 5 minutes)
let lastCleanup = Date.now()
function cleanupRateLimits() {
  const now = Date.now()
  if (now - lastCleanup < 5 * 60 * 1000) return

  lastCleanup = now
  const cutoff = now - RATE_LIMIT_WINDOW_MS

  for (const [key, entry] of verifyRateLimits) {
    if (entry.firstAttempt < cutoff && (!entry.blockedUntil || entry.blockedUntil < now)) {
      verifyRateLimits.delete(key)
    }
  }
  for (const [key, entry] of sendCodeRateLimits) {
    if (entry.firstAttempt < cutoff && (!entry.blockedUntil || entry.blockedUntil < now)) {
      sendCodeRateLimits.delete(key)
    }
  }
}

function checkRateLimit(
  map: Map<string, RateLimitEntry>,
  key: string,
  maxAttempts: number = MAX_ATTEMPTS
): { allowed: boolean; retryAfter?: number } {
  cleanupRateLimits()

  const now = Date.now()
  const entry = map.get(key)

  if (!entry) {
    map.set(key, { attempts: 1, firstAttempt: now })
    return { allowed: true }
  }

  // Check if currently blocked
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    }
  }

  // Reset if window has passed
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    map.set(key, { attempts: 1, firstAttempt: now })
    return { allowed: true }
  }

  // Increment and check
  entry.attempts++

  if (entry.attempts > maxAttempts) {
    entry.blockedUntil = now + BLOCK_DURATION_MS
    return {
      allowed: false,
      retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000),
    }
  }

  return { allowed: true }
}

function resetRateLimit(map: Map<string, RateLimitEntry>, key: string) {
  map.delete(key)
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function sendVerificationCode(storeId: string, email: string, locale?: 'fr' | 'en') {
  try {
    // SECURITY: Validate storeId format (21-char nanoid)
    if (!storeId || typeof storeId !== 'string' || storeId.length !== 21) {
      return { error: 'errors.storeNotFound' }
    }

    // Rate limiting: max 3 code requests per 15 min per email+store
    const rateLimitKey = `${storeId}:${email.toLowerCase()}`
    const rateCheck = checkRateLimit(sendCodeRateLimits, rateLimitKey, 3)

    if (!rateCheck.allowed) {
      return {
        error: 'errors.tooManyRequests',
        retryAfter: rateCheck.retryAfter,
      }
    }

    // Get the store
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
    })

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Check if customer exists for this store
    // NOTE: Using same error message for security (prevent email enumeration)
    const customer = await db.query.customers.findFirst({
      where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
    })

    if (!customer) {
      return { error: 'errors.noReservationForEmail' }
    }

    // Generate verification code
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Store the code
    await db.insert(verificationCodes).values({
      email,
      storeId,
      code,
      type: 'code',
      expiresAt,
    })

    // Send verification email
    try {
      await sendVerificationCodeEmail({
        to: email,
        store: {
          id: store.id,
          name: store.name,
          logoUrl: store.logoUrl,
          darkLogoUrl: store.darkLogoUrl,
          theme: store.theme,
        },
        code,
        locale: locale || 'fr',
      })
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError)
      // Still return success - code is stored and will be logged in dev
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV] Verification code for ${email}: ${code}`)
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error sending verification code:', error)
    return { error: 'errors.sendCodeError' }
  }
}

export async function verifyCode(storeId: string, email: string, code: string) {
  try {
    // SECURITY: Validate storeId format (21-char nanoid)
    if (!storeId || typeof storeId !== 'string' || storeId.length !== 21) {
      return { error: 'errors.storeNotFound' }
    }

    // Rate limiting: max 5 attempts per 15 min per email+store
    // SECURITY: Prevents brute-force attacks on 6-digit codes (1M combinations)
    const rateLimitKey = `${storeId}:${email.toLowerCase()}`
    const rateCheck = checkRateLimit(verifyRateLimits, rateLimitKey, 5)

    if (!rateCheck.allowed) {
      return {
        error: 'errors.tooManyAttempts',
        retryAfter: rateCheck.retryAfter,
      }
    }

    // Validate code format (6 digits only)
    if (!/^\d{6}$/.test(code)) {
      return { error: 'errors.invalidOrExpiredCode' }
    }

    // Find valid verification code
    const verification = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.storeId, storeId),
        eq(verificationCodes.email, email),
        eq(verificationCodes.code, code),
        gt(verificationCodes.expiresAt, new Date())
      ),
    })

    if (!verification) {
      return { error: 'errors.invalidOrExpiredCode' }
    }

    // Mark code as used
    await db
      .update(verificationCodes)
      .set({ usedAt: new Date() })
      .where(eq(verificationCodes.id, verification.id))

    // Reset rate limit on successful verification
    resetRateLimit(verifyRateLimits, rateLimitKey)

    // Find customer
    const customer = await db.query.customers.findFirst({
      where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
    })

    if (!customer) {
      return { error: 'errors.customerNotFound' }
    }

    // Create session
    const sessionToken = nanoid(32)
    const expiresAt = new Date(
      Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    await db.insert(customerSessions).values({
      customerId: customer.id,
      token: sessionToken,
      expiresAt,
    })

    // Set cookie with secure settings
    const cookieStore = await cookies()
    cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', // More restrictive than 'lax'
      expires: expiresAt,
      path: '/',
    })

    return { success: true, customerId: customer.id }
  } catch (error) {
    console.error('Error verifying code:', error)
    return { error: 'errors.verificationError' }
  }
}

export async function getCustomerSession(storeSlug: string) {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value

    if (!sessionToken) {
      return null
    }

    // Get store
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, storeSlug),
    })

    if (!store) {
      return null
    }

    // Find valid session
    const session = await db.query.customerSessions.findFirst({
      where: and(
        eq(customerSessions.token, sessionToken),
        gt(customerSessions.expiresAt, new Date())
      ),
      with: {
        customer: true,
      },
    })

    if (!session || session.customer.storeId !== store.id) {
      return null
    }

    return {
      customerId: session.customer.id,
      customer: session.customer,
    }
  } catch {
    return null
  }
}

export async function logout() {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value

    if (sessionToken) {
      // Delete session from database
      await db
        .delete(customerSessions)
        .where(eq(customerSessions.token, sessionToken))

      // Clear cookie
      cookieStore.delete(CUSTOMER_SESSION_COOKIE)
    }

    return { success: true }
  } catch (error) {
    console.error('Error logging out:', error)
    return { error: 'errors.logoutError' }
  }
}
