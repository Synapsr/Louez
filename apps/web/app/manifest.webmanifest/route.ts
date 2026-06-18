import { NextResponse } from 'next/server';

import { getLocale, getTranslations } from 'next-intl/server';

// Localized per request so the installed app's metadata (description, lang)
// matches each visitor's language rather than a single fixed locale. The locale
// is resolved by the shared next-intl config (NEXT_LOCALE cookie, then
// Accept-Language) — see apps/web/i18n/request.ts.
export const dynamic = 'force-dynamic';

// Fixed brand blue for the install splash / standalone chrome (the live in-app
// theme-color is handled responsively by the dashboard layout's viewport).
const BRAND_COLOR = '#1f54dd';

export async function GET() {
  const locale = await getLocale();
  const t = await getTranslations({
    locale,
    namespace: 'dashboard.installPrompt',
  });

  const manifest = {
    name: 'Louez',
    short_name: 'Louez',
    description: t('subtitle'),
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_COLOR,
    theme_color: BRAND_COLOR,
    lang: locale,
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
