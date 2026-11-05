"use client";

import { Folder } from "lucide-react";

import { ProductImage } from "@/components/product/product-image";

import type { CustomerFieldTargetItem } from "./util.customer-field-online";

interface CustomerFieldTargetChipContentProps {
  item: CustomerFieldTargetItem;
}

/** A picked target in a chip: a folder for a category, the photo for a product. */
export const CustomerFieldTargetChipContent = ({ item }: CustomerFieldTargetChipContentProps) => (
  <span className="flex min-w-0 items-center gap-1.5">
    {item.target.type === "category" ? (
      <Folder aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
    ) : (
      <ProductImage
        src={item.image}
        alt=""
        sizes="32px"
        inset={false}
        containerClassName="h-3.5 shrink-0 rounded-[3px]"
      />
    )}
    <span className="max-w-48 truncate">{item.label}</span>
  </span>
);
