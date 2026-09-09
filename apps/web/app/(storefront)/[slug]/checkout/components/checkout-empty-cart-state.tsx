"use client";

import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

export const CheckoutEmptyCartState = () => {
  const t = useTranslations("storefront.checkout");

  return (
    <EmptyState
      icon={<ShoppingCart />}
      title={t("emptyCart")}
      description={t("emptyCartDescription")}
      action={
        <Button size="lg" render={<StorefrontLink href="/catalog" />}>
          {t("viewCatalog")}
        </Button>
      }
    />
  );
};
