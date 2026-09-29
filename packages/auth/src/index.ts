import { supplementalMessages } from "@louez/email/messages";
import { headers } from "next/headers";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { toNextJsHandler } from "better-auth/next-js";
import { emailOTP, magicLink } from "better-auth/plugins";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { render } from "@react-email/render";

import { db } from "@louez/db";
import * as schema from "@louez/db";
import { env as dbEnv } from "@louez/db/env";
import {
  DeleteAccountEmail,
  getDeleteAccountEmailSubject,
  getOtpEmailSubject,
  isEmailConfigured,
  MagicLinkEmail,
  OTPEmail,
  sendEmail,
} from "@louez/email";

import {
  buildAccountDeletionConfirmationFragment,
  getAccountDeletionReasonFromRequest,
  type AccountDeletionReason,
} from "./account-deletion";
import { env } from "./env";
import { sendPasswordChangedNotice } from "./password-notice";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";
import { authIpAddressOptions, authRateLimitOptions } from "./rate-limit";
import { getLocaleFromHeaders } from "./request-locale";

// Standalone (self-host) deployments make email + password the primary
// sign-in so the first owner can create an account with zero external
// services. The cloud sets LOUEZ_MODE=platform: accounts are created by e-mail
// code or Google, and a password is an optional extra added afterwards.
// Read from process.env directly — this package has no dependency on the
// app's env schema, and the value must be a pure runtime concern.
const isStandaloneMode = process.env.LOUEZ_MODE !== "platform";

const hasGoogleAuth = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

// ============================================================================
// Types
// ============================================================================

export interface AuthSession {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  expires: string;
}

const subjectTranslations: Record<string, string> = {
  fr: "Connexion à votre compte Louez",
  en: "Sign in to your Louez account",
  de: "Anmeldung bei Ihrem Louez-Konto",
  es: "Iniciar sesion en su cuenta Louez",
  it: "Accedi al tuo account Louez",
  nl: "Inloggen op uw Louez-account",
  pl: "Zaloguj sie do konta Louez",
  pt: "Entrar na sua conta Louez",
  zh: supplementalMessages.zh.index_subjectTranslations,
  ja: supplementalMessages.ja.index_subjectTranslations,
  ru: supplementalMessages.ru.index_subjectTranslations,
  id: supplementalMessages.id.index_subjectTranslations,
  ko: supplementalMessages.ko.index_subjectTranslations,
};

// ============================================================================
// Session hook (optional, set by app for notifications etc.)
// ============================================================================

export interface SessionCreatedEvent {
  userId: string;
  /**
   * better-auth endpoint that created the session (`/sign-in/email`,
   * `/callback/:id`, …) — how the app tells a password sign-in from an e-mail
   * code. Null when the session was created outside a request.
   */
  path: string | null;
}

let _sessionHook: ((session: SessionCreatedEvent) => Promise<void>) | null = null;
let _userCreatedHook: ((user: { userId: string }) => Promise<void>) | null = null;
let _userDeleteRequestHook: ((user: { userId: string }) => Promise<void>) | null = null;
let _userDeleteHook:
  | ((user: {
      userId: string;
      reason: AccountDeletionReason | null;
    }) => Promise<{ status: "deleted" } | { status: "blocked"; reason: "shared-store" }>)
  | null = null;

export function setSessionHook(hook: (session: SessionCreatedEvent) => Promise<void>) {
  _sessionHook = hook;
}

export function setUserCreatedHook(hook: (user: { userId: string }) => Promise<void>) {
  _userCreatedHook = hook;
}

export function setUserDeleteHook(
  hook: (user: {
    userId: string;
    reason: AccountDeletionReason | null;
  }) => Promise<{ status: "deleted" } | { status: "blocked"; reason: "shared-store" }>,
) {
  _userDeleteHook = hook;
}

