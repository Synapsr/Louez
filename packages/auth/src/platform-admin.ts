/**
 * Platform admins: Louez staff who may open any store. Their emails come from
 * PLATFORM_ADMIN_EMAILS, a comma-separated list read at runtime.
 */

function getAdminEmails(): string[] {
  // Read and parse the raw value directly. The app's env.PLATFORM_ADMIN_EMAILS
  // is typed string[] (split in apps/web/env.ts), but that transform is skipped
  // under SKIP_ENV_VALIDATION, leaving a raw CSV string. A substring
  // `includes()` on a raw string would let any email contained in the
  // configured value pass as a platform admin, so we parse to an array here and
  // keep membership an exact check.
  const configured = process.env.PLATFORM_ADMIN_EMAILS;
  if (!configured) return [];
  return configured
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the email is in the admin list (exact, case-insensitive). */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0) return false;
  return adminEmails.includes(email.toLowerCase().trim());
}
