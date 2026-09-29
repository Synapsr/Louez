import type { ComponentProps } from "react";
import type { AddressDetails, DeliverySettings, TaxSettings } from "@louez/types";
import type { CheckoutConfirmStep } from "@/app/(storefront)/[slug]/checkout/components/checkout-confirm-step";
import type { CheckoutOrderSummary } from "@/app/(storefront)/[slug]/checkout/components/checkout-order-summary";
import type { CheckoutFormValues } from "@/app/(storefront)/[slug]/checkout/checkout.types";
import { CHECKOUT_DEFAULT_VALUES } from "@/app/(storefront)/[slug]/checkout/validator.checkout";
import { calculateCheckoutTotals } from "@/app/(storefront)/[slug]/checkout/util.checkout-totals";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { AddressInputSource } from "@/components/ui/address-input";
import type { Locale } from "@/i18n/config";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import { calculateHaversineDistance } from "@/lib/utils/geo";
import { getDemoCart } from "@/lib/landing-demos/cart";
import { createDemoPortalDetail, type DemoPortalReservation } from "@/lib/landing-demos/portal";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";

export const CHECKOUT_DEMO_STORE = {
  name: "Maison du Vélo",
  address: "12 rue des Cyclistes, 44000 Nantes",
  latitude: 47.2125,
  longitude: -1.5592,
};

export const CHECKOUT_DEMO_DELIVERY = {
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 10,
  maximumDistance: 30,
  freeDeliveryThreshold: null,
} satisfies DeliverySettings;

export const CHECKOUT_DEMO_TAX = {
  enabled: true,
  defaultRate: 20,
  displayMode: "inclusive",
} satisfies TaxSettings;

export const CHECKOUT_DEMO_ADDRESSES: AddressDetails[] = [
  {
    placeId: "demo-checkout-carquefou",
    formattedAddress: "24 rue du Moulin, 44470 Carquefou",
    latitude: 47.2969,
    longitude: -1.4901,
    streetNumber: "24",
    street: "rue du Moulin",
    city: "Carquefou",
    postalCode: "44470",
    country: "France",
    countryCode: "FR",
  },
  {
    placeId: "demo-checkout-nantes",
    formattedAddress: "8 rue de Strasbourg, 44000 Nantes",
    latitude: 47.2166,
    longitude: -1.5505,
    streetNumber: "8",
    street: "rue de Strasbourg",
    city: "Nantes",
    postalCode: "44000",
    country: "France",
    countryCode: "FR",
  },
  {
    placeId: "demo-checkout-reze",
    formattedAddress: "15 rue Jean Jaurès, 44400 Rezé",
    latitude: 47.1849,
    longitude: -1.5484,
    streetNumber: "15",
    street: "rue Jean Jaurès",
    city: "Rezé",
    postalCode: "44400",
    country: "France",
    countryCode: "FR",
  },
];

const normalizeAddress = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export const CHECKOUT_DEMO_ADDRESS_SOURCE: AddressInputSource = {
  search: (query) => {
    const normalized = normalizeAddress(query);
    if (normalized.length < 3) return [];
    return CHECKOUT_DEMO_ADDRESSES.filter((address) =>
      normalizeAddress(address.formattedAddress).includes(normalized),
    ).map((address) => ({
      placeId: address.placeId,
      description: address.formattedAddress,
      mainText: `${address.streetNumber} ${address.street}`,
      secondaryText: `${address.postalCode} ${address.city}`,
    }));
  },
  resolve: (query) =>
    CHECKOUT_DEMO_ADDRESSES.find(
      (address) =>
        address.placeId === query ||
        normalizeAddress(address.formattedAddress) === normalizeAddress(query),
    ) ?? null,
};

export const resolveDemoCheckoutDistance = ({
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
}: {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
}): number =>
  calculateHaversineDistance(
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
  );

type ConfirmProps = ComponentProps<typeof CheckoutConfirmStep>;

