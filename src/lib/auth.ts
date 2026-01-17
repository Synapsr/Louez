import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Nodemailer from 'next-auth/providers/nodemailer'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { render } from '@react-email/render'
import { db } from '@/lib/db'
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from '@/lib/db/schema'
import { sendEmail } from '@/lib/email/client'
import { MagicLinkEmail } from '@/lib/email/templates'
import type { EmailLocale } from '@/lib/email/i18n'

// Get locale from Accept-Language header
function getLocaleFromRequest(request?: Request): EmailLocale {
  if (!request) return 'fr'
  const acceptLanguage = request.headers.get('accept-language') || ''
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

// Translations for email subject
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Allow linking Google account to existing email account
      allowDangerousEmailAccountLinking: true,
    }),
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      from: process.env.SMTP_FROM,
      async sendVerificationRequest({ identifier: email, url, request }) {
        const locale = getLocaleFromRequest(request)
        const subject = subjectTranslations[locale]

        const html = await render(
          MagicLinkEmail({
            url,
            locale,
          })
        )

        await sendEmail({
          to: email,
          subject,
          html,
        })
      },
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/verify-request',
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
})
