import type {
  AddressDetails,
  AiAdvisorMode,
  BusinessHours,
  DeliverySettings,
  TaxSettings,
} from "@louez/types";
import type {
  CheckoutProfileField,
  CustomerExtraLayoutItem,
  CustomerFieldPublic,
  StorefrontPromoValidateOutput,
} from "@louez/validations";

import type {
  CustomerProfileFormValues,
  RentalUnitFormValues,
} from "@/components/storefront/customer-fields/customer-fields.types";

import type { getTulipQuotePreview } from "./actions";

export type { LegMethod } from "@louez/types";

export type ReservationMode = "payment" | "request";
export type TulipInsuranceMode = "required" | "optional" | "no_public";
/** `details` ("Détails de la location") only exists when a cart line asks item-scope fields. */
export type StepId = "contact" | "details" | "delivery" | "confirm";

/** Customer fields the page prefills from a verified session. */
export interface CheckoutInitialCustomer {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isBusinessCustomer: boolean;
  companyName: string;
  companyNumber: string;
  vatNumber: string;
  address: string;
  city: string;
  postalCode: string;
}

export interface CheckoutLocationOption {
  id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CheckoutTulipInsurance {
  enabled: boolean;
  mode: TulipInsuranceMode;
}

export interface CheckoutFormProps {
  storeSlug: string;
  storeId: string;
  pricingMode: "day" | "hour" | "week";
  reservationMode: ReservationMode;
  requireCustomerAddress: boolean;
  taxSettings?: TaxSettings;
  depositPercentage?: number;
  deliverySettings?: DeliverySettings;
  storeAddress?: string | null;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  storeName?: string;
  /** The store's public contacts, offered when the store is not taking bookings. */
  storeEmail?: string | null;
  storePhone?: string | null;
  /** ISO-2 country of the store — drives the company-identity fields (SIREN/BCE). */
  storeCountry: string;
  locations?: CheckoutLocationOption[];
  tulipInsurance?: CheckoutTulipInsurance;
  hasActivePromoCodes?: boolean;
  /**
   * Liens partenaires: the partner whose link brought the visitor (within the
   * store's window), for the perk its link gives; null without one.
   */
  linkPartner?: CheckoutLinkPartner | null;
  /** The store has partners: the customer may type a partner's code. */
  acceptsPartnerCode?: boolean;
  /** AI advisor checkout participation; null when the advisor is inactive. */
  advisorMode?: AiAdvisorMode | null;
  businessHours?: BusinessHours;
  advanceNoticeMinutes: number;
  minRentalMinutes: number;
  timezone?: string;
  /** Verified customer session read by the page; null for a guest. */
  initialCustomer: CheckoutInitialCustomer | null;
  /**
   * Custom field values the signed-in customer already has on file, for the
   * fields a checkout may ask. Empty for a guest: an e-mail alone never
   * reveals anyone's values.
   */
  initialCustomerFieldValues: Record<string, string>;
  /**
   * The signed-in customer's native values (birth date, source, links) for
   * the ones a checkout may ask. Blank for a guest, same rule as above.
   */
  initialCustomerProfileValues: CustomerProfileFormValues;
  /**
   * The storefront is in test mode (lib/test-reservations): the form starts with the
   * owner's name and e-mail, and the e-mail cannot be changed. Null otherwise.
   */
  testMode?: CheckoutTestMode | null;
  /**
   * A demo store (lib/demo): the addresses its address fields suggest, and
   * distances in a straight line, so the checkout calls no paid address or
   * routing service. Null for any other store.
   */
  demoAddresses?: AddressDetails[] | null;
}

/** The owner a test checkout books for. */
export interface CheckoutTestMode {
  email: string;
  firstName: string;
  lastName: string;
}

export interface CheckoutFormValues {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isBusinessCustomer: boolean;
  companyName: string;
  /** SIREN (FR) / BCE (BE) — optional: absent means the invoice stays B2C. */
  companyNumber: string;
  vatNumber: string;
  address: string;
  city: string;
  postalCode: string;
  notes: string;
  tulipInsuranceOptIn: boolean;
  acceptCgv: boolean;
  /** Native profile fields the store asks (birth date, source, links). */
  profileFields: CustomerProfileFormValues;
  /** Customer-scope custom fields the store asks, by definition id. */
  customerFields: Record<string, string>;
  /** "Détails de la location": one entry per rented unit, keyed by `toUnitKey(lineId, unitIndex)`. */
  itemDetails: Record<string, RentalUnitFormValues>;
}

/** A cart line as the custom fields see it: what to ask about each of its units. */
export interface CheckoutFieldsLine {
  lineId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
  /** Empty when the line asks nothing; in the owner's layout, each with its width. */
  itemFields: CustomerFieldPublic[];
}

/** What this cart asks the customer, lines in cart order (index = the payload's `lineIndex`). */
export interface CheckoutFieldsPlan {
  /** Native profile fields asked (birth date, source, links). */
  profileFields: CheckoutProfileField[];
  customerFields: CustomerFieldPublic[];
  /** The contact step's extra block: those native and custom fields, as the owner laid them out. */
  customerLayout: CustomerExtraLayoutItem[];
  lines: CheckoutFieldsLine[];
}

/** The custom fields differ by buyer type (`appliesTo`); both are known up front so a switch is instant. */
export interface CheckoutFieldsPlans {
  individual: CheckoutFieldsPlan;
  business: CheckoutFieldsPlan;
}

export interface DeliveryAddress {
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export type LineResolutionState =
  | { status: "loading" }
  | {
      status: "resolved";
      combinationKey: string;
      selectedAttributes: Record<string, string>;
    }
  | { status: "invalid" };

export type ValidatedPromo = Extract<StorefrontPromoValidateOutput, { ok: true }>["promo"];

export type TulipQuotePreview = Awaited<ReturnType<typeof getTulipQuotePreview>>;

export interface TulipQuoteCustomer {
  customerType: "business" | "individual";
  companyName?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  postalCode?: string;
}

export interface TulipQuotePreviewInput {
  storeId: string;
  customer: TulipQuoteCustomer;
  items: Array<{ productId: string; quantity: number }>;
  startDate: string;
  endDate: string;
  tulipInsuranceOptIn?: boolean;
}

/** Why the submit button is disabled; shown under it instead of a 50 % button. */
export type CheckoutBlockedReason =
  | "resolving"
  | "lineNeedsUpdate"
  | "advisorRequired"
  | "insuranceRequiredFailed"
  | "advanceNotice"
  | "quoteLoading";

export interface CheckoutSubmitError {
  /** Message key (`errors.*`) or a plain message. */
  message: string;
  params?: Record<string, string | number>;
  /** Step that holds the field to fix, when known. */
  step: StepId;
}

/** A partner the checkout knows (Liens partenaires): its name and its link's perk. */
export interface CheckoutLinkPartner {
  name: string;
  /** A promo code the store gives the partner's customers, applied for them; null for none. */
  perkCode: string | null;
}
