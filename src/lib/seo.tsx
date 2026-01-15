import type { Metadata } from 'next'
import type { StoreSettings, StoreTheme } from '@/types/store'
import type { ReactElement } from 'react'

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Get the base URL for a store (subdomain-based routing)
 */
export function getStoreBaseUrl(slug: string): string {
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'

  // Handle localhost development
  if (APP_DOMAIN.includes('localhost')) {
    return `${protocol}://localhost:3000/${slug}`
  }

  // Production: subdomain-based routing
  return `${protocol}://${slug}.${APP_DOMAIN}`
}

/**
 * Get canonical URL for a store page
 */
export function getCanonicalUrl(slug: string, path: string = ''): string {
  const baseUrl = getStoreBaseUrl(slug)
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return path ? `${baseUrl}${cleanPath}` : baseUrl
}

// ============================================================================
// Store Types for SEO
// ============================================================================

export interface StoreSeoData {
  id: string
  name: string
  slug: string
  description?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  latitude?: string | null
  longitude?: string | null
  logoUrl?: string | null
  settings?: StoreSettings | null
  theme?: StoreTheme | null
}

export interface ProductSeoData {
  id: string
  name: string
  description?: string | null
  price: string
  deposit?: string | null
  images?: string[] | null
  quantity: number
  category?: {
    id: string
    name: string
  } | null
}

// ============================================================================
// Metadata Generators
// ============================================================================

/**
 * Generate base metadata for store pages
 */
export function generateStoreMetadata(
  store: StoreSeoData,
  options: {
    title?: string
    description?: string
    path?: string
    noIndex?: boolean
    images?: string[]
  } = {}
): Metadata {
  const { title, description, path = '', noIndex = false, images = [] } = options

  const pageTitle = title || store.name
  const pageDescription = description || stripHtml(store.description || '') || `Location de matériel chez ${store.name}`
  const canonicalUrl = getCanonicalUrl(store.slug, path)

  // Determine OG image
  const ogImages = images.length > 0
    ? images
    : store.theme?.heroImages?.length
      ? [store.theme.heroImages[0]]
      : store.logoUrl
        ? [store.logoUrl]
        : []

  const metadata: Metadata = {
    title: pageTitle,
    description: truncateText(pageDescription, 160),
    alternates: {
      canonical: canonicalUrl,
    },
    // Use store logo as favicon if available
    ...(store.logoUrl && {
      icons: {
        icon: store.logoUrl,
        shortcut: store.logoUrl,
        apple: store.logoUrl,
      },
    }),
    openGraph: {
      type: 'website',
      locale: 'fr_FR',
      url: canonicalUrl,
      siteName: store.name,
      title: pageTitle,
      description: truncateText(pageDescription, 160),
      ...(ogImages.length > 0 && {
        images: ogImages.map((url) => ({
          url,
          width: 1200,
          height: 630,
          alt: pageTitle,
        })),
      }),
    },
    twitter: {
      card: ogImages.length > 0 ? 'summary_large_image' : 'summary',
      title: pageTitle,
      description: truncateText(pageDescription, 160),
      ...(ogImages.length > 0 && { images: ogImages }),
    },
  }

  if (noIndex) {
    metadata.robots = {
      index: false,
      follow: false,
    }
  }

  return metadata
}

/**
 * Generate metadata for product pages
 */
export function generateProductMetadata(
  store: StoreSeoData,
  product: ProductSeoData,
  options: {
    path?: string
  } = {}
): Metadata {
  const { path = '' } = options

  const currency = store.settings?.currency || 'EUR'
  const priceFormatted = formatPrice(parseFloat(product.price), currency)

  const title = `${product.name} - Location ${priceFormatted}`
  const description = product.description
    ? truncateText(stripHtml(product.description), 160)
    : `Louez ${product.name} chez ${store.name} à partir de ${priceFormatted}`

  const images = product.images?.length ? product.images : []
  const canonicalUrl = getCanonicalUrl(store.slug, path || `/product/${product.id}`)

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      locale: 'fr_FR',
      url: canonicalUrl,
      siteName: store.name,
      title,
      description,
      ...(images.length > 0 && {
        images: images.map((url) => ({
          url,
          width: 1200,
          height: 630,
          alt: product.name,
        })),
      }),
    },
    twitter: {
      card: images.length > 0 ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(images.length > 0 && { images }),
    },
  }
}

// ============================================================================
// JSON-LD Schema.org Generators
// ============================================================================

/**
 * Generate LocalBusiness schema for store homepage
 */
export function generateLocalBusinessSchema(store: StoreSeoData): object {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': getCanonicalUrl(store.slug),
    name: store.name,
    url: getCanonicalUrl(store.slug),
  }

  if (store.description) {
    schema.description = stripHtml(store.description)
  }

  if (store.logoUrl) {
    schema.logo = store.logoUrl
    schema.image = store.logoUrl
  } else if (store.theme?.heroImages?.length) {
    schema.image = store.theme.heroImages[0]
  }

  if (store.email) {
    schema.email = store.email
  }

  if (store.phone) {
    schema.telephone = store.phone
  }

  if (store.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: store.address,
      addressCountry: store.settings?.country || 'FR',
    }
  }

  if (store.latitude && store.longitude) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: parseFloat(store.latitude),
      longitude: parseFloat(store.longitude),
    }
  }

  // Add price range indicator
  schema.priceRange = '$$'

  return schema
}

/**
 * Generate Product schema for product pages
 */
export function generateProductSchema(
  store: StoreSeoData,
  product: ProductSeoData
): object {
  const currency = store.settings?.currency || 'EUR'
  const canonicalUrl = getCanonicalUrl(store.slug, `/product/${product.id}`)

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': canonicalUrl,
    name: product.name,
    url: canonicalUrl,
    offers: {
      '@type': 'Offer',
      price: parseFloat(product.price),
      priceCurrency: currency,
      availability: product.quantity > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'LocalBusiness',
        name: store.name,
        url: getCanonicalUrl(store.slug),
      },
    },
  }

  if (product.description) {
    schema.description = stripHtml(product.description)
  }

  if (product.images?.length) {
    schema.image = product.images
  }

  if (product.category) {
    schema.category = product.category.name
  }

  return schema
}

/**
 * Generate BreadcrumbList schema
 */
export function generateBreadcrumbSchema(
  store: StoreSeoData,
  items: { name: string; url?: string }[]
): object {
  const breadcrumbItems = items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    ...(item.url && { item: item.url }),
  }))

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  }
}

/**
 * Generate WebSite schema for homepage
 */
export function generateWebSiteSchema(store: StoreSeoData): object {
  const baseUrl = getCanonicalUrl(store.slug)

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${baseUrl}#website`,
    name: store.name,
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/catalog?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

/**
 * Generate ItemList schema for catalog pages
 */
export function generateItemListSchema(
  store: StoreSeoData,
  products: ProductSeoData[],
  listName: string
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name: product.name,
        url: getCanonicalUrl(store.slug, `/product/${product.id}`),
        ...(product.images?.length && { image: product.images[0] }),
        offers: {
          '@type': 'Offer',
          price: parseFloat(product.price),
          priceCurrency: store.settings?.currency || 'EUR',
          availability: product.quantity > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      },
    })),
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strip HTML tags from text
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3).trim() + '...'
}

/**
 * Format price with currency
 */
function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price)
}

/**
 * Component to render JSON-LD script tag
 */
export function JsonLd({ data }: { data: object | object[] }): ReactElement {
  const schemas = Array.isArray(data) ? data : [data]

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  )
}
