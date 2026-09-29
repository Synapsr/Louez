"use server";

import { headers } from "next/headers";

import { z } from "zod";

import { removeAccountPassword, setAccountPassword } from "@louez/auth/password";
import { MAX_PASSWORD_LENGTH } from "@louez/auth/password-policy";

// The length rule itself is enforced by better-auth, which answers with the
// precise code (PASSWORD_TOO_SHORT / PASSWORD_TOO_LONG); the form applies the
// same bounds first. The cap here only keeps an absurd payload, which the form
// cannot produce, away from the password hasher.
const setPasswordSchema = z.object({
  newPassword: z.string().max(MAX_PASSWORD_LENGTH),
});

type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/**
 * `code` is a better-auth error code; the client maps it to a translated
 * message with `resolveAuthErrorMessage`. The session is checked inside the
 * auth package, against the database rather than the cached session cookie,
 * and both operations are rate limited per user there (they send an e-mail).
 */
type PasswordActionResult = { success: true } | { success: false; code: string | null };

// Setting a first password asks for no current password, which is why
// better-auth exposes it to the server only — never as a public endpoint.
export async function setPassword(input: SetPasswordInput): Promise<PasswordActionResult> {
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, code: null };
  }

  const result = await setAccountPassword({
    headers: await headers(),
    newPassword: parsed.data.newPassword,
  });
  return result.status === "success" ? { success: true } : { success: false, code: result.code };
}

export async function removePassword(): Promise<PasswordActionResult> {
  const result = await removeAccountPassword({ headers: await headers() });
  return result.status === "success" ? { success: true } : { success: false, code: result.code };
}
