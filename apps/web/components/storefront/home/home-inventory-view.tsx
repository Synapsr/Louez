import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

interface HomeInventoryViewProps {
  kind: "categories" | "products";
  children: ReactNode;
  linkPrefetch?: boolean;
}

/** Shared home section; its caller supplies the server-backed or local grid. */
export const HomeInventoryView = ({ kind, children, linkPrefetch }: HomeInventoryViewProps) => {
  const t = useTranslations("storefront");

  return (
    <StorefrontSection aria-labelledby="home-inventory-title">
      <SectionHeader
        id="home-inventory-title"
        title={
          kind === "categories" ? t("availability.categoryBrowse.title") : t("home.ourProducts")
        }
        action={
          <StorefrontLink
            href="/catalog"
            prefetch={linkPrefetch}
            className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("home.viewAll")}
          </StorefrontLink>
        }
      />
      {children}
    </StorefrontSection>
  );
};
