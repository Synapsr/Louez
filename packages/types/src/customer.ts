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

/**
 * The profile fields Louez ships with on every customer record. Their label
 * and type are fixed; they live in `customers` columns, not in custom values.
 */
export const CUSTOMER_PROFILE_FIELD_KEYS = [
  "birthDate",
  "acquisitionSource",
  "socialLinks",
] as const;

export type CustomerProfileFieldKey = (typeof CUSTOMER_PROFILE_FIELD_KEYS)[number];

/**
 * What the owner decides for one native profile field: the same settings as
 * a custom field, its label and type aside.
 */
export interface CustomerProfileFieldSettings {
  /** `hidden` keeps it off the record and out of the checkout. Social links are never `required`. */
  visibility: CustomerProfileFieldVisibility;
  /** "Demander au client". Always `never` while hidden; social links are never `required`. */
  collectMode: CustomerFieldCollectMode;
  targetMode: CustomerFieldTargetMode;
  /** Only read when `targetMode` is `products`; empty then means "applies to nothing". */
  targets: CustomerFieldTarget[];
  /** The customer sees and updates it from their storefront account; needs `collectMode` <> `never`. */
  customerEditable: boolean;
}

/**
 * `stores.settings.customerProfile` as stored. Early stores hold a bare
 * visibility string per field: read it through `resolveCustomerProfileSettings`
 * (`@louez/validations`), never directly.
 */
export type CustomerProfileSettings = Partial<
  Record<CustomerProfileFieldKey, CustomerProfileFieldSettings | CustomerProfileFieldVisibility>
>;

/** Every native profile field with its settings, defaults filled in. */
export type ResolvedCustomerProfileSettings = Record<
  CustomerProfileFieldKey,
  CustomerProfileFieldSettings
>;

/** The acquisition sources whose free-text detail ("Précisez") is kept; others drop it. */
export const CUSTOMER_ACQUISITION_SOURCES_WITH_DETAIL = [
  "other",
  "partner",
] as const satisfies readonly CustomerAcquisitionSource[];

// ============================================================================
// Customer form layout (one ordered list, no sections)
// ============================================================================

/** How much of a form row a field takes: the whole row, or half of it next to another. */
export const CUSTOMER_FIELD_WIDTHS = ["full", "half"] as const;

export type CustomerFieldWidth = (typeof CUSTOMER_FIELD_WIDTHS)[number];

/**
 * The Louez fields of the customer record, in their default order. The first
 * eight are locked (always on the record, only moved and resized); the
 * company ones only concern a business customer; the last three are the
 * editable profile fields (`CUSTOMER_PROFILE_FIELD_KEYS`). `address` is one
 * item for the address line, postal code, city and country.
 */
export const CUSTOMER_FORM_BUILT_IN_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "companyName",
  "companyNumber",
  "vatNumber",
  "birthDate",
  "acquisitionSource",
  "socialLinks",
] as const;

export type CustomerFormBuiltInKey = (typeof CUSTOMER_FORM_BUILT_IN_KEYS)[number];

/** Where one Louez field sits: its position shares one numeric space with the custom fields'. */
export interface CustomerFormLayoutEntry {
  position: number;
  width: CustomerFieldWidth;
}

/**
 * `stores.settings.customerFormLayout` as stored: the Louez fields' order and
 * width. A missing entry takes its default place; read it through
 * `resolveCustomerFormLayout` (`@louez/validations`), never directly.
 */
export type CustomerFormLayout = Partial<Record<CustomerFormBuiltInKey, CustomerFormLayoutEntry>>;

export interface CustomerFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomerFieldType;
  format: CustomerFieldFormat | null;
  options: string[] | null;
  unit: string | null;
  helpText: string | null;
  /**
   * @deprecated Sections are gone: nothing groups by it any more. Only the
   * settings page being rebuilt still reads it; new fields get a constant.
   */
  section: string;
  /** Order in the customer form layout, shared with the Louez fields of the scope. */
  position: number;
  width: CustomerFieldWidth;
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
