import type { Metadata } from "next";
import type { PricingKind, StoreSettings, StoreTheme } from "@louez/types";
import type { ReactElement } from "react";
import { isFixedPriceProduct, pricingModeToMinutes, stripHtml, toAbsoluteUrl } from "@louez/utils";
import { type Locale, defaultLocale, locales } from "@/i18n/config";
import { isStandaloneMode } from "@/lib/deployment";
import { env } from "@/env";
import { getStorePageRobots } from "@/lib/seo.robots";
import { buildRentalOffers, type RentalRate } from "@/lib/util.rental-offer-schema";
import { truncateText } from "@/lib/util.seo-text";
import { buildStorefrontUrl } from "@/lib/util.storefront-url";
import { resolveStoreSocialLinks } from "@/lib/utils/util.store-social-links";

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN;

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Canonical base URL of a store: the store subdomain on a platform, the app
 * URL of a standalone instance. Same rule as `getStorefrontUrl`, with the
 * protocol taken from NODE_ENV as crawlers only ever see production.
 */
export function getStoreBaseUrl(slug: string): string {
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const standalone = isStandaloneMode();

  return buildStorefrontUrl({
    slug,
    standalone,
    appDomain: APP_DOMAIN,
    origin: standalone
      ? (env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
      : `${protocol}://${APP_DOMAIN}`,
    protocol,
  });
}

// OG scrapers and crawlers need absolute image URLs; standalone deployments
// store site-relative asset paths ("/files/…"). No-op for absolute URLs.
function absoluteAssetUrl(url: string): string {
  return toAbsoluteUrl(url, env.NEXT_PUBLIC_APP_URL);
}

/** Store-relative path of a product page: its slug, or its id for rows predating slugs. */
export function getProductPath(product: { id: string; slug?: string | null }): string {
  return `/product/${product.slug ?? product.id}`;
}

/**
 * Get canonical URL for a store page
 */
export function getCanonicalUrl(slug: string, path: string = ""): string {
  const baseUrl = getStoreBaseUrl(slug);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return path ? `${baseUrl}${cleanPath}` : baseUrl;
}

// ============================================================================
// Store Types for SEO
// ============================================================================

export interface StoreSeoData {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  logoUrl?: string | null;
  /** One-line pitch; the default meta description before the store description. */
  tagline?: string | null;
  /** Dedicated favicon; the logo stands in when null. */
  faviconUrl?: string | null;
  settings?: StoreSettings | null;
  theme?: StoreTheme | null;
}

export interface ProductSeoData {
  id: string;
  name: string;
  /** URL segment of the product page; the id stands in when a product has none. */
  slug?: string | null;
  description?: string | null;
  /**
   * The rate the page prints for the base period — after an active
   * promotion, so the structured data never claims a price the visitor
   * does not see. See `getStorefrontPricingSummary`.
   */
  price: string;
  deposit?: string | null;
  images?: string[] | null;
  quantity: number;
  /** A `fixed` product is priced per booking, so its Offer carries no period. */
  pricingKind?: PricingKind | null;
  /** Rental period the price applies to — surfaced in the Offer schema. */
  pricingMode?: "hour" | "day" | "week" | null;
  /**
   * Rate-based products price a custom period (e.g. 120 = per 2 hours);
   * takes precedence over pricingMode in the Offer schema.
   */
  basePeriodMinutes?: number | null;
  /**
   * The whole rate grid as the page prints it, shortest period first (see
   * `getStorefrontRateRows`): one Offer each. Absent: the base rate alone.
   */
  rates?: readonly RentalRate[];
  category?: {
    id: string;
    name: string;
  } | null;
}

// Google reads og:locale as a full language_TERRITORY tag; next-intl only
// carries the language. Map the storefront locales to their primary market —
// typed against i18n/config so adding a locale without a mapping fails to
// compile.
const OPEN_GRAPH_LOCALES: Record<Locale, string> = {
  de: "de_DE",
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  it: "it_IT",
  nl: "nl_NL",
  pl: "pl_PL",
  pt: "pt_PT",
  zh: "zh_CN",
  ja: "ja_JP",
  ru: "ru_RU",
  id: "id_ID",
  ko: "ko_KR",
};

const isLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value);

function toOpenGraphLocale(locale?: string): string {
  return locale && isLocale(locale)
    ? OPEN_GRAPH_LOCALES[locale]
    : OPEN_GRAPH_LOCALES[defaultLocale];
}

