import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { PageTracker } from "@/components/storefront/page-tracker";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { getCustomerSession } from "@/lib/customer-auth/session";
import {
  getSafeAccountRedirect,
  parseLoginErrorCode,
} from "@/lib/customer-auth/util.account-redirect";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { storefrontRedirect } from "@/lib/storefront-url";

import { LoginForm } from "./login-form";

interface LoginPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}

export const instant = false;

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);
  if (!store) return { title: "Boutique introuvable" };

  const t = await getTranslations("storefront.account");

  return generateStoreMetadata(store, {
    title: `${t("loginTitle")} - ${store.name}`,
    description: t("loginLine"),
    noIndex: true,
  });
}

/**
 * Email → 6-digit code. `?redirect` (account paths or checkout) is honoured after
 * the code is verified; `?error` (set by `/r/{id}` on an expired link) is
 * shown inline above the form.
 */
export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const redirectPath = getSafeAccountRedirect(query.redirect);
  const errorCode = parseLoginErrorCode(query.error);

  const session = await getCustomerSession(store.id);
  if (session) storefrontRedirect(slug, redirectPath);

  return (
    <>
      <PageTracker page="account" />
      <StorefrontSection
        width="narrow"
        className="bg-background sm:py-16"
        contentClassName="max-w-lg"
      >
        <LoginForm
          storeName={store.name}
          storeSlug={slug}
          redirectPath={redirectPath}
          errorCode={errorCode}
        />
      </StorefrontSection>
    </>
  );
}
