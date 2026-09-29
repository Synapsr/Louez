import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { accounts, db, sessions } from "@louez/db";
import { isEmailConfigured } from "@louez/email";

import { authInstance } from "./index";
import { sendPasswordChangedNotice } from "./password-notice";
import { consumePasswordOperation } from "./password-rate-limit";
import { getLocaleFromHeaders } from "./request-locale";

// better-auth stores an e-mail + password pair as an account of this provider.
const CREDENTIAL_PROVIDER_ID = "credential";

/**
 * Outcome of a password operation. `code` is a better-auth error code (or one
 * of the PASSWORD_* codes below) that callers map to a translated message —
 * raw messages never reach the UI.
 */
export type PasswordOperationResult =
  | { status: "success" }
  | { status: "error"; code: string | null };

interface PasswordOperationInput {
  /** Headers of the incoming request: they carry the session cookie. */
  headers: Headers;
}

const toErrorResult = (error: unknown): PasswordOperationResult => {
  // Anything that is not a better-auth refusal (database down, …) is a real
  // failure and keeps bubbling up to the caller's error boundary.
  if (!(error instanceof APIError)) throw error;

  const code = error.body?.code;
  return { status: "error", code: typeof code === "string" ? code : null };
};

/**
 * Reads the session from the database, never from the 5-minute cookie cache:
 * a session revoked a minute ago must not be able to touch the password.
 */
async function requireSession(headers: Headers) {
  const session = await authInstance.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) {
    throw new APIError("UNAUTHORIZED", { message: "Unauthorized", code: "UNAUTHORIZED" });
  }
  return session;
}

/**
 * The e-mail code is the sign-in method that remains once a password is gone.
 * An instance without a mail transport (self-host without SMTP) cannot deliver
 * it: removing the password there would lock the owner out.
 */
export const canRemovePassword = (): boolean => isEmailConfigured();

const assertWithinRateLimit = async (userId: string) => {
  if (await consumePasswordOperation(userId)) return;
  throw new APIError("TOO_MANY_REQUESTS", {
    message: "Too many password operations",
    code: "TOO_MANY_REQUESTS",
  });
};

const assertPasswordRemovable = () => {
  if (canRemovePassword()) return;
  throw new APIError("FORBIDDEN", {
    message: "The password is the only sign-in method on this instance",
    code: "PASSWORD_REMOVAL_UNAVAILABLE",
  });
};

/** Adds a first password to an account that signs in by e-mail code or Google. */
export async function setAccountPassword({
  headers,
  newPassword,
}: PasswordOperationInput & { newPassword: string }): Promise<PasswordOperationResult> {
  try {
    const session = await requireSession(headers);
    await assertWithinRateLimit(session.user.id);
    await authInstance.api.setPassword({ body: { newPassword }, headers });
    // Same guarantee as changePassword({ revokeOtherSessions }): a password
    // set from one device never leaves the other sessions standing.
    await authInstance.api.revokeOtherSessions({ headers });
    await sendPasswordChangedNotice({
      email: session.user.email,
      event: "added",
      locale: getLocaleFromHeaders(headers),
    });
    return { status: "success" };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * Removes the password. better-auth's own `unlinkAccount` cannot do it: it
 * refuses to remove the last account row, and an owner who signs in by e-mail
 * code has no other row — the code needs none.
 */
export async function removeAccountPassword({
  headers,
}: PasswordOperationInput): Promise<PasswordOperationResult> {
  try {
    const session = await requireSession(headers);
    assertPasswordRemovable();
    await assertWithinRateLimit(session.user.id);

    const [deletion] = await db
      .delete(accounts)
      .where(
        and(eq(accounts.userId, session.user.id), eq(accounts.providerId, CREDENTIAL_PROVIDER_ID)),
      );
    if (deletion.affectedRows === 0) {
      throw new APIError("BAD_REQUEST", {
        message: "No password is set on this account",
        code: "CREDENTIAL_ACCOUNT_NOT_FOUND",
      });
    }

    await sendPasswordChangedNotice({
      email: session.user.email,
      event: "removed",
      locale: getLocaleFromHeaders(headers),
    });
    return { status: "success" };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * "This wasn't me": removes the password and signs every device out, the
 * caller's included. Whoever wants back in has to prove they own the mailbox
 * with an e-mail code, which is the one thing an intruder holding a stolen
 * session cannot do.
 */
export async function revokePasswordAccess({
  headers,
}: PasswordOperationInput): Promise<PasswordOperationResult> {
  try {
    const session = await requireSession(headers);
    assertPasswordRemovable();

    await db.transaction(async (tx) => {
      await tx
        .delete(accounts)
        .where(
          and(
            eq(accounts.userId, session.user.id),
            eq(accounts.providerId, CREDENTIAL_PROVIDER_ID),
          ),
        );
      await tx.delete(sessions).where(eq(sessions.userId, session.user.id));
    });
    return { status: "success" };
  } catch (error) {
    return toErrorResult(error);
  }
}
