import type { CartItem } from '@/contexts/cart-context';

import type { ProductPricing } from '@louez/utils';
import { calculateRentalPrice } from '@louez/utils';

import type { createReservation } from './actions';
import type {
  CheckoutFormValues,
  DeliveryAddress,
  DeliveryOption,
} from './types';
import { calculateDuration } from './utils';

type CreateReservationInput = Parameters<typeof createReservation>[0];

interface BuildReservationPayloadInput {
  storeId: string;
  pricingMode: 'day' | 'hour' | 'week';
  locale: 'fr' | 'en';
  values: CheckoutFormValues;
  items: CartItem[];
  subtotalAmount: number;
  depositAmount: number;
  totalAmount: number;
  deliveryOption: DeliveryOption;
  deliveryAddress: DeliveryAddress;
}

export function buildReservationPayload({
  storeId,
  pricingMode,
  locale,
  values,
  items,
  subtotalAmount,
  depositAmount,
  totalAmount,
  deliveryOption,
  deliveryAddress,
}: BuildReservationPayloadInput): CreateReservationInput {
  return {
    storeId,
    customer: {
      email: values.email,
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      customerType: values.isBusinessCustomer ? 'business' : 'individual',
      companyName: values.isBusinessCustomer
        ? values.companyName.trim()
        : undefined,
      address: values.address || undefined,
      city: values.city || undefined,
      postalCode: values.postalCode || undefined,
    },
    items: items.map((item) => {
      const itemPricingMode = item.productPricingMode || pricingMode;
      const duration = calculateDuration(
        item.startDate,
        item.endDate,
        itemPricingMode,
      );

      let effectiveUnitPrice = item.price;

      if (item.pricingTiers && item.pricingTiers.length > 0) {
        const pricing: ProductPricing = {
          basePrice: item.price,
          deposit: item.deposit,
          pricingMode: itemPricingMode,
          tiers: item.pricingTiers.map((tier, index) => ({
            ...tier,
            displayOrder: index,
          })),
        };

        const result = calculateRentalPrice(pricing, duration, item.quantity);
        effectiveUnitPrice = result.effectivePricePerUnit;
      }

      return {
        productId: item.productId,
        selectedAttributes: item.selectedAttributes,
        resolvedCombinationKey: item.resolvedCombinationKey,
        resolvedAttributes: item.resolvedAttributes,
        quantity: item.quantity,
        startDate: item.startDate,
        endDate: item.endDate,
        unitPrice: effectiveUnitPrice,
        depositPerUnit: item.deposit,
        productSnapshot: {
          name: item.productName,
          description: null,
          images: item.productImage ? [item.productImage] : [],
          combinationKey: item.resolvedCombinationKey || null,
          selectedAttributes: item.resolvedAttributes || item.selectedAttributes || null,
        },
      };
    }),
    customerNotes: values.notes || undefined,
    subtotalAmount,
    depositAmount,
    totalAmount,
    locale,
    delivery:
      deliveryOption === 'delivery' &&
      deliveryAddress.latitude !== null &&
      deliveryAddress.longitude !== null
        ? {
            option: 'delivery',
            address: deliveryAddress.address,
            city: deliveryAddress.city,
            postalCode: deliveryAddress.postalCode,
            country: deliveryAddress.country,
            latitude: deliveryAddress.latitude,
            longitude: deliveryAddress.longitude,
          }
        : { option: 'pickup' },
  };
}
