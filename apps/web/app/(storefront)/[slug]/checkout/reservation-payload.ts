import type { LegMethod } from '@louez/types';

import type { CartItem } from '@/contexts/cart-context';
import { calculateCartItemPrice } from '@/lib/utils/cart-pricing';

import type { createReservation } from './actions';
import type { CheckoutFormValues, DeliveryAddress } from './types';

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
  outboundMethod: LegMethod;
  outboundAddress: DeliveryAddress;
  returnMethod: LegMethod;
  returnAddress: DeliveryAddress;
  tulipInsuranceMode: 'required' | 'optional' | 'no_public';
  promoCode?: string;
}

function buildDeliveryLeg(
  method: LegMethod,
  address: DeliveryAddress,
): { method: LegMethod; address?: string; city?: string; postalCode?: string; country?: string; latitude?: number; longitude?: number } {
  if (method === 'store') {
    return { method: 'store' };
  }

  return {
    method: 'address',
    address: address.address,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    latitude: address.latitude ?? undefined,
    longitude: address.longitude ?? undefined,
  };
}

export function buildReservationPayload({
  storeId,
  locale,
  values,
  items,
  subtotalAmount,
  depositAmount,
  totalAmount,
  outboundMethod,
  outboundAddress,
  returnMethod,
  returnAddress,
  tulipInsuranceMode,
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
    delivery: {
      outbound: buildDeliveryLeg(outboundMethod, outboundAddress),
      return: buildDeliveryLeg(returnMethod, returnAddress),
    },
  };
}
