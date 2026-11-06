"use server";

import { headers } from "next/headers";

import { revokePasswordAccess } from "@louez/auth/password";

type RevokePasswordAccessResult = { success: true } | { success: false; code: string | null };

/**
 * "This wasn't me": removes the password and signs every device out. The
 * session is checked inside the auth package, against the database. No token
 * guards the page: the action only ever locks the account down, and whoever
 * wants back in afterwards has to prove they own the mailbox.
 */
export async function revokePasswordAccessAction(): Promise<RevokePasswordAccessResult> {
  const result = await revokePasswordAccess({ headers: await headers() });
  return result.status === "success" ? { success: true } : { success: false, code: result.code };
}
