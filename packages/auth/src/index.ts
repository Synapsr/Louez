import { headers } from 'next/headers'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { toNextJsHandler } from 'better-auth/next-js'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { nanoid } from 'nanoid'
import { render } from '@react-email/render'

import { db } from '@louez/db'
import * as schema from '@louez/db'
import { sendEmail, isEmailConfigured, MagicLinkEmail, OTPEmail } from '@louez/email'
import type { EmailLocale } from '@louez/email'

import { env } from './env'

// Standalone (self-host) deployments enable email + password sign-in so the
// first owner can create an account with zero external services. The cloud
// sets LOUEZ_MODE=platform and keeps its passwordless model unchanged.
// Read from process.env directly — this package has no dependency on the
// app's env schema, and the value must be a pure runtime concern.
const isStandaloneMode = process.env.LOUEZ_MODE !== 'platform'

const hasGoogleAuth = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET)

// ============================================================================
// Types
// ============================================================================

export interface AuthSession {
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
  }
  expires: string
}

// ============================================================================
// Locale detection
// ============================================================================

function getLocaleFromHeaders(hdrs: Headers): EmailLocale {
  const acceptLanguage = hdrs.get('accept-language') || ''
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

const subjectTranslations: Record<string, string> = {
  fr: 'Connexion à votre compte Louez',
  en: 'Sign in to your Louez account',
  de: 'Anmeldung bei Ihrem Louez-Konto',
  es: 'Iniciar sesion en su cuenta Louez',
  it: 'Accedi al tuo account Louez',
  nl: 'Inloggen op uw Louez-account',
  pl: 'Zaloguj sie do konta Louez',
  pt: 'Entrar na sua conta Louez',
}

const otpSubjectTranslations: Record<string, string> = {
  fr: 'Votre code de connexion Louez',
  en: 'Your Louez sign-in code',
}

// ============================================================================
// Session hook (optional, set by app for notifications etc.)
// ============================================================================

let _sessionHook: ((session: { userId: string }) => Promise<void>) | null = null

export function setSessionHook(
  hook: (session: { userId: string }) => Promise<void>,
) {
  _sessionHook = hook
}

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 90
const SESSION_REFRESH_INTERVAL_SECONDS = 60 * 60 * 24
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60

// ============================================================================
// Auth instance (direct — no factory/singleton)
// ============================================================================

export const authInstance = betterAuth({
  basePath: '/api/auth',
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_URL,
  trustedOrigins: [env.AUTH_URL],

  database: drizzleAdapter(db, {
    provider: 'mysql',
    schema: {
      user: schema.users,
      account: schema.accounts,
      session: schema.sessions,
      verification: schema.verification,
    },
  }),

  advanced: {
    database: {
      generateId: () => nanoid(),
    },
  },

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
    enabled: isStandaloneMode,
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }, ctx) => {
        const reqHeaders = ctx?.request
          ? new Headers(ctx.request.headers)
          : new Headers()
        const locale = getLocaleFromHeaders(reqHeaders)
        const subject = subjectTranslations[locale] || subjectTranslations.fr
        const html = await render(MagicLinkEmail({ url, locale }))
        await sendEmail({ to: email, subject, html })
      },
    }),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') return
        // Without a transport the code would silently go nowhere; surface it
        // in the server logs so a misconfigured instance is still usable.
        if (!isEmailConfigured()) {
          console.log(`[auth] Email not configured — sign-in code for ${email}: ${otp}`)
          return
        }
        const html = await render(OTPEmail({ otp, locale: 'fr' }))
        await sendEmail({
          to: email,
          subject: `${otpSubjectTranslations.fr}: ${otp}`,
          html,
        })
      },
    }),
  ],

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          if (_sessionHook) {
            await _sessionHook(session)
          }
        },
      },
    },
  },
})

// ============================================================================
// Session accessor
// ============================================================================

/**
 * Backward-compatible session accessor.
 * Returns the same shape as NextAuth's auth() so all consumer files
 * need zero changes: `const session = await auth()`
 */
export async function auth(): Promise<AuthSession | null> {
  const requestHeaders = await headers()

  const mapSession = (session: NonNullable<Awaited<ReturnType<typeof authInstance.api.getSession>>>) => ({
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    expires: session.session.expiresAt.toISOString(),
  })

  try {
    const session = await authInstance.api.getSession({
      headers: requestHeaders,
    })
    if (!session) return null
    return mapSession(session)
  } catch (error) {
    console.error('[auth] getSession failed, retrying once', error)
  }

  try {
    const retrySession = await authInstance.api.getSession({
      headers: requestHeaders,
    })
    if (!retrySession) return null
    return mapSession(retrySession)
  } catch (error) {
    console.error('[auth] getSession retry failed', error)
    return null
  }
}

// Re-export for route handler convenience
export { toNextJsHandler }
