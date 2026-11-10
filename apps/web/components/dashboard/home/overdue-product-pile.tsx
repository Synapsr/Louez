"use client";

import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

import type { OverdueHomeReservation } from "./home-types";

/** A small pile reads as "several things"; more would only blur it. */
const PILE_MAX = 3;

/** Each photo set slightly askew, the top one straight, like a stack on the counter. */
const PILE_TILTS = ["-rotate-8 -translate-x-1", "rotate-6 translate-x-1", "rotate-0"];

interface OverdueProductPileProps {
  rows: OverdueHomeReservation[];
}

/**
 * The gear behind what is left to settle, as a few product photos piled on
 * one another: the owner recognises what is out before reading a word.
 * Photos come first; products without one only fill the pile when needed.
 */
export const OverdueProductPile = ({ rows }: OverdueProductPileProps) => {
  const seen = new Set<string>();
  const products = rows
    .flatMap((row) => row.items.map((item) => item.product))
    .filter((product): product is NonNullable<typeof product> => {
      if (!product || seen.has(product.name)) return false;
      seen.add(product.name);
      return true;
    })
    .sort((a, b) => Number(Boolean(b.images?.[0])) - Number(Boolean(a.images?.[0])))
    .slice(0, PILE_MAX);

  if (products.length === 0) return null;
  // The top of the pile is the last drawn: the first product.
  const pile = [...products].reverse();
  const tilts = PILE_TILTS.slice(PILE_MAX - pile.length);

  return (
    <span aria-hidden className="relative size-9 shrink-0">
      {pile.map((product, index) => (
        <ProductImage
          key={product.name}
          src={product.images?.[0]}
          alt=""
          sizes="36px"
          containerClassName={cn(
            "absolute inset-0 aspect-square size-9 rounded-md ring-border shadow-sm ring-1",
            tilts[index],
          )}
        />
      ))}
    </span>
  );
};
