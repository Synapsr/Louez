'use server'

import { cookies } from 'next/headers'

/**
 * Set the current store ID cookie securely from the server.
 * This replaces client-side document.cookie to ensure httpOnly is set,
 * protecting against XSS attacks.
 */
export async function setCurrentStoreAction(storeId: string) {
  const cookieStore = await cookies()
  cookieStore.set('currentStoreId', storeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  })
}
