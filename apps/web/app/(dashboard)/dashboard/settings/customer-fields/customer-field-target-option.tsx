"use client";

import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProductImage } from "@/components/product/product-image";

import type { CustomerFieldTargetItem } from "./util.customer-field-online";

interface CustomerFieldTargetOptionProps {
  item: CustomerFieldTargetItem;
}

/** One line of the "Pour" picker: the product photo or a category folder, the name, a hint. */
export const CustomerFieldTargetOption = ({ item }: CustomerFieldTargetOptionProps) => {
  const t = useTranslations("dashboard.settings.customerFields.online");

  const hint =
    item.productCount !== null
      ? t("productCount", { count: item.productCount })
      : item.status === "draft" || item.status === "archived"
        ? t(`productStatus.${item.status}`)
        : null;

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {item.target.type === "category" ? (
        <span className="bg-muted text-muted-foreground flex h-7 w-9 shrink-0 items-center justify-center rounded-lg">
          <Folder className="size-4" />
        </span>
      ) : (
        <ProductImage src={item.image} alt="" sizes="48px" containerClassName="h-7 shrink-0" />
      )}
      <span className="text-foreground min-w-0 flex-1 truncate">{item.label}</span>
      {hint && <span className="text-muted-foreground shrink-0 text-xs">{hint}</span>}
    </span>
  );
};
