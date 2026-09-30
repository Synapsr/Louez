import type {
  CustomerFieldAppliesTo,
  CustomerFieldFormat,
  CustomerFieldScope,
  CustomerFieldTargetMode,
  CustomerFieldType,
} from "@louez/types";
import type { CustomerFieldCreateInput } from "@louez/validations";

export type CustomerFieldTemplateGroup = "country" | "activity" | "general";

export type CustomerFieldTemplateId =
  | "identityDocument"
  | "emergencyContact"
  | "businessContacts"
  | "brazil"
  | "spain"
  | "italy"
  | "portugal"
  | "vehicles"
  | "ski"
  | "bikes"
  | "boating";

interface CustomerFieldTemplateField {
  /**
   * Locale-independent key stored on the definition. Two templates sharing a
   * key (a rider's height serves skis and bikes alike) resolve to one field.
   */
  key: string;
  type: CustomerFieldType;
  format?: CustomerFieldFormat;
  /** Translation keys under `templates.<id>.fields.<key>.options`. */
  optionKeys?: readonly string[];
  /** Literal unit, locale-independent ("cm", "kg"). */
  unit?: string;
  appliesTo?: CustomerFieldAppliesTo;
  isSensitive?: boolean;
  isSearchable?: boolean;
  showOnContract?: boolean;
}

export interface CustomerFieldTemplate {
  id: CustomerFieldTemplateId;
  group: CustomerFieldTemplateGroup;
  /**
   * Where the values live, for every field of the template. `item` fields are
   * recorded per rented unit and only concern the products picked right after
   * adoption (`targetMode: "products"`, no target yet). Defaults to `customer`.
   */
  scope?: CustomerFieldScope;
  /** ISO 3166-1 alpha-2 of the store this template is suggested to. */
  country?: string;
  /** Onboarding product categories this template is suggested to. */
  productCategories?: readonly string[];
  fields: readonly CustomerFieldTemplateField[];
}

/**
 * Field packs offered in the editor. Labels and option names resolve through
 * `dashboard.settings.customerFields.templates.*` in the merchant's language
 * at adoption time, then belong to the store like any other field. Adopted
 * fields land at the end of their scope's layout, in the template's order,
 * with their type's default width.
 *
 * National identifiers whose collection is restricted by law for this purpose
 * (French social security number, Belgian national register number, Dutch
 * BSN) are deliberately absent.
 */