export const CHECKOUT_DEMO_QUOTE = {
  mode: "no_public",
  preview: {
    mode: "no_public",
    connected: false,
    inclusionEnabled: false,
    quoteUnavailable: false,
    quoteError: null,
    requestedOptIn: false,
    appliedOptIn: false,
    amount: 0,
    insuredProductCount: 0,
    uninsuredProductCount: 0,
    insuredProductIds: [],
    error: null,
  },
  isLoading: false,
  isFetched: false,
  quotedAmount: 0,
  appliedAmount: 0,
  isRequiredAndFailed: false,
} satisfies ConfirmProps["tulipQuote"];

export const CHECKOUT_DEMO_ADVISOR = {
  isActive: false,
  isRequired: false,
  isValidated: false,
  serverValidated: false,
  validationStale: false,
  isStatusLoading: false,
  conversationId: null,
  openAdvisor: () => {},
} satisfies ConfirmProps["advisorGate"];

export const CHECKOUT_DEMO_PROMO = {
  promo: null,
  discountAmount: 0,
  isValidating: false,
  validationError: null,
  validate: () => {},
  remove: () => {},
  clearError: () => {},
} satisfies ConfirmProps["promo"];

export const getDemoCheckout = (period: RentalPeriodValue, locale: Locale) => {
  const cart = getDemoCart({ "demo-city-bike": 1, "demo-electric-bike": 1 }, period, locale);
  const customer = getDemoCustomer(0);
  const values: CheckoutFormValues = {
    ...CHECKOUT_DEFAULT_VALUES,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: "+33612345678",
    address: "8 rue de Strasbourg",
    city: "Nantes",
    postalCode: "44000",
  };
  const reservation: DemoPortalReservation = {
    id: "demo-checkout-reservation",
    number: "1048",
    status: "confirmed",
    start: period.start,
    end: period.end,
    created: getDemoToday(period),
    paid: true,
    contractValidated: true,
    customer,
    subtotal: cart.summary.subtotal,
    total: cart.summary.total,
    deposit: cart.summary.deposit,
    items: cart.items.map((item) => {
      const price = calculateCartItemPrice(item, cart.period.startDate, cart.period.endDate);
      return {
        id: item.lineId,
        name: item.productName,
        imageUrl: item.productImage,
        quantity: item.quantity,
        unitPrice: price.subtotal / item.quantity,
        totalPrice: price.subtotal,
        insured: false,
      };
    }),
  };
  const detail = createDemoPortalDetail(reservation, locale);
  const place = {
    kind: "store",
    name: CHECKOUT_DEMO_STORE.name,
    address: CHECKOUT_DEMO_STORE.address,
  } satisfies typeof detail.fulfillment.fulfillment.pickup;
  return {
    cart,
    values,
    paidReservation: {
      ...detail,
      outcome: { event: "paid", paymentStatus: "paid" },
      fulfillment: {
        ...detail.fulfillment,
        fulfillment: { pickup: place, dropoff: place, isSamePlace: true },
      },
      contact: { ...detail.contact, address: CHECKOUT_DEMO_STORE.address },
    } satisfies typeof detail,
  };
};

export const getDemoCheckoutSummary = (
  cart: ReturnType<typeof getDemoCart>,
  deliveryFee = 0,
  hasDeliveryLegs = false,
  deliveryFeeReady = true,
): ComponentProps<typeof CheckoutOrderSummary> => ({
  items: cart.items,
  reservationMode: "payment",
  taxSettings: CHECKOUT_DEMO_TAX,
  globalStartDate: cart.period.startDate,
  globalEndDate: cart.period.endDate,
  subtotal: cart.summary.subtotal,
  originalSubtotal: cart.summary.originalSubtotal,
  totalSavings: cart.summary.totalSavings,
  totalDeposit: cart.summary.deposit,
  totals: calculateCheckoutTotals({
    subtotal: cart.summary.subtotal,
    discountAmount: 0,
    deliveryFee,
    insuranceAmount: 0,
    depositPercentage: 100,
    reservationMode: "payment",
  }),
  hasDeliveryLegs,
  deliveryFee,
  deliveryFeeReady,
  tulipQuote: CHECKOUT_DEMO_QUOTE,
  tulipInsuranceOptIn: false,
  lineResolutions: {},
  promo: null,
  discountAmount: 0,
  onEditDates: () => {},
});
