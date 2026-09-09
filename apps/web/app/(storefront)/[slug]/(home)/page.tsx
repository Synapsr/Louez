import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "next-intl/server";

import { GoogleReviewsSection } from "@/components/storefront/google-reviews-section";
import { GoogleRatingPill } from "@/components/storefront/home/google-rating-pill";
import { HomeInventory } from "@/components/storefront/home/home-inventory";
import { HomePeriodSearch } from "@/components/storefront/home/home-period-search";
import { StoreHero } from "@/components/storefront/home/store-hero";
import { StoreLocation } from "@/components/storefront/home/store-location";
import { StoreReassurance } from "@/components/storefront/home/store-reassurance";
import { PageTracker } from "@/components/storefront/page-tracker";
import { StoreStatusBadge } from "@/components/storefront/store-status-badge";
import {
  JsonLd,
  generateLocalBusinessSchema,
  generateStoreMetadata,
  generateWebSiteSchema,
  stripHtml,
} from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { loadHomePage } from "@/lib/storefront/home.queries";
import { resolveStoreHeroPresentation } from "@/lib/utils/util.store-hero";
import { getStorePeriodRules } from "@/lib/utils/util.store-period-rules";

interface StorefrontPageProps {
  params: Promise<{ slug: string }>;
}

// Keep public browse pages in the router cache for five minutes.
export const unstable_dynamicStaleTime = 300;

export const generateMetadata = async ({ params }: StorefrontPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t, locale] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.meta"),
    getLocale(),
  ]);

  if (!store) {
    return { title: t("storeNotFound") };
  }

  return generateStoreMetadata(store, {
    title: t("homeTitle", { store: store.name }),
    description: store.description
      ? stripHtml(store.description)
      : t("description", { store: store.name }),
    images: store.theme?.heroImages?.slice(0, 1),
    locale,
  });
};

const StorefrontPage = async ({ params }: StorefrontPageProps) => {
  const { slug } = await params;
  const t = await getTranslations("storefront");
  const data = await loadHomePage(slug, {
    others: t("availability.categoryBrowse.others"),
    othersDescription: t("availability.categoryBrowse.othersDescription"),
    all: t("catalog.allProducts"),
  });

  if (!data) {
    notFound();
  }

  const { store, settings, theme, heroImages, tagline, status, inventory, reassurance, place } =
    data;
  const ratingHref = place.showReviews ? "#reviews" : (place.details?.mapsUrl ?? null);
  const hero = resolveStoreHeroPresentation({ theme, imageCount: heroImages.length });

  return (
    <>
      <PageTracker page="home" />
      <JsonLd data={[generateLocalBusinessSchema(store), generateWebSiteSchema(store)]} />

      <StoreHero
        name={store.name}
        tagline={tagline}
        backgroundImages={heroImages}
        shape={hero.shape}
        align={hero.align}
        verticalAlign={hero.verticalAlign}
        badges={
          <>
            <StoreStatusBadge
              businessHours={settings.businessHours}
              timezone={settings.timezone}
              initialStatus={status}
              className={hero.textOnPhoto ? "bg-background/90 backdrop-blur" : undefined}
            />
            {place.rating !== null ? (
              <GoogleRatingPill
                rating={place.rating}
                reviewCount={place.reviewCount}
                href={ratingHref}
                className={hero.shape === "split" ? "border" : undefined}
              />
            ) : null}
          </>
        }
        footer={
          <StoreReassurance
            items={reassurance}
            tone={hero.textOnPhoto ? "onPhoto" : "onSurface"}
            className={hero.align === "center" ? "justify-center" : undefined}
          />
        }
      >
        <HomePeriodSearch
          rules={getStorePeriodRules(settings)}
          tone={hero.shape === "split" ? "flat" : "floating"}
        />
      </StoreHero>

      <HomeInventory inventory={inventory} />

      {place.showReviews && place.details ? <GoogleReviewsSection details={place.details} /> : null}

      {store.address ? (
        <StoreLocation
          name={store.name}
          address={store.address}
          phone={store.phone}
          email={store.email}
          latitude={store.latitude}
          longitude={store.longitude}
        />
      ) : null}
    </>
  );
};

export default StorefrontPage;
