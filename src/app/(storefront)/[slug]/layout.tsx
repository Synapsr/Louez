import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Toaster } from '@/components/ui/sonner'
import { StoreHeaderWrapper } from '@/components/storefront/store-header-wrapper'
import { StoreFooter } from '@/components/storefront/store-footer'
import { ThemeWrapper } from '@/components/storefront/theme-wrapper'
import { CartProvider } from '@/contexts/cart-context'
import { StoreProvider } from '@/contexts/store-context'
import { AnalyticsProvider } from '@/contexts/analytics-context'
import { PostHogProvider } from '@/components/posthog-provider'
import { generateStoreMetadata, getCanonicalUrl, stripHtml } from '@/lib/seo'
import type { StoreTheme, StoreSettings } from '@/types/store'

interface StorefrontLayoutProps {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store || !store.onboardingCompleted) {
    return {
      title: 'Boutique introuvable',
    }
  }

  const theme = (store.theme as StoreTheme) || {}
  const settings = (store.settings as StoreSettings) || {}

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      email: store.email,
      phone: store.phone,
      address: store.address,
      latitude: store.latitude,
      longitude: store.longitude,
      logoUrl: store.logoUrl,
      settings,
      theme,
    },
    {
      description: store.description
        ? stripHtml(store.description)
        : `Location de matériel chez ${store.name}. Réservez facilement en ligne.`,
    }
  )
}

export function generateViewport({}: {
  params: Promise<{ slug: string }>
}): Viewport {
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: '#ffffff' },
      { media: '(prefers-color-scheme: dark)', color: '#000000' },
    ],
    width: 'device-width',
    initialScale: 1,
  }
}

export default async function StorefrontLayout({
  children,
  params,
}: StorefrontLayoutProps) {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store || !store.onboardingCompleted) {
    notFound()
  }

  const messages = await getMessages()

  const theme = (store.theme as StoreTheme) || { mode: 'light', primaryColor: '#0066FF' }
  const settings = (store.settings as StoreSettings) || {}
  const currency = settings.currency || 'EUR'

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider>
        <StoreProvider currency={currency} storeSlug={store.slug} storeName={store.name}>
          <CartProvider>
            <AnalyticsProvider storeSlug={store.slug}>
              <ThemeWrapper mode={theme.mode} primaryColor={theme.primaryColor}>
                <div className="flex min-h-screen flex-col bg-background">
                  <StoreHeaderWrapper
                    storeName={store.name}
                    storeSlug={store.slug}
                    logoUrl={store.logoUrl}
                  />
                  <main className="flex-1 pt-20 md:pt-24">{children}</main>
                  <StoreFooter
                    storeName={store.name}
                    storeSlug={store.slug}
                    email={store.email}
                    phone={store.phone}
                    address={store.address}
                  />
                </div>
                <Toaster />
              </ThemeWrapper>
            </AnalyticsProvider>
          </CartProvider>
        </StoreProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  )
}
