"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { ProductImage } from "@/components/product/product-image";

interface RentalUnitCardProps {
  productName: string;
  productImage: string | null;
  /** 0-based. */
  unitIndex: number;
  quantity: number;
  /** Right of the product name: a badge, a button. */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * One rented unit: which product, which one of the line ("1 / 2", only when
 * there are several), then what is asked about it.
 */
export const RentalUnitCard = ({
  productName,
  productImage,
  unitIndex,
  quantity,
  aside,
  children,
}: RentalUnitCardProps) => {
  const t = useTranslations("storefront.customerFields");

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-muted p-4">
      <div className="flex items-center gap-3">
        <ProductImage
          src={productImage}
          alt={productName}
          sizes="56px"
          containerClassName="h-12 shrink-0 bg-background"
        />
        <p className="min-w-0 flex-1 truncate font-medium leading-snug">{productName}</p>
        {quantity > 1 && (
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {t("unitCounter", { index: unitIndex + 1, count: quantity })}
          </span>
        )}
        {aside}
      </div>
      {children}
    </div>
  );
};
