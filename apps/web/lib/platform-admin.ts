/**
 * Platform Admin Module
 *
 * Provides secure platform-level admin access for impersonation.
 * Admin emails are configured via PLATFORM_ADMIN_EMAILS environment variable.
 *
 * SECURITY NOTES:
 * - This module must ONLY be used in Server Components and Server Actions
 * - The environment variable is read at RUNTIME (not build time)
 * - Never expose admin status to the client
 * - All admin access should be logged for audit purposes
 */

import { auth } from '@/lib/auth'
import { env } from '@/env'

/**
 * Parses the admin emails from environment variable
 * Returns an empty array if not configured
 */
function getAdminEmails(): string[] {
  // env.PLATFORM_ADMIN_EMAILS is already an array, transformed in env.ts
  return env.PLATFORM_ADMIN_EMAILS
}

/**
 * Checks if an email is a platform admin
 *
 * @param email - The email to check
 * @returns true if the email is in the admin list
 */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false

  const adminEmails = getAdminEmails()

  // No admins configured - feature is disabled
  if (adminEmails.length === 0) {
    return false
  }

  // Exact match comparison (case-insensitive)
  return adminEmails.includes(email.toLowerCase().trim())
}

/**
 * Checks if the current authenticated user is a platform admin
 * Must be called from Server Components or Server Actions only
 *
 * @returns true if the current user is a platform admin
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  const session = await auth()

  if (!session?.user?.email) {
    return false
  }

  return isPlatformAdmin(session.user.email)
}
