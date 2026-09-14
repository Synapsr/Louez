"use client";

import { cn } from "@louez/utils";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface StoreLogoProps {
  storeName: string;
  logoUrl?: string | null;
  /** Store-relative home href; the marketplace keeps its channel param. */
  href?: string;
  className?: string;
}

/** Logo (or the store name) linking home; 44 px tall so it is a real target. */
export const StoreLogo = ({ storeName, logoUrl, href = "/", className }: StoreLogoProps) => (
  <StorefrontLink
    href={href}
    aria-label={storeName}
    className={cn(
      "flex min-h-11 min-w-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      className,
    )}
  >
    {logoUrl ? (
      <img src={logoUrl} alt={storeName} className="h-8 w-auto max-w-32 object-contain md:h-9" />
    ) : (
      <span className="truncate text-base font-semibold tracking-tight">{storeName}</span>
    )}
  </StorefrontLink>
);
