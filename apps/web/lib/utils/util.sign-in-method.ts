/** Label sent to analytics and to the platform's sign-in notifications. */
export type SignInMethod = "google" | "magic link" | "password";

interface SignInMethodInput {
  /** better-auth endpoint that created the session; null outside a request. */
  path: string | null;
  hasGoogleAccount: boolean;
}

/**
 * How the user just signed in, or null when the new session is not a sign-in.
 * `magic link` covers both passwordless e-mail methods (link and code): the
 * label predates the code and downstream dashboards group on it.
 */
export function inferSignInMethod({
  path,
  hasGoogleAccount,
}: SignInMethodInput): SignInMethod | null {
  // Changing a password re-issues the session it keeps: nobody signed in.
  if (path === "/change-password") {
    return null;
  }

  if (path === "/sign-in/email" || path === "/sign-up/email") {
    return "password";
  }

  if (path === "/sign-in/email-otp" || path === "/magic-link/verify") {
    return "magic link";
  }

  if (path?.startsWith("/callback/")) {
    return "google";
  }

  // Unknown endpoint: fall back to what the account looks like.
  return hasGoogleAccount ? "google" : "magic link";
}
