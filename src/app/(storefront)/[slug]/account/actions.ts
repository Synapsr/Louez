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

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function sendVerificationCode(storeId: string, email: string, locale?: 'fr' | 'en') {
  try {
    // Get the store
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
    })

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Check if customer exists for this store
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

    // Set cookie
    const cookieStore = await cookies()
    cookieStore.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
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
