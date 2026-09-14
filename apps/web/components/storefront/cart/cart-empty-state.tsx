"use client";

import { ShoppingBagIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface CartEmptyStateProps {
  /** Called when the visitor follows the catalogue link (closes the drawer). */
  onNavigate?: () => void;
  closeOnly?: boolean;
}

export const CartEmptyState = ({ onNavigate, closeOnly = false }: CartEmptyStateProps) => {
  const t = useTranslations("storefront.cart");

  return (
    <EmptyState
      icon={<ShoppingBagIcon />}
      title={t("empty")}
      description={t("emptyDescription")}
      action={
        <Button
          size="lg"
          className="h-12 lg:h-10"
          onClick={onNavigate}
          render={closeOnly ? undefined : <StorefrontLink href="/catalog" />}
        >
          {t("viewCatalog")}
        </Button>
      }
    />
  );
};
