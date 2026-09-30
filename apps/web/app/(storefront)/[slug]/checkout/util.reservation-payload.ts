import type { LegMethod } from "@louez/types";
import type { CreateReservationInput } from "@louez/validations";

import type { CartItem } from "@/contexts/cart-context";
import type { Locale } from "@/i18n/config";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";

import type {
  CheckoutFieldsPlan,
  CheckoutFormValues,
  DeliveryAddress,
  TulipInsuranceMode,
} from "./checkout.types";
import { getCheckoutFieldsSubmission } from "./util.checkout-custom-fields";

interface BuildReservationPayloadInput {
  storeId: string;
  locale: Locale;
  values: CheckoutFormValues;
  items: CartItem[];
  /**
   * Client amounts. The server reprices every line from the database and
   * only logs these (the schema still requires them).
   */
  subtotalAmount: number;
  depositAmount: number;
  totalAmount: number;
  outboundMethod: LegMethod;
  outboundAddress: DeliveryAddress;
  pickupLocationId?: string | null;
  returnMethod: LegMethod;
  returnAddress: DeliveryAddress;
  returnLocationId?: string | null;
  tulipInsuranceMode: TulipInsuranceMode;
  promoCode?: string;
  advisorConversationId?: string;
  /** Pending reservation of an earlier attempt, reused or replaced server-side. */
  resumeReservationId?: string;
  /** Custom fields this cart asks (for the buyer's type); lines in the order of `items`. */
  checkoutFields?: CheckoutFieldsPlan;
}

type DeliveryLeg = CreateReservationInput["delivery"] extends { outbound: infer TLeg } | undefined
  ? TLeg
  : never;

const buildDeliveryLeg = (
  method: LegMethod,
  address: DeliveryAddress,
  locationId?: string | null,
): DeliveryLeg => {
  if (method === "store") {
    return { method: "store", locationId: locationId ?? null };
  }

  return {
    method: "address",
    address: address.address,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    latitude: address.latitude ?? undefined,
    longitude: address.longitude ?? undefined,
  };
};

const optionalTrimmed = (value: string): string | undefined => value.trim() || undefined;

/** The custom and native field keys of the payload, left out entirely when the cart asks nothing. */
const buildCheckoutFieldsPayload = (
  values: CheckoutFormValues,
  plan: CheckoutFieldsPlan | undefined,
): Pick<CreateReservationInput, "profileFields" | "customerFields" | "itemDetails"> => {
  if (!plan) return {};
  const submission = getCheckoutFieldsSubmission(values, plan);
  return {
    ...(plan.profileFields.length > 0 ? { profileFields: submission.profileFields } : {}),
    ...(plan.customerFields.length > 0 ? { customerFields: submission.customerFields } : {}),
    ...(submission.itemDetails.length > 0 ? { itemDetails: submission.itemDetails } : {}),
  };
};

export const buildReservationPayload = ({
  storeId,
  locale,
  values,
  items,
  subtotalAmount,
  depositAmount,
  totalAmount,
  outboundMethod,
  outboundAddress,
  pickupLocationId,
  returnMethod,
  returnAddress,
  returnLocationId,
  tulipInsuranceMode,
  promoCode,
  advisorConversationId,
  resumeReservationId,
  checkoutFields,
}: BuildReservationPayloadInput): CreateReservationInput => ({
  storeId,
  customer: {
    email: values.email,
    firstName: values.firstName,
    lastName: values.lastName,
    phone: normalizePhoneNumber(values.phone) ?? values.phone,
    customerType: values.isBusinessCustomer ? "business" : "individual",
    companyName: values.isBusinessCustomer ? values.companyName.trim() : undefined,
    companyNumber: values.isBusinessCustomer ? optionalTrimmed(values.companyNumber) : undefined,
    vatNumber: values.isBusinessCustomer ? optionalTrimmed(values.vatNumber) : undefined,
    address: values.address || undefined,
    city: values.city || undefined,
    postalCode: values.postalCode || undefined,
  },
  items: items.map((item) => {
    const priceResult = calculateCartItemPrice(item, null, null);

    return {
      lineId: item.lineId,
      productId: item.productId,
      selectedAttributes: item.selectedAttributes,
      resolvedCombinationKey: item.resolvedCombinationKey,
      resolvedAttributes: item.resolvedAttributes,
      quantity: item.quantity,
      startDate: item.startDate,
      endDate: item.endDate,
      unitPrice: priceResult.subtotal / Math.max(1, item.quantity),
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
    tulipInsuranceMode === "required"
      ? true
      : tulipInsuranceMode === "optional"
        ? values.tulipInsuranceOptIn
        : undefined,
  subtotalAmount,
  depositAmount,
  totalAmount,
  locale,
  promoCode,
  advisorConversationId,
  resumeReservationId,
  delivery: {
    outbound: buildDeliveryLeg(outboundMethod, outboundAddress, pickupLocationId),
    return: buildDeliveryLeg(returnMethod, returnAddress, returnLocationId),
  },
  ...buildCheckoutFieldsPayload(values, checkoutFields),
});