export function setUserDeleteRequestHook(hook: (user: { userId: string }) => Promise<void>) {
  _userDeleteRequestHook = hook;
}

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 90;
const SESSION_REFRESH_INTERVAL_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const PROD_DATABASE_SUFFIX = "ep5.lumy.cloud:6053/louez";
const DEV_DATABASE_SUFFIX = "ep5.lumy.cloud:6984/louez";
const AUTH_COOKIE_PREFIX = dbEnv.DATABASE_URL.endsWith(PROD_DATABASE_SUFFIX)
  ? "louez-prod"
  : dbEnv.DATABASE_URL.endsWith(DEV_DATABASE_SUFFIX)
    ? "louez-dev"
    : "better-auth";

// ============================================================================
// Auth instance (direct — no factory/singleton)
// ============================================================================

export const authInstance = betterAuth({
  basePath: "/api/auth",
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_URL,
  trustedOrigins: [env.AUTH_URL],

  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: {
      user: schema.users,
      account: schema.accounts,
      session: schema.sessions,
      verification: schema.verification,
      rateLimit: schema.authRateLimits,
    },
  }),

  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
    database: {
      generateId: () => nanoid(),
    },
    ipAddress: authIpAddressOptions,
  },

  rateLimit: authRateLimitOptions,

  session: {
    expiresIn: SESSION_DURATION_SECONDS,
    updateAge: SESSION_REFRESH_INTERVAL_SECONDS,
    cookieCache: {
      enabled: true,
      maxAge: SESSION_COOKIE_CACHE_SECONDS,
    },
  },

  account: {
    accountLinking: {
      enabled: true,
    },
  },

  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user, request) => {
        if (!_userDeleteHook) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Account deletion service is unavailable",
            code: "ACCOUNT_DELETION_UNAVAILABLE",
          });
        }

        const result = await _userDeleteHook({
          userId: user.id,
          reason: getAccountDeletionReasonFromRequest(request),
        });
        if (result.status === "blocked") {
          throw new APIError("CONFLICT", {
            message: "A shared store blocks account deletion",
            code: "ACCOUNT_DELETION_BLOCKED",
          });
        }
      },
      ...(isStandaloneMode
        ? {}
        : {
            sendDeleteAccountVerification: async (
              { user, token }: { user: { id: string; email: string }; token: string },
              request?: Request,
            ) => {
              if (!_userDeleteRequestHook) {
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: "Account deletion is temporarily unavailable",
                  code: "ACCOUNT_DELETION_UNAVAILABLE",
                });
              }
              try {
                await _userDeleteRequestHook({ userId: user.id });
              } catch {
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: "Account deletion is temporarily unavailable",
                  code: "ACCOUNT_DELETION_UNAVAILABLE",
                });
              }
              if (!isEmailConfigured()) {
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: "Account deletion email is unavailable",
                  code: "ACCOUNT_DELETION_EMAIL_UNAVAILABLE",
                });
              }
              const locale = getLocaleFromHeaders(
                request ? new Headers(request.headers) : new Headers(),
              );
              const reason = getAccountDeletionReasonFromRequest(request);
              const fragment = buildAccountDeletionConfirmationFragment(token, reason);
              const confirmationUrl = `${env.AUTH_URL}/account/delete/confirm#${fragment}`;
              const html = await render(DeleteAccountEmail({ url: confirmationUrl, locale }));
              await sendEmail({
                to: user.email,
                subject: getDeleteAccountEmailSubject(locale),
                html,
                devPreviewUrl: confirmationUrl,
              });
            },
          }),
    },
  },

  // Only register Google when credentials exist — better-auth would otherwise
  // expose a sign-in path that errors at the provider handshake.
  socialProviders: hasGoogleAuth
    ? {
        google: {
          clientId: env.AUTH_GOOGLE_ID as string,
          clientSecret: env.AUTH_GOOGLE_SECRET as string,
        },
      }
    : {},

  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    // Forgot password runs on an e-mail code (emailOTP plugin below), never on
    // a link. A reset signs every device out, the requester's included.
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }, request) => {
      await sendPasswordChangedNotice({
        email: user.email,
        event: "reset",
        locale: getLocaleFromHeaders(request ? new Headers(request.headers) : new Headers()),
      });
    },
    // On the cloud a password is only ever added to an account that already
    // proved its e-mail (code or Google). Leaving /sign-up/email open there
    // would be a public registration that verifies nothing.
    ...(isStandaloneMode ? {} : { disableSignUp: true }),
  },

  hooks: {
    // Changing a password always signs the other devices out, whatever the
    // caller sent: the flag is not left to the client's good will.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      return {
        context: {
          ...ctx,
          body: { ...ctx.body, revokeOtherSessions: true },
        },
      };
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      if (ctx.context.returned instanceof APIError) return;

      const user = ctx.context.session?.user ?? ctx.context.newSession?.user;
      if (!user) return;
      await sendPasswordChangedNotice({
        email: user.email,
        event: "changed",
        locale: getLocaleFromHeaders(ctx.headers ?? new Headers()),
      });
    }),
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }, ctx) => {
        const reqHeaders = ctx?.request ? new Headers(ctx.request.headers) : new Headers();
        const locale = getLocaleFromHeaders(reqHeaders);
        const subject = subjectTranslations[locale] || subjectTranslations.fr;
        const html = await render(MagicLinkEmail({ url, locale }));
        await sendEmail({ to: email, subject, html });
      },
    }),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }, ctx) {
        // E-mail verification and e-mail change by code are not offered.
        if (type !== "sign-in" && type !== "forget-password") return;
        // Without a transport the code would silently go nowhere; surface it
        // in the server logs so a misconfigured instance is still usable — on
        // a self-host without SMTP this is how the owner resets a password.
        if (!isEmailConfigured()) {
          console.log(`[auth] Email not configured — ${type} code for ${email}: ${otp}`);
          return;
        }
        const locale = getLocaleFromHeaders(ctx?.headers ?? new Headers());
        const html = await render(OTPEmail({ otp, locale, purpose: type }));
        await sendEmail({
          to: email,
          subject: `${getOtpEmailSubject(locale, type)}: ${otp}`,
          html,
        });
      },
    }),
  ],

  databaseHooks: {
    user: {
      create: {
        // Standalone instances are single-team: once the first account
        // exists (the operator, created right after boot), open registration
        // closes — a stranger reaching a deployed instance must not be able
        // to register and claim the store slot. Invited teammates keep
        // working: a pending, unexpired store invitation for the email
        // reopens the door. Applies to every provider, Google included.
        before: async (user) => {
          if (!isStandaloneMode) return;

          const existingUser = await db.query.users.findFirst({
            columns: { id: true },
          });
          if (!existingUser) return;

          const invitation = await db.query.storeInvitations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.storeInvitations.email, user.email.toLowerCase()),
              eq(schema.storeInvitations.status, "pending"),
              gt(schema.storeInvitations.expiresAt, new Date()),
            ),
          });
          if (!invitation) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed on this instance",
              code: "REGISTRATION_CLOSED",
            });
          }
        },
        after: async (user) => {
          if (_userCreatedHook) {
            await _userCreatedHook({ userId: user.id });
          }
        },
      },
    },
    session: {
      create: {
        after: async (session, context) => {
          if (_sessionHook) {
            await _sessionHook({
              userId: session.userId,
              path: context?.path ?? null,
            });
          }
        },
      },
    },
  },
});

// ============================================================================
// Session accessor
// ============================================================================

/**
 * Backward-compatible session accessor.
 * Returns the same shape as NextAuth's auth() so all consumer files
 * need zero changes: `const session = await auth()`
 */
export async function auth(): Promise<AuthSession | null> {
  const requestHeaders = await headers();

  const mapSession = (
    session: NonNullable<Awaited<ReturnType<typeof authInstance.api.getSession>>>,
  ) => ({
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    expires: session.session.expiresAt.toISOString(),
  });

  try {
    const session = await authInstance.api.getSession({
      headers: requestHeaders,
    });
    if (!session) return null;
    return mapSession(session);
  } catch (error) {
    console.error("[auth] getSession failed, retrying once", error);
  }

  try {
    const retrySession = await authInstance.api.getSession({
      headers: requestHeaders,
    });
    if (!retrySession) return null;
    return mapSession(retrySession);
  } catch (error) {
    console.error("[auth] getSession retry failed", error);
    return null;
  }
}

// Re-export for route handler convenience
export { toNextJsHandler };
