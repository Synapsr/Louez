import { headers } from 'next/headers'

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { toNextJsHandler } from 'better-auth/next-js'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { nanoid } from 'nanoid'
import { render } from '@react-email/render'

import { db } from '@louez/db'
import * as schema from '@louez/db'
import { sendEmail, MagicLinkEmail, OTPEmail } from '@louez/email'
import type { EmailLocale } from '@louez/email'

import { env } from './env'

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
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  account: {
    accountLinking: {
      enabled: true,
    },
  },

  socialProviders: {
    google: {
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    },
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
  const session = await authInstance.api.getSession({
    headers: await headers(),
  })
  if (!session) return null
  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    expires: session.session.expiresAt.toISOString(),
  }
}

// Re-export for route handler convenience
export { toNextJsHandler }
