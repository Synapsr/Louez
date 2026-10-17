import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { APIError, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { z } from "zod";

const RECENT_SESSION_MS = 10 * 60 * 1000;
type PasskeyHookContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
const managementPaths = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

const passkeyName = z.string().trim().min(1).max(100);
const registrationInput = z.object({ name: passkeyName.optional() }).passthrough();
const updateInput = z.object({ id: z.string().min(1).max(21), name: passkeyName });

/** Enforced on the verified authenticator data, never on a client-supplied flag. */
const requireUserVerification = (userVerified: boolean | undefined): void => {
  if (userVerified === true) return;
  throw new APIError("FORBIDDEN", {
    code: "PASSKEY_USER_VERIFICATION_REQUIRED",
    message: "Verify your identity with your device to use a passkey",
  });
};

export const createPasskeyOptions = (
  authUrl: string | undefined,
): Parameters<typeof passkey>[0] => {
  // Docker builds deliberately omit runtime configuration. Fail closed if it is
  // also missing at runtime: an empty origin allowlist cannot verify a ceremony.
  const url = authUrl ? new URL(authUrl) : null;
  return {
    rpName: "Louez",
    // Keep management credentials scoped to the auth host, not tenant subdomains.
    rpID: url?.hostname ?? "passkeys.invalid",
    origin: url?.origin ?? [],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    registration: {
      requireSession: true,
      afterVerification: ({ verification }) => {
        requireUserVerification(verification.registrationInfo?.userVerified);
        return { name: getAuthenticatorName(verification.registrationInfo?.aaguid) };
      },
    },
    authentication: {
      afterVerification: ({ verification }) => {
        requireUserVerification(verification.authenticationInfo.userVerified);
      },
    },
  };
};

/** Cookie-cached or old sessions cannot enroll a new sign-in method or revoke one. */
export const passkeyBefore = async (ctx: PasskeyHookContext) => {
  const isManagement = managementPaths.has(ctx.path);
  if (!isManagement && ctx.path !== "/passkey/list-user-passkeys") return;

  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session) {
    throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Unauthorized" });
  }
  if (isManagement) {
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= RECENT_SESSION_MS) {
      throw new APIError("FORBIDDEN", {
        code: "SESSION_NOT_FRESH",
        message: "Sign in again before managing passkeys",
      });
    }
  }

  const input =
    ctx.path === "/passkey/verify-registration"
      ? registrationInput.safeParse(ctx.body)
      : ctx.path === "/passkey/update-passkey"
        ? updateInput.safeParse(ctx.body)
        : ctx.path === "/passkey/generate-register-options"
          ? registrationInput.safeParse(ctx.query ?? {})
          : null;
  if (input && !input.success) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_PASSKEY_NAME",
      message: "Passkey names must contain between 1 and 100 characters",
    });
  }
};

/** Better Auth 1.6.25 otherwise requests UV as merely preferred at sign-in. */
export const passkeyAfter = async (ctx: PasskeyHookContext) => {
  if (ctx.path !== "/passkey/generate-authenticate-options") return;
  const options: unknown = ctx.context.returned;
  if (options && typeof options === "object" && "challenge" in options) {
    return ctx.json({ ...options, userVerification: "required" });
  }
};