/**
 * The period the base price covers, in minutes: a rate-based product's own
 * period, else one pricingMode unit; null for a forfait, billed per booking.
 */
function getBasePeriodMinutes(product: ProductSeoData): number | null {
  if (isFixedPriceProduct(product)) return null;
  if (product.basePeriodMinutes && product.basePeriodMinutes > 0) return product.basePeriodMinutes;
  return product.pricingMode ? pricingModeToMinutes(product.pricingMode) : null;
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
    title?: string;
    description?: string;
    path?: string;
    noIndex?: boolean;
    images?: string[];
    /** Request locale for og:locale — falls back to the default locale. */
    locale?: string;
  } = {},
): Metadata {
  const { title, description, path = "", noIndex = false, images = [], locale } = options;

  const pageTitle = title || store.name;
  // None at all: the key is left out, so the layout's localized default stands.
  const pageDescription =
    description || stripHtml(store.tagline || "") || stripHtml(store.description || "");
  const metaDescription = pageDescription ? truncateText(pageDescription, 160) : undefined;
  const canonicalUrl = getCanonicalUrl(store.slug, path);
  const iconUrl = store.faviconUrl || store.logoUrl;

  // OG image: the page's own, else the share image, the first hero photo, the logo.
  const ogImages = (
    images.length > 0
      ? images
      : store.theme?.shareImageUrl
        ? [store.theme.shareImageUrl]
        : store.theme?.heroImages?.length
          ? [store.theme.heroImages[0]]
          : store.logoUrl
            ? [store.logoUrl]
            : []
  ).map(absoluteAssetUrl);

  const metadata: Metadata = {
    // The root layout suffixes every title with the platform name; a store
    // page carries the store's own name, never the platform's.
    title: { absolute: pageTitle },
    ...(metaDescription && { description: metaDescription }),
    alternates: {
      canonical: canonicalUrl,
    },
    robots: getStorePageRobots(noIndex),
    // The store's favicon, or its logo when it has none
    ...(iconUrl && {
      icons: {
        icon: iconUrl,
        shortcut: iconUrl,
        apple: iconUrl,
      },
    }),
    openGraph: {
      type: "website",
      locale: toOpenGraphLocale(locale),
      url: canonicalUrl,
      siteName: store.name,
      title: pageTitle,
      ...(metaDescription && { description: metaDescription }),
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
      card: ogImages.length > 0 ? "summary_large_image" : "summary",
      title: pageTitle,
      ...(metaDescription && { description: metaDescription }),
      ...(ogImages.length > 0 && { images: ogImages }),
    },
  };

  return metadata;
}

/**
 * Generate metadata for product pages
 */
export function generateProductMetadata(
  store: StoreSeoData,
  product: ProductSeoData,
  options: {
    path?: string;
    /** Localized title. */
    title: string;
    /** Localized description; the product's own description wins over it. */
    description: string;
    locale?: string;
  },
): Metadata {
  const { path = "", locale } = options;

  const title = options.title;
  const description = product.description
    ? truncateText(stripHtml(product.description), 160)
    : options.description;

  const images = (product.images?.length ? product.images : []).map(absoluteAssetUrl);
  const canonicalUrl = getCanonicalUrl(store.slug, path || getProductPath(product));

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: getStorePageRobots(false),
    openGraph: {
      type: "website",
      locale: toOpenGraphLocale(locale),
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
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      ...(images.length > 0 && { images }),
    },
  };
}

// ============================================================================
// JSON-LD Schema.org Generators
// ============================================================================

export interface LocalBusinessSchemaOptions {
  /** schema.org `openingHoursSpecification` entries, see `buildOpeningHoursSpecification`. */
  openingHoursSpecification?: readonly object[];
  /** Google Maps URL of the place, surfaced as `hasMap`. */
  mapUrl?: string | null;
}

/**
 * Generate LocalBusiness schema for store homepage
 */
