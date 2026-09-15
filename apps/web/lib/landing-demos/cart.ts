import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { summarizeCart, type CartItem } from "@/lib/utils/util.cart-lines";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import { DEMO_PRODUCTS, type DemoBooking } from "./fixtures";

export const getDemoCart = (
  quantities: Readonly<Record<string, number>>,
  period: RentalPeriodValue,
) => {
  const cartPeriod = { startDate: period.start.toISOString(), endDate: period.end.toISOString() };
  const items: CartItem[] = DEMO_PRODUCTS.flatMap((product) => {
    const requested = quantities[product.id] ?? 0;
    if (!Number.isFinite(requested) || requested < 1) return [];
    const quantity = Math.min(Math.floor(requested), product.quantity ?? requested);
    return [
      {
        lineId: product.id,
        selectionSignature: "__default",
        productId: product.id,
        productName: product.name,
        productImage: product.images?.[0] ?? null,
        price: Number(product.price),
        deposit: Number(product.deposit),
        quantity,
        maxQuantity: product.quantity,
        pricingKind: "duration",
        pricingMode: "day",
        productPricingMode: "day",
        basePeriodMinutes: 1440,
        timezone: "Europe/Paris",
        ...cartPeriod,
      },
    ];
  });
  const lines = items.map((item) => ({
    productIndex: DEMO_PRODUCTS.findIndex((product) => product.id === item.productId),
    quantity: item.quantity,
    selected: {},
    unitPrice:
      calculateCartItemPrice(item, cartPeriod.startDate, cartPeriod.endDate).subtotal /
      item.quantity,
  }));
  const booking: DemoBooking | null = lines[0] ? { ...lines[0], lines, period } : null;
  return { items, period: cartPeriod, summary: summarizeCart(items, cartPeriod, null), booking };
};
