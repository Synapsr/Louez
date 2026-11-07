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

import { isPlatformAdmin } from "@louez/auth/platform-admin";

import { auth } from "@/lib/auth";

export { isPlatformAdmin };

/**
 * Checks if the current authenticated user is a platform admin
 * Must be called from Server Components or Server Actions only
 *
 * @returns true if the current user is a platform admin
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  const session = await auth();

  if (!session?.user?.email) {
    return false;
  }

  return isPlatformAdmin(session.user.email);
}
