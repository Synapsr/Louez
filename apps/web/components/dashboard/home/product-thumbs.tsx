"use client";

import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

import type { HomeReservation } from "./home-types";

/** Enough to recognise the order; the names say the rest. */
const MAX_THUMBS = 3;

interface ProductThumbsProps {
  items: HomeReservation["items"];
  /** The ring that parts the photos: the colour of the ground they sit on. */
  ringClassName?: string;
  className?: string;
}

/**
 * The photos of what a reservation takes, overlapping like a small stack —
 * what the owner will hand over or get back, recognised before it is read.
 */
export const ProductThumbs = ({
  items,
  ringClassName = "ring-card",
  className,
}: ProductThumbsProps) => {
  const shown = items.slice(0, MAX_THUMBS);
  if (shown.length === 0) return null;

  return (
    <span aria-hidden className={cn("flex shrink-0", className)}>
      {shown.map((item, index) => (
        <ProductImage
          key={item.id}
          src={item.product?.images?.[0]}
          alt=""
          sizes="28px"
          containerClassName={cn(
            "aspect-square size-7 rounded-md ring-2",
            ringClassName,
            index > 0 && "-ms-2.5",
          )}
        />
      ))}
    </span>
  );
};
