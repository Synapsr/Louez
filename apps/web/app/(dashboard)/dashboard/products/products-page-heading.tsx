"use client";

import type { MouseEventHandler } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FolderOpen, Lock, Plus } from "lucide-react";
import { Button } from "@louez/ui";
import { NewFeatureBadge } from "@/components/dashboard/new-feature-badge";

export const ProductsPageHeading = ({
  readOnly = false,
  isAtLimit = false,
  onManageCategories,
  onUpgrade,
  onAddProduct,
}: {
  readOnly?: boolean;
  isAtLimit?: boolean;
  onManageCategories?: () => void;
  onUpgrade?: () => void;
  onAddProduct?: MouseEventHandler<HTMLAnchorElement>;
}) => {
  const t = useTranslations("dashboard.products");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm sm:text-base text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          disabled={readOnly}
          variant="outline"
          size="icon"
          className="sm:hidden"
          title={t("manageCategories")}
          onClick={onManageCategories}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
        <Button
          disabled={readOnly}
          variant="outline"
          className="hidden sm:inline-flex"
          onClick={onManageCategories}
        >
          <FolderOpen className="mr-2 h-4 w-4" />
          {t("manageCategories")}
        </Button>
        {isAtLimit ? (
          <>
            <Button
              disabled={readOnly}
              size="icon"
              className="sm:hidden"
              onClick={onUpgrade}
              title={t("addProduct")}
            >
              <Lock className="h-4 w-4" />
            </Button>
            <Button disabled={readOnly} className="hidden sm:inline-flex" onClick={onUpgrade}>
              <Lock className="mr-2 h-4 w-4" />
              {t("addProduct")}
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={readOnly}
              size="icon"
              className="sm:hidden"
              // The badge adds screen reader text, so the name has to be explicit.
              aria-label={t("addProduct")}
              title={t("addProduct")}
              render={
                readOnly ? undefined : (
                  <Link href="/dashboard/products/new" onClick={onAddProduct} />
                )
              }
            >
              <Plus className="h-4 w-4" />
              {/* Inset inside the primary fill: the default dot colour is the
                    button's own background, so it needs the inverse token. */}
              {!readOnly && (
                <NewFeatureBadge
                  className="absolute top-1 right-1 bg-primary-foreground"
                  featureId="product-creation-flow-redesign"
                  mode="dot"
                />
              )}
            </Button>
            <Button
              disabled={readOnly}
              className="hidden sm:inline-flex"
              render={
                readOnly ? undefined : (
                  <Link href="/dashboard/products/new" onClick={onAddProduct} />
                )
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("addProduct")}
              {!readOnly && (
                <NewFeatureBadge
                  className="bg-primary-foreground text-primary"
                  featureId="product-creation-flow-redesign"
                />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
