import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, Locale } from './config'

function getPreferredLocaleFromHeader(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale

  const languages = acceptLanguage
    .split(',')
    .map((lang) => {
      const [code, quality = 'q=1'] = lang.trim().split(';')
      const q = parseFloat(quality.replace('q=', '')) || 1
      return { code: code.toLowerCase().split('-')[0], q }
    })
    .sort((a, b) => b.q - a.q)

  for (const { code } of languages) {
    if (locales.includes(code as Locale)) {
      return code as Locale
    }
  }

  return defaultLocale
}

export default getRequestConfig(async () => {
  // Try to get locale from cookie first
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined

  // If cookie exists and is valid, use it
  if (cookieLocale && locales.includes(cookieLocale)) {
    return {
      locale: cookieLocale,
      messages: (await import(`@/messages/${cookieLocale}.json`)).default,
    }
  }

  // Otherwise, detect from Accept-Language header
  const headerStore = await headers()
  const acceptLanguage = headerStore.get('Accept-Language')
  const locale = getPreferredLocaleFromHeader(acceptLanguage)

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  }
})
