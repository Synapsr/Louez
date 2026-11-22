/**
 * What a demo trade (« métier ») is made of: the store a visitor opens from
 * /demo/<trade>, its catalog, the shape of its bookings, and the guide shown to
 * the visitor. lib/demo/seed-demo-store.ts turns one into a store.
 *
 * Every person, address, phone number and e-mail in a trade is invented:
 * e-mails end in the reserved `.example` domain (RFC 2606) and phone numbers
 * are in the ranges ARCEP keeps for fiction.
 */

export const DEMO_VERTICAL_KEYS = ["ski", "velo", "evenementiel"] as const;
export type DemoVerticalKey = (typeof DEMO_VERTICAL_KEYS)[number];

export const isDemoVerticalKey = (value: unknown): value is DemoVerticalKey =>
  typeof value === "string" && (DEMO_VERTICAL_KEYS as readonly string[]).includes(value);

/** A pricing tier: `price` for `period` minutes (1440 = a day, 10080 = a week). */
export interface DemoRate {
  period: number;
  price: number;
}

/** A price period, as MM-DD bounds resolved on the seeded years. */
export interface DemoSeason {
  name: string;
  startMonthDay: string;
  endMonthDay: string;
  /** Applied to the base price and every tier. */
  multiplier: number;
}

export interface DemoAxis {
  key: string;
  label: string;
  position: number;
}

export interface DemoUnitGroup {
  attributes?: Record<string, string>;
  count: number;
}

export interface DemoProductSpec {
  /** Stable key: bookings and accessories refer to the product by it. */
  key: string;
  name: string;
  category: string;
  description: string;
  aiContext?: string;
  images: string[];
  price: number;
  basePeriodMinutes: number;
  pricingMode: "hour" | "day" | "week";
  /** `fixed`: one price whatever the length (a season rental). Duration-priced by default. */
  pricingKind?: "duration" | "fixed";
  deposit: number;
  rates: DemoRate[];
  enforceStrictTiers: boolean;
  /** Stock of a product whose units are not tracked one by one. */
  quantity: number;
  trackUnits: boolean;
  axes?: DemoAxis[];
  units?: DemoUnitGroup[];
  unitPrefix?: string;
  /** Booking weight: 1 rare, 10 best seller. */
  popularity: number;
  seasons?: DemoSeason[];
  /** Offered as an add-on of other products. */
  isAccessory?: boolean;
  /** Keys of the accessories the storefront suggests with this product. */
  accessories?: string[];
  unitPurchasePrice?: number;
}

export interface DemoVariantDefinition {
  key: string;
  label: string;
  kind: "size" | "color" | "custom";
  values: string[];
}

/** One line of a booking basket: a product key and how many. */
export interface DemoBasketLine {
  key: string;
  quantity: number;
}

export interface DemoPromoCode {
  code: string;
  description: string;
  type: "percentage" | "fixed";
  value: number;
  minimumAmount: number | null;
  currentUsageCount: number;
}

export interface DemoInspectionField {
  name: string;
  fieldType: "checkbox" | "rating" | "text" | "number" | "select";
  options?: string[];
  numberUnit?: string;
  isRequired: boolean;
  sectionName?: string;
}

/** A guided step on the dashboard: what to try, and where it leads. */
export interface DemoGuideStep {
  key: "book" | "see_booking" | "check_in" | "deposit" | "catalog";
  title: string;
  description: string;
}

export interface DemoVertical {
  key: DemoVerticalKey;
  /** The trade, as the demo names it: « Location de ski ». */
  label: string;
  store: {
    name: string;
    /** The store slug is this plus a random suffix: each visitor has their own store. */
    slugBase: string;
    tagline: string;
    description: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    postalCode: string;
    latitude: string;
    longitude: string;
    primaryColor: string;
    heroImages: string[];
    vatNumber: string;
    ownerName: string;
  };
  settings: {
    minRentalMinutes: number;
    advanceNoticeMinutes: number;
    turnoverBufferMinutes: number;
    /** Share of the total paid online at checkout. */
    onlinePaymentDepositPercentage: number;
    /** Opening ranges per weekday, Sunday first. */
    openingHours: Array<Array<{ openTime: string; closeTime: string }> | null>;
  };
  categories: Array<{ name: string; description: string }>;
  variantDefinitions: DemoVariantDefinition[];
  products: DemoProductSpec[];
  /** Relative booking demand per month, January first. */
  monthWeights: number[];
  /** Rental lengths, in days, and how often each occurs. */
  durations: Array<{ days: number; weight: number }>;
  /** Baskets a customer books, with their weights. */
  baskets: Array<{ weight: number; lines: DemoBasketLine[] }>;
  /** Where its customers live; French cities when omitted. */
  towns?: Array<{ city: string; postalCode: string }>;
  customerNotes: string[];
  internalNotes: string[];
  promoCodes: DemoPromoCode[];
  inspectionFields: DemoInspectionField[];
  /** The product the guide asks the visitor to book on the storefront. */
  featuredProductKey: string;
  guide: DemoGuideStep[];
  cgv: string;
}