export function generateLocalBusinessSchema(
  store: StoreSeoData,
  options: LocalBusinessSchemaOptions = {},
): object {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": getCanonicalUrl(store.slug),
    name: store.name,
    url: getCanonicalUrl(store.slug),
  };

  if (store.description) {
    schema.description = stripHtml(store.description);
  }

  if (store.logoUrl) {
    schema.logo = absoluteAssetUrl(store.logoUrl);
    schema.image = absoluteAssetUrl(store.logoUrl);
  } else if (store.theme?.heroImages?.length) {
    schema.image = absoluteAssetUrl(store.theme.heroImages[0]);
  }

  if (store.email) {
    schema.email = store.email;
  }

  if (store.phone) {
    schema.telephone = store.phone;
  }

  if (store.address) {
    schema.address = {
      "@type": "PostalAddress",
      streetAddress: store.address,
      addressCountry: store.settings?.country || "FR",
    };
  }

  if (store.latitude && store.longitude) {
    schema.geo = {
      "@type": "GeoCoordinates",
      latitude: parseFloat(store.latitude),
      longitude: parseFloat(store.longitude),
    };
  }

  if (options.openingHoursSpecification?.length) {
    schema.openingHoursSpecification = options.openingHoursSpecification;
  }

  if (options.mapUrl) {
    schema.hasMap = options.mapUrl;
  }

  const sameAs = resolveStoreSocialLinks(store.settings?.social).map((link) => link.url);

  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  return schema;
}

/**
 * Generate Product schema for product pages
 */
export function generateProductSchema(store: StoreSeoData, product: ProductSeoData): object {
  const currency = store.settings?.currency || "EUR";
  const canonicalUrl = getCanonicalUrl(store.slug, getProductPath(product));
  const baseRate: RentalRate = {
    price: parseFloat(product.price),
    periodMinutes: getBasePeriodMinutes(product),
  };
  const rates = !isFixedPriceProduct(product) && product.rates?.length ? product.rates : [baseRate];

  // Google drops offers whose price has silently expired. A rental rate is a
  // standing price, so keep the window rolling a year ahead of each render.
  const priceValidUntil = new Date();
  priceValidUntil.setFullYear(priceValidUntil.getFullYear() + 1);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": canonicalUrl,
    name: product.name,
    url: canonicalUrl,
    sku: product.id,
    brand: {
      "@type": "Brand",
      name: store.name,
    },
    offers: buildRentalOffers({
      url: canonicalUrl,
      currency,
      rates,
      inStock: product.quantity > 0,
      seller: { name: store.name, url: getCanonicalUrl(store.slug) },
      priceValidUntil: priceValidUntil.toISOString().split("T")[0],
    }),
  };

  if (product.description) {
    schema.description = stripHtml(product.description);
  }

  // Crawlers resolve schema image URLs on their own — relative paths from a
  // standalone deployment would never be fetched.
  if (product.images?.length) {
    schema.image = product.images.map(absoluteAssetUrl);
  }

  if (product.category) {
    schema.category = product.category.name;
  }

  // schema.org has no deposit on an Offer; a named property is what an
  // assistant reads to answer "is there a deposit?".
  const deposit = product.deposit ? parseFloat(product.deposit) : 0;
  if (deposit > 0) {
    schema.additionalProperty = {
      "@type": "PropertyValue",
      propertyID: "securityDeposit",
      name: "Security deposit",
      value: deposit,
      unitText: currency,
    };
  }

  return schema;
}

/**
 * Generate BreadcrumbList schema
 */
export function generateBreadcrumbSchema(
  store: StoreSeoData,
  items: { name: string; url?: string }[],
): object {
  const breadcrumbItems = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    ...(item.url && { item: item.url }),
  }));

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };
}

/**
 * Generate WebSite schema for homepage
 */
export function generateWebSiteSchema(store: StoreSeoData): object {
  const baseUrl = getCanonicalUrl(store.slug);

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}#website`,
    name: store.name,
    url: baseUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${baseUrl}/catalog?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Generate ItemList schema for catalog pages
 */
export function generateItemListSchema(
  store: StoreSeoData,
  products: ProductSeoData[],
  listName: string,
): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: product.name,
        url: getCanonicalUrl(store.slug, getProductPath(product)),
        ...(product.images?.length && {
          image: absoluteAssetUrl(product.images[0]),
        }),
        offers: {
          "@type": "Offer",
          price: parseFloat(product.price),
          priceCurrency: store.settings?.currency || "EUR",
          availability:
            product.quantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        },
      },
    })),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export { stripHtml, truncateText };

/**
 * Component to render JSON-LD script tag
 */
export function JsonLd({ data }: { data: object | object[] }): ReactElement {
  const schemas = Array.isArray(data) ? data : [data];

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          // A store's own text ("</script>" in a product name) must not end the tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
