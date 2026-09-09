import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getLocale, getTranslations } from "next-intl/server";

import { generateStoreMetadata, stripHtml } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStoreViewport } from "@/lib/storefront/get-store-viewport";

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
      settings: store.settings,
      theme: store.theme,
    },
    {
      description: store.description
        ? stripHtml(store.description)
        : t("description", { store: store.name }),
      locale,
    },
  );
};

// Viewport colour behind the page chrome (iOS status bar, Android toolbar):
// follows the store's own mode, not the visitor's system preference, since
// the storefront renders in the store mode whatever the device says.
export const generateViewport = async ({ params }: StorefrontLayoutParams): Promise<Viewport> => {
  const { slug } = await params;
  return getStoreViewport(slug);
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

  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <StorefrontLayoutContent params={params}>{children}</StorefrontLayoutContent>
    </Suspense>
  );
};

export default StorefrontLayout;
