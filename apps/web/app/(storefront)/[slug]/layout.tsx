import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getLocale, getTranslations } from "next-intl/server";

import { generateStoreMetadata, stripHtml } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { redirectLegacyStorefrontUrl } from "@/lib/storefront/legacy-url-redirect";
import { STORE_THEME_VIEWPORT_COLORS } from "@/lib/theme/util.store-theme";

import { StorefrontLayoutContent } from "./storefront-layout-content";

interface StorefrontLayoutParams {
  params: Promise<{ slug: string }>;
}

export const generateMetadata = async ({ params }: StorefrontLayoutParams): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t, locale] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.meta"),
    getLocale(),
  ]);

  if (!store) {
    return { title: t("storeNotFound") };
  }

  const googleSiteVerification = store.settings?.seo?.googleSiteVerification;

  return {
    ...generateStoreMetadata(
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
        tagline: store.tagline,
        faviconUrl: store.faviconUrl,
        settings: store.settings,
        theme: store.theme,
      },
      {
        description:
          stripHtml(store.tagline || "") ||
          (store.description
            ? stripHtml(store.description)
            : t("description", { store: store.name })),
        locale,
      },
    ),
    // Search Console ownership proof; pages never override this key, so it
    // reaches every storefront page from here.
    ...(googleSiteVerification && { verification: { google: googleSiteVerification } }),
  };
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Store existence, metadata, theme, and embed mode are resolved per request.
export const instant = false;

const StorefrontLayout = async ({
  children,
  params,
}: StorefrontLayoutParams & {
  children: React.ReactNode;
}) => {
  const { slug } = await params;

  // An unknown or not-yet-onboarded store answers a real 404 here, before
  // the Suspense boundary, so the response status is not a 200 shell. The
  // read is React-cached and shared with the metadata and the content.
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  // Same reason: a product or category still addressed by id must answer a
  // real 308 to its slug URL, which is only possible before the shell streams.
  await redirectLegacyStorefrontUrl(store, (await headers()).get("x-storefront-path"));

  return (
    <>
      {/* React hoists this store-specific colour into the document head. */}
      <meta
        name="theme-color"
        content={STORE_THEME_VIEWPORT_COLORS[store.theme?.mode === "dark" ? "dark" : "light"]}
      />
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <StorefrontLayoutContent params={params}>{children}</StorefrontLayoutContent>
      </Suspense>
    </>
  );
};

export default StorefrontLayout;
