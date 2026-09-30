import { STORE_SOCIAL_NETWORKS } from "./store";

// ============================================================================
// Customer profile (native fields)
// ============================================================================

/** How a customer heard about the store. Declared by the merchant, never inferred. */
export const CUSTOMER_ACQUISITION_SOURCES = [
  "word_of_mouth",
  "search_engine",
  "social_media",
  "walk_in",
  "partner",
  "ads",
  "returning",
  "other",
] as const;

export type CustomerAcquisitionSource = (typeof CUSTOMER_ACQUISITION_SOURCES)[number];

/** Where the customer record was created. Set by the code path, never typed by anyone. */
export const CUSTOMER_CREATED_VIA = [
  "dashboard",
  "storefront",
  "marketplace",
  "import",
  "api",
  "ai",
] as const;

export type CustomerCreatedVia = (typeof CUSTOMER_CREATED_VIA)[number];

export const CUSTOMER_SOCIAL_NETWORKS = [...STORE_SOCIAL_NETWORKS, "whatsapp"] as const;

export type CustomerSocialNetwork = (typeof CUSTOMER_SOCIAL_NETWORKS)[number];

/**
 * A customer's profiles. Networks hold a handle without the leading "@",
 * `website` a full URL and `whatsapp` a phone number in international format.
 */
export type CustomerSocialLinks = Partial<Record<CustomerSocialNetwork, string | null>>;

// ============================================================================
// Customer custom fields
// ============================================================================

export const CUSTOMER_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "phone",
  "email",
  "url",
] as const;

export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

/**
 * Known identifier formats. They drive validation and normalisation of a
 * `text` field; an unknown or absent format accepts any value.
 */
export const CUSTOMER_FIELD_FORMATS = [
  "br_cpf_cnpj",
  "es_dni_nie",
  "it_codice_fiscale",
  "pt_nif",
] as const;

export type CustomerFieldFormat = (typeof CUSTOMER_FIELD_FORMATS)[number];

export const CUSTOMER_FIELD_APPLIES_TO = ["all", "individual", "business"] as const;

export type CustomerFieldAppliesTo = (typeof CUSTOMER_FIELD_APPLIES_TO)[number];

/**
 * Where a value lives: `customer` on the customer record (one value per
 * customer), `item` on the reservation (one value per rented unit).
 */
export const CUSTOMER_FIELD_SCOPES = ["customer", "item"] as const;

export type CustomerFieldScope = (typeof CUSTOMER_FIELD_SCOPES)[number];

/** Whether the storefront checkout asks the field: `never` keeps it for the team. */
export const CUSTOMER_FIELD_COLLECT_MODES = ["never", "optional", "required"] as const;

export type CustomerFieldCollectMode = (typeof CUSTOMER_FIELD_COLLECT_MODES)[number];

/** `products` limits the field to the reservations holding one of its targets. */
export const CUSTOMER_FIELD_TARGET_MODES = ["all", "products"] as const;

export type CustomerFieldTargetMode = (typeof CUSTOMER_FIELD_TARGET_MODES)[number];

export const CUSTOMER_FIELD_TARGET_TYPES = ["category", "product"] as const;

export type CustomerFieldTargetType = (typeof CUSTOMER_FIELD_TARGET_TYPES)[number];

/** A category or a product a field is limited to. */
export interface CustomerFieldTarget {
  type: CustomerFieldTargetType;
  id: string;
}

/** Visibility of an optional native block on the customer form. */
export const CUSTOMER_PROFILE_FIELD_VISIBILITIES = ["hidden", "optional", "required"] as const;

export type CustomerProfileFieldVisibility = (typeof CUSTOMER_PROFILE_FIELD_VISIBILITIES)[number];

/** Per-store visibility of the native optional blocks (stores.settings.customerProfile). */
export interface CustomerProfileSettings {
  birthDate?: CustomerProfileFieldVisibility;
  acquisitionSource?: CustomerProfileFieldVisibility;
  socialLinks?: Exclude<CustomerProfileFieldVisibility, "required">;
}

export interface CustomerFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomerFieldType;
  format: CustomerFieldFormat | null;
  options: string[] | null;
  unit: string | null;
  helpText: string | null;
  section: string;
  position: number;
  appliesTo: CustomerFieldAppliesTo;
  isRequired: boolean;
  isSensitive: boolean;
  showOnContract: boolean;
  isSearchable: boolean;
  showInList: boolean;
  templateKey: string | null;
  isActive: boolean;
  scope: CustomerFieldScope;
  collectMode: CustomerFieldCollectMode;
  targetMode: CustomerFieldTargetMode;
  /** The customer sees and updates it from their storefront account. */
  customerEditable: boolean;
  /** Only read when `targetMode` is `products`; empty then means "applies to nothing". */
  targets: CustomerFieldTarget[];
}

/** A customer's values keyed by definition id. Checkboxes are "true" / "false", dates ISO `yyyy-MM-dd`. */
export type CustomerFieldValues = Record<string, string>;

/** What was recorded for one rented unit of a reservation item (item-scope fields). */
export interface ReservationItemDetail {
  /** 0-based, below the item quantity. */
  unitIndex: number;
  /** "Pour qui ?" */
  participantName: string | null;
  values: CustomerFieldValues;
}
