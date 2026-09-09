import { orpcClient } from "@/lib/orpc";
import type { RequiredAccessoryCartInput } from "@/lib/utils/cart-required-accessories";

interface ResolveRequiredAccessoriesParams {
  requiredAccessories: Array<{ productId: string; quantity: number }>;
  parentQuantity: number;
  startDate: string;
  endDate: string;
}

/**
 * Resolves the required accessories of a product through the cart endpoint
 * so the advisor adds them with server-priced, server-checked lines.
 * Accessories that fail to resolve are dropped: the checkout validation
 * then rejects the incomplete cart rather than the advisor inventing a price.
 */
export const resolveRequiredAccessories = async ({
  requiredAccessories,
  parentQuantity,
  startDate,
  endDate,
}: ResolveRequiredAccessoriesParams): Promise<RequiredAccessoryCartInput[]> => {
  const requiredQuantityByProductId = new Map(
    requiredAccessories.map((accessory) => [accessory.productId, Math.max(1, accessory.quantity)]),
  );

  const resolved = await orpcClient.storefront.cart.resolve({
    lines: requiredAccessories.map((accessory) => ({
      lineId: `advisor-required-${accessory.productId}`,
      productId: accessory.productId,
      quantity: Math.max(1, accessory.quantity) * parentQuantity,
      startDate,
      endDate,
    })),
  });

  return resolved.lines.flatMap((line) => {
    const requiredQuantity = requiredQuantityByProductId.get(line.productId);

    if (line.status !== "resolved" || !requiredQuantity) {
      return [];
    }

    return [
      {
        productId: line.productId,
        productName: line.productName,
        productImage: line.productImage,
        price: line.price,
        deposit: line.deposit,
        maxQuantity: line.maxQuantity,
        requiredQuantity,
        pricingKind: line.pricingKind,
        pricingMode: line.pricingMode,
        productPricingMode: line.productPricingMode,
        basePeriodMinutes: line.basePeriodMinutes,
        pricingTiers: line.pricingTiers,
      },
    ];
  });
};
