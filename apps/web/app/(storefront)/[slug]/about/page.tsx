import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "next-intl/server";

import { OpeningHoursCard } from "@/components/storefront/about/opening-hours-card";
import { StoreServicesCard } from "@/components/storefront/about/store-services-card";
import { StoreLocation } from "@/components/storefront/home/store-location";
import { BackLink } from "@/components/storefront/ui/back-link";
import { RichText } from "@/components/storefront/ui/rich-text";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { generateLocalBusinessSchema, generateStoreMetadata, JsonLd, stripHtml } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { hasRichTextContent } from "@/lib/util.rich-text";
import { buildOpeningHoursSpecification } from "@/lib/utils/util.opening-hours";

interface AboutPageProps {
  params: Promise<{ slug: string }>;
}

export const unstable_dynamicStaleTime = 300;

const LINK_CLASS_NAME = "text-sm font-medium underline underline-offset-4 hover:opacity-70";

export const generateMetadata = async ({ params }: AboutPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t, locale] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.about"),
    getLocale(),
  ]);

  if (!store) {
    return {};
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings,
      theme: store.theme,
    },
    {
      title: t("metaTitle", { name: store.name }),
      description: store.description
        ? stripHtml(store.description).slice(0, 160)
        : t("metaDescription", { name: store.name }),
      path: "/about",
      locale,
    },
  );
};

/**
 * The store's information page: who they are, when they open, how renting
 * works, where to find them. Plain content, indexed, with LocalBusiness
 * structured data carrying the opening hours.
 */
const AboutPage = async ({ params }: AboutPageProps) => {
  const { slug } = await params;
  const [store, t] = await Promise.all([getStoreBySlug(slug), getTranslations("storefront.about")]);

  if (!store) {
    notFound();
  }

  const settings = store.settings;
  const openingHoursSpecification = buildOpeningHoursSpecification(settings?.businessHours);

  return (
    <>
      <JsonLd
        data={[
          {
            ...generateLocalBusinessSchema(store),
            ...(openingHoursSpecification.length > 0 ? { openingHoursSpecification } : {}),
          },
        ]}
      />

      <StorefrontSection width="narrow" contentClassName="flex flex-col gap-8 sm:gap-10">
        <div>
          <BackLink href="/" />
          <SectionHeader
            level="h1"
            title={t("title", { name: store.name })}
            className="mt-2 mb-0"
          />
        </div>

        {hasRichTextContent(store.description) ? <RichText html={store.description} /> : null}

        <OpeningHoursCard businessHours={settings?.businessHours} timezone={settings?.timezone} />

        <StoreServicesCard
          settings={settings}
          stripeAccountId={store.stripeAccountId}
          stripeChargesEnabled={store.stripeChargesEnabled}
        />

        <nav aria-label={t("moreTitle")} className="flex flex-wrap gap-x-6 gap-y-2">
          <StorefrontLink href="/catalog" className={LINK_CLASS_NAME}>
            {t("catalog")}
          </StorefrontLink>
          <StorefrontLink href="/terms" className={LINK_CLASS_NAME}>
            {t("terms")}
          </StorefrontLink>
          <StorefrontLink href="/legal" className={LINK_CLASS_NAME}>
            {t("legal")}
          </StorefrontLink>
        </nav>
      </StorefrontSection>

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

export default AboutPage;