export const CUSTOMER_FIELD_TEMPLATES: readonly CustomerFieldTemplate[] = [
  {
    id: "identityDocument",
    group: "general",
    fields: [
      {
        key: "id_document_type",
        type: "select",
        optionKeys: ["idCard", "passport", "residencePermit", "drivingLicense", "other"],
      },
      {
        key: "id_document_number",
        type: "text",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
      { key: "id_document_expiry", type: "date" },
    ],
  },
  {
    id: "emergencyContact",
    group: "general",
    fields: [
      { key: "emergency_contact_name", type: "text" },
      { key: "emergency_contact_phone", type: "phone" },
      {
        key: "emergency_contact_relation",
        type: "select",
        optionKeys: ["partner", "parent", "friend", "colleague", "other"],
      },
    ],
  },
  {
    id: "businessContacts",
    group: "general",
    fields: [
      { key: "accounting_contact_name", type: "text", appliesTo: "business" },
      { key: "accounting_email", type: "email", appliesTo: "business" },
      { key: "purchase_order_reference", type: "text", appliesTo: "business" },
    ],
  },
  {
    id: "brazil",
    group: "country",
    country: "BR",
    fields: [
      {
        key: "br_cpf_cnpj",
        type: "text",
        format: "br_cpf_cnpj",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
      { key: "br_rg", type: "text", isSensitive: true },
      { key: "br_rg_issuer", type: "text" },
    ],
  },
  {
    id: "spain",
    group: "country",
    country: "ES",
    fields: [
      {
        key: "es_dni_nie",
        type: "text",
        format: "es_dni_nie",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
    ],
  },
  {
    id: "italy",
    group: "country",
    country: "IT",
    fields: [
      {
        key: "it_codice_fiscale",
        type: "text",
        format: "it_codice_fiscale",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
    ],
  },
  {
    id: "portugal",
    group: "country",
    country: "PT",
    fields: [
      {
        key: "pt_nif",
        type: "text",
        format: "pt_nif",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
    ],
  },
  {
    id: "vehicles",
    group: "activity",
    productCategories: ["vehicles"],
    fields: [
      {
        key: "driving_license_number",
        type: "text",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
      { key: "driving_license_date", type: "date", showOnContract: true },
      { key: "driving_license_categories", type: "text" },
    ],
  },
  {
    id: "ski",
    group: "activity",
    scope: "item",
    productCategories: ["sports_outdoor"],
    fields: [
      { key: "height_cm", type: "number", unit: "cm" },
      { key: "weight_kg", type: "number", unit: "kg" },
      { key: "shoe_size", type: "number" },
      {
        key: "ski_level",
        type: "select",
        optionKeys: ["beginner", "intermediate", "advanced", "expert"],
      },
    ],
  },
  {
    id: "bikes",
    group: "activity",
    scope: "item",
    productCategories: ["bikes"],
    fields: [
      { key: "height_cm", type: "number", unit: "cm" },
      { key: "bike_saddle_height", type: "number", unit: "cm" },
      { key: "bike_preferences", type: "textarea" },
    ],
  },
  {
    id: "boating",
    group: "activity",
    fields: [
      {
        key: "boat_license_number",
        type: "text",
        isSensitive: true,
        isSearchable: true,
        showOnContract: true,
      },
      {
        key: "boat_license_type",
        type: "select",
        optionKeys: ["coastal", "offshore", "inland", "none"],
      },
    ],
  },
];

export interface ResolvedCustomerFieldTemplate {
  id: CustomerFieldTemplateId;
  group: CustomerFieldTemplateGroup;
  /** `item`: after adoption, ask "Pour quels produits ?" for the fields it created. */
  scope: CustomerFieldScope;
  country: string | null;
  name: string;
  description: string;
  fields: CustomerFieldCreateInput[];
}

type TemplateTranslator = (key: string) => string;

/** A per-unit field only concerns the products the owner picks; a customer field concerns every reservation. */
const TARGET_MODE_BY_SCOPE = {
  customer: "all",
  item: "products",
} as const satisfies Record<CustomerFieldScope, CustomerFieldTargetMode>;

/** Templates with their labels in the merchant's language, ready to send to `adoptTemplate`. */
export const resolveCustomerFieldTemplates = (
  translate: TemplateTranslator,
): ResolvedCustomerFieldTemplate[] =>
  CUSTOMER_FIELD_TEMPLATES.map((template) => {
    const scope = template.scope ?? "customer";
    return {
      id: template.id,
      group: template.group,
      scope,
      country: template.country ?? null,
      name: translate(`${template.id}.name`),
      description: translate(`${template.id}.description`),
      fields: template.fields.map((field) => ({
        key: field.key,
        label: translate(`${template.id}.fields.${field.key}.label`),
        type: field.type,
        format: field.format ?? null,
        options:
          field.optionKeys?.map((option) =>
            translate(`${template.id}.fields.${field.key}.options.${option}`),
          ) ?? null,
        unit: field.unit ?? null,
        helpText: null,
        appliesTo: field.appliesTo ?? "all",
        isRequired: false,
        isSensitive: field.isSensitive ?? false,
        showOnContract: field.showOnContract ?? false,
        isSearchable: field.isSearchable ?? false,
        showInList: false,
        templateKey: template.id,
        scope,
        // Templates never ask the customer on their own: the owner opts in.
        collectMode: "never",
        targetMode: TARGET_MODE_BY_SCOPE[scope],
        targets: [],
        customerEditable: false,
      })),
    };
  });

/**
 * Templates worth putting forward for this store: its country's identifiers,
 * its activity's fields, and the identity document every rental shop asks for.
 * Templates already fully adopted are left out.
 */
export const suggestCustomerFieldTemplates = (params: {
  templates: readonly ResolvedCustomerFieldTemplate[];
  country: string | null | undefined;
  productCategory: string | null | undefined;
  adoptedKeys: ReadonlySet<string>;
}): ResolvedCustomerFieldTemplate[] => {
  const sources = new Map(CUSTOMER_FIELD_TEMPLATES.map((template) => [template.id, template]));
  return params.templates
    .filter((template) => {
      const source = sources.get(template.id);
      if (!source) return false;
      if (template.fields.every((field) => field.key && params.adoptedKeys.has(field.key))) {
        return false;
      }
      if (source.country) return source.country === params.country;
      if (source.productCategories) {
        return Boolean(
          params.productCategory && source.productCategories.includes(params.productCategory),
        );
      }
      return template.id === "identityDocument";
    })
    .slice(0, 3);
};
