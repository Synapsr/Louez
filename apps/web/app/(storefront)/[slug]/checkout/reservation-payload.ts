import type { CartItem } from '@/contexts/cart-context';
import { calculateCartItemPrice } from '@/lib/utils/cart-pricing';

import type { createReservation } from './actions';
import type {
  CheckoutFormValues,
  DeliveryAddress,
  DeliveryOption,
} from './types';

type CreateReservationInput = Parameters<typeof createReservation>[0];

interface BuildReservationPayloadInput {
  storeId: string;
  pricingMode?: 'day' | 'hour' | 'week';
  locale: 'fr' | 'en';
  values: CheckoutFormValues;
  items: CartItem[];
  subtotalAmount: number;
  depositAmount: number;
  totalAmount: number;
  deliveryOption: DeliveryOption;
  deliveryAddress: DeliveryAddress;
  tulipInsuranceMode: 'required' | 'optional' | 'no_public';
  hasDifferentReturnAddress: boolean;
  returnAddress: DeliveryAddress;
  promoCode?: string;
}

export function buildReservationPayload({
  storeId,
  locale,
  values,
  items,
  subtotalAmount,
  depositAmount,
  totalAmount,
  deliveryOption,
  deliveryAddress,
  tulipInsuranceMode,
  hasDifferentReturnAddress,
  returnAddress,
  promoCode,
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
      const priceResult = calculateCartItemPrice(item, null, null);
      const effectiveUnitPrice =
        priceResult.subtotal / Math.max(1, item.quantity);

      return {
        lineId: item.lineId,
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
    tulipInsuranceOptIn:
      tulipInsuranceMode === 'required'
        ? true
        : tulipInsuranceMode === 'optional'
          ? values.tulipInsuranceOptIn
          : undefined,
    subtotalAmount,
    depositAmount,
    totalAmount,
    locale,
    promoCode,
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
            ...(hasDifferentReturnAddress &&
            returnAddress.latitude !== null &&
            returnAddress.longitude !== null
              ? {
                  returnAddress: returnAddress.address,
                  returnCity: returnAddress.city,
                  returnPostalCode: returnAddress.postalCode,
                  returnCountry: returnAddress.country,
                  returnLatitude: returnAddress.latitude,
                  returnLongitude: returnAddress.longitude,
                }
              : {}),
          }
        : { option: 'pickup' },
  };
}
