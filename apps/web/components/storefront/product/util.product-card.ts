import type { ProductAvailability } from "@louez/types";
import type { StockQuantityLimit } from "@louez/utils";

import type { AvailabilityStatus } from "@/components/storefront/availability-badge";
import type { AccessoryLink, StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import {
  findBlockingRequiredAccessories,
  selectOptionalAccessories,
} from "@/lib/utils/cart-required-accessories";

/** Rental period a card prices and links with, as ISO strings. */
export interface ProductCardPeriod {
  startDate: string;
  endDate: string;
}

/** What a card says under the price once dates are known. */
export interface ProductCardAvailability {
  status: AvailabilityStatus;
  /** Bookable units for the period; `null` when stock is not tracked. */
  availableQuantity: StockQuantityLimit;
}

type ProductStock = Pick<StorefrontCatalogProduct, "quantity" | "stockKind" | "displayQuantity">;

type QuickAddProduct = Pick<StorefrontCatalogProduct, "accessories">;

/** Units in stock regardless of dates; `null` when the store does not track them. */
export const getProductStockLimit = (product: ProductStock): StockQuantityLimit =>
  product.stockKind === "untracked" ? null : (product.displayQuantity ?? product.quantity);

export const isProductInStock = (product: ProductStock): boolean => {
  const limit = getProductStockLimit(product);
  return limit === null || limit > 0;
};

/**
 * A product the card can offer to add: every required accessory in stock
 * for one unit. Whatever else the add needs — dates, a variant, extras —
 * the quick add dialog asks for on the way.
 */
export const isQuickAddableProduct = (product: QuickAddProduct): boolean =>
  findBlockingRequiredAccessories(product.accessories ?? [], 1).length === 0;

/** Optional accessories a card can still offer: in stock and not in the cart. */
export const selectOfferableExtras = (
  accessories: AccessoryLink[] | null | undefined,
  cartProductIds: ReadonlySet<string>,
): AccessoryLink[] =>
  selectOptionalAccessories(accessories ?? []).filter(
    (accessory) =>
      (accessory.quantity === null || accessory.quantity > 0) && !cartProductIds.has(accessory.id),
  );

/**
 * Stock cap the quick-add line gets, or `undefined` when the card must not
 * offer quick add: nothing bookable.
 */
export const getQuickAddLimit = (
  product: QuickAddProduct & ProductStock,
  availability?: ProductCardAvailability | null,
): StockQuantityLimit | undefined => {
  if (!isQuickAddableProduct(product)) return undefined;

  const limit = availability ? availability.availableQuantity : getProductStockLimit(product);
  if (limit !== null && limit <= 0) return undefined;
  if (availability && availability.status === "required_accessory_out_of_stock") return undefined;

  return limit;
};

/** Units left at or under which a card announces the count. */
export const LOW_AVAILABILITY_THRESHOLD = 3;

/**
 * Whether the card says anything about availability. Blocking states and a
 * line already in the cart always speak. A count only when it helps the
 * visitor decide: the last unit, or a stock the chosen dates have eaten
 * into and left near empty. A shop that owns two of everything is not
 * scarcity, so a full stock stays silent.
 */
export const isNoteworthyAvailability = (availability: ProductCardAvailability | null): boolean => {
  if (!availability) return false;

  switch (availability.status) {
    case "available":
      return availability.availableQuantity === 1;
    case "limited":
      return (
        availability.availableQuantity !== null &&
        availability.availableQuantity <= LOW_AVAILABILITY_THRESHOLD
      );
    default:
      return true;
  }
};

/**
 * Availability a card shows without a server availability result: only an
 * empty stock is worth a line. In stock says nothing until dates narrow it.
 */
export const getStockAvailability = (product: ProductStock): ProductCardAvailability | null =>
  isProductInStock(product) ? null : { status: "out_of_stock", availableQuantity: 0 };

interface ToProductCardAvailabilityInput {
  product: ProductStock & Pick<StorefrontCatalogProduct, "accessories">;
  availableQuantity: StockQuantityLimit;
  /** Why availability is zero, from the server availability call. */
  reason?: ProductAvailability["reason"];
}

/**
 * Maps a server availability result to what the card shows. The rules are
 * the ones the rental grid applied: a required accessory out of stock blocks
 * the product, "limited" means fewer units than the stock for these dates.
 */
export const toProductCardAvailability = ({
  product,
  availableQuantity,
  reason,
}: ToProductCardAvailabilityInput): ProductCardAvailability => {
  const hasBlockingRequiredAccessory =
    findBlockingRequiredAccessories(product.accessories ?? [], 1).length > 0;
  const totalQuantity = getProductStockLimit(product);

  if (hasBlockingRequiredAccessory || reason === "required_accessory_out_of_stock") {
    return { status: "required_accessory_out_of_stock", availableQuantity: 0 };
  }
  if (availableQuantity === 0) {
    return {
      status: reason === "out_of_stock" ? "out_of_stock" : "unavailable",
      availableQuantity: 0,
    };
  }
  if (availableQuantity !== null && (totalQuantity === null || availableQuantity < totalQuantity)) {
    return { status: "limited", availableQuantity };
  }

  return { status: "available", availableQuantity };
};

/** Product page link, carrying the period so the page opens on the same dates. */
export const buildProductHref = (productId: string, period?: ProductCardPeriod | null): string => {
  if (!period) return `/product/${productId}`;

  const params = new URLSearchParams({
    startDate: period.startDate,
    endDate: period.endDate,
  });

  return `/product/${productId}?${params.toString()}`;
};
