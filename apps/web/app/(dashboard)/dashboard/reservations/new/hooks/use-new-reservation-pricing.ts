import { useCallback, useMemo } from "react";
import { useStoreTimezone } from "@/contexts/store-context";

import { getDetailedDuration } from "@/lib/utils/duration";

import type { CustomItem, Product, ProductPricingDetails, SelectedProduct } from "../types";
import { durationForMode, productLinePricing } from "../utils/product-line-pricing";

interface UseNewReservationPricingParams {
  startDate: Date | undefined;
  endDate: Date | undefined;
  selectedProducts: SelectedProduct[];
  customItems: CustomItem[];
  products: Product[];
}

export function useNewReservationPricing({
  startDate,
  endDate,
  selectedProducts,
  customItems,
  products,
}: UseNewReservationPricingParams) {
  const timezone = useStoreTimezone();
  const calculateDurationForMode = durationForMode;

  const duration = useMemo(() => {
    if (!startDate || !endDate) {
      return 0;
    }

    return calculateDurationForMode(startDate, endDate, "day");
  }, [calculateDurationForMode, endDate, startDate]);

  const detailedDuration = useMemo(() => {
    if (!startDate || !endDate) {
      return null;
    }

    return getDetailedDuration(startDate, endDate);
  }, [endDate, startDate]);

  const hasItems = selectedProducts.length > 0 || customItems.length > 0;

  const getProductPricingDetails = useCallback(
    (product: Product, selectedItem?: SelectedProduct): ProductPricingDetails =>
      productLinePricing({ product, selectedItem, startDate, endDate, timezone }),
    [endDate, startDate, timezone],
  );

  const getCustomItemTotal = useCallback(
    (item: CustomItem) => {
      if (!startDate || !endDate) {
        return 0;
      }

      return (
        item.unitPrice *
        item.quantity *
        calculateDurationForMode(startDate, endDate, item.pricingMode)
      );
    },
    [calculateDurationForMode, endDate, startDate],
  );

  const { subtotal, originalSubtotal, deposit, totalSavings } = useMemo(() => {
    if (!startDate || !endDate || !hasItems || duration === 0) {
      return { subtotal: 0, originalSubtotal: 0, deposit: 0, totalSavings: 0 };
    }

    let subtotalAmount = 0;
    let originalAmount = 0;
    let depositAmount = 0;

    for (const item of selectedProducts) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;

      const productDeposit = parseFloat(product.deposit || "0");
      const pricing = getProductPricingDetails(product, item);

      originalAmount += pricing.lineOriginalSubtotal;
      subtotalAmount += pricing.lineSubtotal;
      depositAmount += productDeposit * item.quantity;
    }

    for (const item of customItems) {
      const itemDuration = calculateDurationForMode(startDate, endDate, item.pricingMode);
      const itemTotal = item.unitPrice * itemDuration * item.quantity;
      subtotalAmount += itemTotal;
      originalAmount += itemTotal;
      depositAmount += item.deposit * item.quantity;
    }

    return {
      subtotal: subtotalAmount,
      originalSubtotal: originalAmount,
      deposit: depositAmount,
      totalSavings: originalAmount - subtotalAmount,
    };
  }, [
    calculateDurationForMode,
    customItems,
    duration,
    endDate,
    getProductPricingDetails,
    hasItems,
    products,
    selectedProducts,
    startDate,
  ]);

  return {
    calculateDurationForMode,
    duration,
    detailedDuration,
    hasItems,
    subtotal,
    originalSubtotal,
    deposit,
    totalSavings,
    getProductPricingDetails,
    getCustomItemTotal,
  };
}
