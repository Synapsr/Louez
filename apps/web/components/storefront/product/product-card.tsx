"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { CheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { AvailabilityBadge } from "@/components/storefront/availability-badge";
import { Price } from "@/components/storefront/ui/price";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

import { QuickAddButton } from "./quick-add-button";
import { useProductCardPricing } from "./use-product-card-pricing";
import {
  type ProductCardAvailability,
  type ProductCardPeriod,
  getStockAvailability,
  isNoteworthyAvailability,
} from "./util.product-card";

/** Two columns on phones, three from `md`, four from `lg`: the sizes match. */
export const PRODUCT_CARD_IMAGE_SIZES = "(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw";

/** Turns the card into a toggle: picking, not browsing. */
export interface ProductCardSelection {
  selected: boolean;
  onToggle: () => void;
}

interface ProductCardBaseProps {
  product: StorefrontCatalogProduct;
  /** Prices the period total instead of the base rate. */
  period?: ProductCardPeriod | null;
  /** Server availability for the period; stock only when absent. */
  availability?: ProductCardAvailability | null;
  /** Above the fold: the first four cards of a grid. */
  priority?: boolean;
  className?: string;
}

type ProductCardProps = ProductCardBaseProps &
  (
    | {
        /** Store-relative product page link; `StorefrontLink` adds the base path. */
        href: string;
        selection?: never;
        /** Renders the one-tap add bar in the image. Simple products only. */
        onQuickAdd?: () => void;
      }
    | { href?: never; selection: ProductCardSelection; onQuickAdd?: never }
  );

/**
 * The one product card of the storefront, in two moods. Browsing: the title
 * links to the product page and stretches over the whole card, which leaves
 * the quick add free to sit in the image. Picking (an accessory offered
 * after an add): the same card is a toggle that says whether it is selected.
 */
export const ProductCard = ({
  product,
  href,
  selection,
  period,
  availability,
  onQuickAdd,
  priority = false,
  className,
}: ProductCardProps) => {
  const t = useTranslations("storefront.product");
  const pricing = useProductCardPricing(product, period);
  const currentAvailability = availability ?? getStockAvailability(product);
  const isUnavailable =
    currentAvailability !== null &&
    currentAvailability.status !== "available" &&
    currentAvailability.status !== "limited" &&
    currentAvailability.status !== "in_cart";
  /** Only what helps the visitor: scarcity and blockers, never a full stock. */
  const shownAvailability = isNoteworthyAvailability(currentAvailability)
    ? currentAvailability
    : null;

  const shellClassName = cn(
    "relative flex h-full flex-col gap-2 rounded-2xl bg-card text-left outline-none",
    // Browsing: the hairline of the resting card darkens under the pointer.
    // No elevation — the image zoom below is what answers the hover. The ring
    // follows the title link, the only thing here a keyboard can focus.
    !selection && [
      "shadow-card transition-shadow duration-150 group-hover:ring-1 group-hover:ring-foreground/12",
      "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
    ],
    // Picking: the card is the button, and it sits in a carousel that clips
    // its edges, so its outline is drawn inside it, by the overlay below.
    selection && "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  );

  const content = (
    <>
      {/* Inset image: a frame of card around it, its radius concentric with
          the card's own (outer radius = inner radius + padding). */}
      <div className="p-1 pb-0">
        <div className="relative aspect-4/3 overflow-hidden rounded-xl shadow-[0_0_1px_0.75px_var(--color-border)] bg-muted">
          <ProductImage
            src={product.images?.[0]}
            alt={product.name}
            sizes={PRODUCT_CARD_IMAGE_SIZES}
            priority={priority}
            inset={false}
            containerClassName="absolute inset-0 rounded-none"
            className={cn(
              // The 4/3 frame crops the zoom, so the card itself never moves.
              // `scale` is its own property in Tailwind v4, not part of `transform`.
              "motion-safe:transition-[opacity,scale] motion-safe:duration-400 motion-safe:ease-out motion-safe:group-hover:scale-[1.04]",
              isUnavailable && "opacity-60 grayscale",
            )}
          />
          <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
            {pricing.promoPercent > 0 && !isUnavailable ? (
              <Badge variant="promo" className="shadow-card">
                -{pricing.promoPercent}%
              </Badge>
            ) : null}
            {shownAvailability ? (
              <AvailabilityBadge
                status={shownAvailability.status}
                availableQuantity={shownAvailability.availableQuantity}
                className="shadow-card"
              />
            ) : null}
          </div>
          {selection ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border bg-background/90 text-transparent shadow-card backdrop-blur transition-colors",
                selection.selected && "border-primary bg-primary text-primary-foreground",
              )}
            >
              <CheckIcon className="size-3.5" />
            </span>
          ) : null}

          {onQuickAdd ? <QuickAddButton label={t("addToCart")} onClick={onQuickAdd} /> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1 px-2 pb-2">
        <h3 className="line-clamp-1 text-sm font-medium sm:text-base">
          {href === undefined ? (
            product.name
          ) : (
            // Stretched link: the pseudo-element covers the card, so the whole
            // surface navigates without a button ever nesting inside a link.
            <StorefrontLink
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
              href={href}
            >
              {product.name}
            </StorefrontLink>
          )}
        </h3>
        <Price
          amount={pricing.amount}
          compareAt={pricing.compareAt}
          per={pricing.per}
          label={pricing.label}
          size="md"
        />
      </div>

      {/* Last child: an inset ring is painted under the children, and the
          image would eat its top edge. */}
      {selection ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-2xl ring-inset transition-shadow duration-200",
            selection.selected
              ? "ring-2 ring-primary"
              : "ring-1 ring-border group-hover:ring-foreground/16",
          )}
        />
      ) : null}
    </>
  );

  return (
    <article className={cn("group relative", className)} data-slot="product-card">
      {href !== undefined ? (
        <div className={shellClassName}>{content}</div>
      ) : (
        <button
          aria-pressed={selection?.selected}
          className={cn(shellClassName, "w-full")}
          onClick={selection?.onToggle}
          type="button"
        >
          {content}
        </button>
      )}
    </article>
  );
};
