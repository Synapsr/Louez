import { db, products } from "@louez/db";
import type {
  BookingAttributeAxis,
  CombinationAvailability,
  CombinationResolutionResult,
  ProductAvailability,
  UnitAttributes,
} from "@louez/types";
import {
  DEFAULT_COMBINATION_KEY,
  getDeterministicCombinationSortValue,
  matchesSelectedAttributes,
} from "@louez/utils";
import { and, eq } from "drizzle-orm";
import { ApiServiceError } from "./errors";
import {
  type AvailabilityMemo,
  type StorefrontStoreRef,
  getStorefrontAvailability,
  resolveStorefrontStore,
} from "./availability";

type ResolveStorefrontCombinationParams = StorefrontStoreRef & {
  productId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  selectedAttributes?: UnitAttributes;
  memo?: AvailabilityMemo;
};

interface PickCombinationParams {
  combinations: CombinationAvailability[] | undefined;
  bookingAxes: BookingAttributeAxis[] | null | undefined;
  quantity: number;
  selectedAttributes?: UnitAttributes;
}

/**
 * The unit combination a line books, chosen deterministically: among the
 * combinations matching the (possibly partial) attribute selection, the
 * first in axis order that still holds the whole quantity. Null when no
 * single combination can — the caller then splits the line or reports it.
 */
export function pickDeterministicCombination({
  combinations,
  bookingAxes,
  quantity,
  selectedAttributes,
}: PickCombinationParams): CombinationAvailability | null {
  const axes = Array.isArray(bookingAxes) ? bookingAxes : [];
  const candidates = (combinations ?? [])
    .filter((combination) =>
      matchesSelectedAttributes(selectedAttributes, combination.selectedAttributes),
    )
    .sort((a, b) => {
      const sortA = getDeterministicCombinationSortValue(axes, a.selectedAttributes);
      const sortB = getDeterministicCombinationSortValue(axes, b.selectedAttributes);
      return sortA.localeCompare(sortB, "en");
    });

  return candidates.find((combination) => combination.availableQuantity >= quantity) ?? null;
}

/**
 * Combination a resolved cart line books, from availability already computed.
 * Products without unit tracking always resolve to the default combination.
 */
export function resolveLineCombination(params: {
  product: { trackUnits: boolean; bookingAttributeAxes: BookingAttributeAxis[] | null };
  availability: ProductAvailability;
  quantity: number;
  selectedAttributes?: UnitAttributes;
}): CombinationResolutionResult | null {
  const { product, availability, quantity, selectedAttributes } = params;

  if (!product.trackUnits) {
    return {
      combinationKey: DEFAULT_COMBINATION_KEY,
      selectedAttributes: {},
      availableQuantity: availability.availableQuantity,
    };
  }

  const combination = pickDeterministicCombination({
    combinations: availability.combinations,
    bookingAxes: product.bookingAttributeAxes,
    quantity,
    selectedAttributes,
  });

  return combination
    ? {
        combinationKey: combination.combinationKey,
        selectedAttributes: combination.selectedAttributes,
        availableQuantity: combination.availableQuantity,
      }
    : null;
}

export async function resolveStorefrontCombination(
  params: ResolveStorefrontCombinationParams,
): Promise<CombinationResolutionResult> {
  const { productId, quantity, startDate, endDate, selectedAttributes, memo } = params;

  if (quantity < 1) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  const store = await resolveStorefrontStore(params);

  const product = await db.query.products.findFirst({
    columns: {
      id: true,
      name: true,
      trackUnits: true,
      bookingAttributeAxes: true,
    },
    where: and(
      eq(products.id, productId),
      eq(products.storeId, store.id),
      eq(products.status, "active"),
    ),
  });

  if (!product) {
    throw new ApiServiceError("NOT_FOUND", "errors.productNotFound");
  }

  const availability = await getStorefrontAvailability({
    store,
    startDate,
    endDate,
    productIds: [productId],
    memo,
  });

  const availableProduct = availability.products[0];
  if (!availableProduct) {
    throw new ApiServiceError("NOT_FOUND", "errors.productNotFound");
  }

  if (
    !product.trackUnits &&
    availableProduct.availableQuantity !== null &&
    availableProduct.availableQuantity < quantity
  ) {
    throw new ApiServiceError("BAD_REQUEST", "errors.productNoLongerAvailable", {
      name: product.name,
    });
  }

  const resolved = resolveLineCombination({
    product,
    availability: availableProduct,
    quantity,
    selectedAttributes,
  });

  if (!resolved) {
    throw new ApiServiceError("BAD_REQUEST", "errors.productNoLongerAvailable", {
      name: product.name,
    });
  }

  return resolved;
}
