import {
  CUSTOMER_ACQUISITION_SOURCES,
  CUSTOMER_ACQUISITION_SOURCES_WITH_DETAIL,
  CUSTOMER_PROFILE_FIELD_KEYS,
  CUSTOMER_PROFILE_FIELD_VISIBILITIES,
  CUSTOMER_SOCIAL_NETWORKS,
  type CustomerAcquisitionSource,
  type CustomerFieldCollectMode,
  type CustomerFieldTarget,
  type CustomerProfileFieldKey,
  type CustomerProfileFieldSettings,
  type CustomerSocialLinks,
  type CustomerSocialNetwork,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";
import { normalizeCustomerSocialLink } from "@louez/utils";
import { z } from "zod";

import { isPlausibleBirthDate } from "./customer";
import {
  CUSTOMER_FIELD_ISSUE_CODES,
  CUSTOMER_FIELD_LIMITS,
  customerFieldCollectModeSchema,
  customerFieldTargetModeSchema,
  customerFieldTargetSchema,
  customerFieldTargetsInputSchema,
  customerProfileFieldKeySchema,
  mergeCustomerFieldOnlineSettings,
  type CustomerFieldIssueCode,
} from "./customer-fields";
import {
  fieldAppliesToProduct,
  type CheckoutFieldIssue,
  type CustomerFieldProduct,
} from "./customer-fields-online";

// ----------------------------------------------------------------------------
// Settings: what the owner decides for each native field
// ----------------------------------------------------------------------------

const customerProfileFieldVisibilitySchema = z.enum(CUSTOMER_PROFILE_FIELD_VISIBILITIES);

export const customerProfileFieldSettingsSchema = z.object({
  visibility: customerProfileFieldVisibilitySchema,
  collectMode: customerFieldCollectModeSchema,
  targetMode: customerFieldTargetModeSchema,
  targets: z.array(customerFieldTargetSchema),
  customerEditable: z.boolean(),
});

/** Every native field with its settings (`dashboard.customerFields.profileSettings`). */
export const resolvedCustomerProfileSettingsSchema = z.object({
  birthDate: customerProfileFieldSettingsSchema,
  acquisitionSource: customerProfileFieldSettingsSchema,
  socialLinks: customerProfileFieldSettingsSchema,
});

export const DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS: CustomerProfileFieldSettings = {
  visibility: "optional",
  collectMode: "never",
  targetMode: "all",
  targets: [],
  customerEditable: false,
};

/**
 * The rules every native field obeys whatever was stored: a hidden field is
 * never asked, social links are never required (neither by the team nor
 * online), and only a field the checkout asks can be edited by the customer.
 */
const settleProfileFieldSettings = (
  key: CustomerProfileFieldKey,
  settings: CustomerProfileFieldSettings,
): CustomerProfileFieldSettings => {
  const neverRequired = key === "socialLinks";
  const visibility =
    neverRequired && settings.visibility === "required" ? "optional" : settings.visibility;
  const collectMode =
    visibility === "hidden"
      ? "never"
      : neverRequired && settings.collectMode === "required"
        ? "optional"
        : settings.collectMode;
  return {
    visibility,
    collectMode,
    targetMode: settings.targetMode,
    targets: settings.targets,
    customerEditable: collectMode !== "never" && settings.customerEditable,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Valid targets of a stored list; a broken entry is dropped, not the whole list. */
const readStoredTargets = (raw: unknown): CustomerFieldTarget[] =>
  Array.isArray(raw)
    ? raw
        .flatMap((entry) => {
          const parsed = customerFieldTargetSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, CUSTOMER_FIELD_LIMITS.targets)
    : [];

/**
 * One stored field, leniently: the early bare visibility string, an object,
 * or nothing. Each unreadable property falls back to its default.
 */
const resolveProfileFieldSettings = (
  key: CustomerProfileFieldKey,
  stored: unknown,
): CustomerProfileFieldSettings => {
  const legacy = customerProfileFieldVisibilitySchema.safeParse(stored);
  if (legacy.success) {
    return settleProfileFieldSettings(key, {
      ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS,
      visibility: legacy.data,
    });
  }
  if (!isRecord(stored)) return DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS;

  const read = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  const defaults = DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS;
  return settleProfileFieldSettings(key, {
    visibility: read(customerProfileFieldVisibilitySchema, stored.visibility, defaults.visibility),
    collectMode: read(customerFieldCollectModeSchema, stored.collectMode, defaults.collectMode),
    targetMode: read(customerFieldTargetModeSchema, stored.targetMode, defaults.targetMode),
    targets: readStoredTargets(stored.targets),
    customerEditable: read(z.boolean(), stored.customerEditable, defaults.customerEditable),
  });
};

/**
 * `stores.settings.customerProfile` as every reader must see it. Accepts
 * whatever is stored (legacy strings, objects, nothing) and fills defaults:
 * shown as optional, never asked online, for all bookings, not editable.
 */
export const resolveCustomerProfileSettings = (
  stored: unknown,
): ResolvedCustomerProfileSettings => {
  const record = isRecord(stored) ? stored : {};
  return {
    birthDate: resolveProfileFieldSettings("birthDate", record.birthDate),
    acquisitionSource: resolveProfileFieldSettings("acquisitionSource", record.acquisitionSource),
    socialLinks: resolveProfileFieldSettings("socialLinks", record.socialLinks),
  };
};

/**
 * `dashboard.customerFields.updateProfileField`: only the keys sent change;
 * `targets` replaces the list when present. Same rules as a custom field, plus
 * the native ones: social links are never required, a hidden field is never
 * asked online.
 */
export const customerProfileFieldUpdateInputSchema = z
  .object({
    field: customerProfileFieldKeySchema,
    visibility: customerProfileFieldVisibilitySchema.optional(),
    collectMode: customerFieldCollectModeSchema.optional(),
    targetMode: customerFieldTargetModeSchema.optional(),
    targets: customerFieldTargetsInputSchema.optional(),
    customerEditable: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const refuse = (path: string) =>
      ctx.addIssue({ code: "custom", message: "errors.invalidData", path: [path] });
    if (input.field === "socialLinks" && input.visibility === "required") refuse("visibility");
    if (input.field === "socialLinks" && input.collectMode === "required") refuse("collectMode");
    if (input.visibility === "hidden" && input.collectMode && input.collectMode !== "never") {
      refuse("collectMode");
    }
    if (input.customerEditable && input.collectMode === "never") refuse("customerEditable");
  });

export type CustomerProfileFieldUpdateInput = z.infer<typeof customerProfileFieldUpdateInputSchema>;

/**
 * The settings a native field ends up with once a patch applies, or null when
 * the patch is incoherent with what is kept (asking online a field that stays
 * hidden, letting the customer edit a field never asked). Hiding a field also
 * stops asking it; `never` takes the customer's edit right with it.
 */
export function mergeCustomerProfileFieldSettings(
  key: CustomerProfileFieldKey,
  current: CustomerProfileFieldSettings,
  patch: Omit<CustomerProfileFieldUpdateInput, "field">,
): CustomerProfileFieldSettings | null {
  const visibility = patch.visibility ?? current.visibility;
  if (visibility === "hidden" && patch.collectMode && patch.collectMode !== "never") return null;
  const online = mergeCustomerFieldOnlineSettings(current, {
    collectMode: visibility === "hidden" ? "never" : patch.collectMode,
    customerEditable: patch.customerEditable,
  });
  if (!online) return null;
  return settleProfileFieldSettings(key, {
    visibility,
    ...online,
    targetMode: patch.targetMode ?? current.targetMode,
    targets: patch.targets ?? current.targets,
  });
}

// ----------------------------------------------------------------------------
// Online: which native fields the checkout asks
// ----------------------------------------------------------------------------

/** A native field the checkout asks: which one, and whether it is required. */
export const checkoutProfileFieldSchema = z.object({
  key: customerProfileFieldKeySchema,
  collectMode: customerFieldCollectModeSchema,
});

export type CheckoutProfileField = z.infer<typeof checkoutProfileFieldSchema>;

/** A native field of the customer's own account: whether they may edit it from there. */
export const accountProfileFieldSchema = checkoutProfileFieldSchema.extend({
  customerEditable: z.boolean(),
});

export type AccountProfileField = z.infer<typeof accountProfileFieldSchema>;

/** Same targeting as a custom field; a hidden native field concerns nothing. */
export const profileFieldAppliesToProduct = (
  settings: Pick<CustomerProfileFieldSettings, "visibility" | "targetMode" | "targets">,
  product: CustomerFieldProduct,
): boolean =>
  fieldAppliesToProduct(
    {
      isActive: settings.visibility !== "hidden",
      targetMode: settings.targetMode,
      targets: settings.targets,
    },
    product,
  );

const isAsked = (settings: CustomerProfileFieldSettings) =>
  settings.visibility !== "hidden" && settings.collectMode !== "never";

/**
 * The native fields the checkout asks for this cart, in the record's order
 * (birth date, source, links): asked, and concerning at least one product.
 * They apply to both buyer types.
 */
export const resolveCheckoutProfileFields = (
  settings: ResolvedCustomerProfileSettings,
  products: readonly CustomerFieldProduct[],
): CheckoutProfileField[] =>
  CUSTOMER_PROFILE_FIELD_KEYS.flatMap((key) => {
    const field = settings[key];
    return isAsked(field) &&
      products.some((product) => profileFieldAppliesToProduct(field, product))
      ? [{ key, collectMode: field.collectMode }]
      : [];
  });

/**
 * Every native field a checkout may ask, whatever the cart: what a signed-in
 * customer's values are read for (prefill, account profile).
 */
export const listAskedProfileFields = (
  settings: ResolvedCustomerProfileSettings,
): AccountProfileField[] =>
  CUSTOMER_PROFILE_FIELD_KEYS.flatMap((key) => {
    const field = settings[key];
    return isAsked(field)
      ? [{ key, collectMode: field.collectMode, customerEditable: field.customerEditable }]
      : [];
  });

// ----------------------------------------------------------------------------
// Values
// ----------------------------------------------------------------------------

const socialLinksInputSchema = z.partialRecord(
  z.enum(CUSTOMER_SOCIAL_NETWORKS),
  z.string().max(255),
);

/**
 * Native values as the checkout and the account profile send them. A blank
 * asks to clear; the detail only counts next to a source that takes one.
 */
export const customerProfileValuesInputSchema = z.object({
  birthDate: z.string().trim().max(32).optional(),
  acquisitionSource: z.string().trim().max(32).optional(),
  acquisitionSourceDetail: z.string().trim().max(255).optional(),
  socialLinks: socialLinksInputSchema.optional(),
});

export type CustomerProfileValuesInput = z.infer<typeof customerProfileValuesInputSchema>;

/** The native values on a customer record (the `customers` columns). */
export const customerProfileValuesSchema = z.object({
  birthDate: z.string().nullable(),
  acquisitionSource: z.enum(CUSTOMER_ACQUISITION_SOURCES).nullable(),
  acquisitionSourceDetail: z.string().nullable(),
  socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().nullable()).nullable(),
});

export type CustomerProfileValues = z.infer<typeof customerProfileValuesSchema>;

/** Normalised columns to write; a key left out is not touched, null clears. */
export interface CustomerProfileValuesPatch {
  birthDate?: string | null;
  /** Always written with `acquisitionSourceDetail`: the detail follows its source. */
  acquisitionSource?: CustomerAcquisitionSource | null;
  acquisitionSourceDetail?: string | null;
  socialLinks?: CustomerSocialLinks | null;
}

/**
 * Only the values of the listed native fields (asked, or editable); the
 * others read as empty. A customer's own values never tell more than the
 * store asks.
 */
export const pickCustomerProfileValues = (
  values: CustomerProfileValues,
  fields: readonly Pick<CheckoutProfileField, "key">[],
): CustomerProfileValues => {
  const keys = new Set(fields.map((field) => field.key));
  return {
    birthDate: keys.has("birthDate") ? values.birthDate : null,
    acquisitionSource: keys.has("acquisitionSource") ? values.acquisitionSource : null,
    acquisitionSourceDetail: keys.has("acquisitionSource") ? values.acquisitionSourceDetail : null,
    socialLinks: keys.has("socialLinks") ? values.socialLinks : null,
  };
};

export const customerProfileFieldIssueSchema = z.object({
  field: customerProfileFieldKeySchema,
  code: z.enum(CUSTOMER_FIELD_ISSUE_CODES),
});

export type CustomerProfileFieldIssue = z.infer<typeof customerProfileFieldIssueSchema>;

const isAcquisitionSource = (value: string): value is CustomerAcquisitionSource =>
  CUSTOMER_ACQUISITION_SOURCES.some((source) => source === value);

/** "Autre" and "Partenaire" take a free-text detail ("Précisez"). */
export const acquisitionSourceTakesDetail = (source: string | null | undefined): boolean =>
  CUSTOMER_ACQUISITION_SOURCES_WITH_DETAIL.some((candidate) => candidate === source);

/** What a refused link reads as: a website is a URL, WhatsApp a phone number. */
const socialLinkIssueCode = (network: CustomerSocialNetwork): CustomerFieldIssueCode =>
  network === "whatsapp" ? "invalidPhone" : "invalidUrl";

/** One submitted native value as it would be written, or why it cannot be. */
const normalizeProfileValue = (
  key: CustomerProfileFieldKey,
  input: CustomerProfileValuesInput,
): { patch: CustomerProfileValuesPatch; empty: boolean } | { code: CustomerFieldIssueCode } => {
  switch (key) {
    case "birthDate": {
      const raw = input.birthDate?.trim() ?? "";
      if (raw === "") return { patch: { birthDate: null }, empty: true };
      return isPlausibleBirthDate(raw)
        ? { patch: { birthDate: raw }, empty: false }
        : { code: "invalidDate" };
    }
    case "acquisitionSource": {
      const raw = input.acquisitionSource?.trim() ?? "";
      if (raw === "") {
        return { patch: { acquisitionSource: null, acquisitionSourceDetail: null }, empty: true };
      }
      if (!isAcquisitionSource(raw)) return { code: "invalidOption" };
      // A detail typed before switching to another source is left behind.
      const detail = acquisitionSourceTakesDetail(raw)
        ? input.acquisitionSourceDetail?.trim() || null
        : null;
      return { patch: { acquisitionSource: raw, acquisitionSourceDetail: detail }, empty: false };
    }
    case "socialLinks": {
      const entries: [CustomerSocialNetwork, string][] = [];
      for (const network of CUSTOMER_SOCIAL_NETWORKS) {
        const typed = input.socialLinks?.[network]?.trim();
        if (!typed) continue;
        const stored = normalizeCustomerSocialLink(network, typed);
        if (!stored) return { code: socialLinkIssueCode(network) };
        entries.push([network, stored]);
      }
      return entries.length > 0
        ? { patch: { socialLinks: Object.fromEntries(entries) }, empty: false }
        : { patch: { socialLinks: null }, empty: true };
    }
  }
};

/** Stored links worth counting: at least one non-blank entry. */
const hasSocialLinks = (links: CustomerSocialLinks | null | undefined): boolean =>
  CUSTOMER_SOCIAL_NETWORKS.some((network) => Boolean(links?.[network]?.trim()));

const hasProfileValueOnFile = (
  key: CustomerProfileFieldKey,
  onFile:
    | Pick<CustomerProfileValues, "birthDate" | "acquisitionSource" | "socialLinks">
    | null
    | undefined,
): boolean =>
  key === "socialLinks" ? hasSocialLinks(onFile?.socialLinks) : Boolean(onFile?.[key]);

/**
 * Checks native values against the fields asked (or editable). Values of
 * fields not listed are dropped. A blank clears; on a required field it is
 * refused. Without `partial` (the checkout), a required field left out is
 * satisfied by a value on file and refused otherwise; with `partial` (the
 * account), a field left out is simply not touched.
 */
export function validateCustomerProfileValues(params: {
  fields: readonly { key: CustomerProfileFieldKey; collectMode: CustomerFieldCollectMode }[];
  values: CustomerProfileValuesInput | null | undefined;
  onFile?: Pick<CustomerProfileValues, "birthDate" | "acquisitionSource" | "socialLinks"> | null;
  partial?: boolean;
}): { values: CustomerProfileValuesPatch; issues: CustomerProfileFieldIssue[] } {
  const input = params.values ?? {};
  let values: CustomerProfileValuesPatch = {};
  const issues: CustomerProfileFieldIssue[] = [];

  for (const { key, collectMode } of params.fields) {
    if (input[key] === undefined) {
      if (
        !params.partial &&
        collectMode === "required" &&
        !hasProfileValueOnFile(key, params.onFile)
      ) {
        issues.push({ field: key, code: "required" });
      }
      continue;
    }

    const result = normalizeProfileValue(key, input);
    if ("code" in result) {
      issues.push({ field: key, code: result.code });
    } else if (result.empty && collectMode === "required") {
      issues.push({ field: key, code: "required" });
    } else {
      values = { ...values, ...result.patch };
    }
  }

  return { values, issues };
}

/** A native issue where the checkout reports every issue: first in the list, as on screen. */
export const toCheckoutProfileIssue = (issue: CustomerProfileFieldIssue): CheckoutFieldIssue => ({
  target: "profile",
  field: issue.field,
  code: issue.code,
});

/**
 * What a save writes onto the `customers` columns, decided before any SQL.
 *
 * - `overwrite` (a signed-in customer): every value sent replaces what is on
 *   file, null clears it.
 * - `fillEmpty` (anyone else typing this e-mail): only what the customer does
 *   not hold yet is written; nothing is cleared or replaced. Links are merged
 *   network by network, the ones on file kept.
 */
export function planCustomerProfileValuesSave(params: {
  current: CustomerProfileValues;
  values: CustomerProfileValuesPatch;
  mode: "overwrite" | "fillEmpty";
}): CustomerProfileValuesPatch {
  const { current, values } = params;
  if (params.mode === "overwrite") {
    return {
      ...(values.birthDate !== undefined ? { birthDate: values.birthDate } : {}),
      ...(values.acquisitionSource !== undefined
        ? {
            acquisitionSource: values.acquisitionSource,
            acquisitionSourceDetail: values.acquisitionSource
              ? (values.acquisitionSourceDetail ?? null)
              : null,
          }
        : {}),
      ...(values.socialLinks !== undefined ? { socialLinks: values.socialLinks } : {}),
    };
  }

  const addedLinks = CUSTOMER_SOCIAL_NETWORKS.flatMap((network) => {
    const link = values.socialLinks?.[network];
    return link && !current.socialLinks?.[network]?.trim() ? [[network, link] as const] : [];
  });
  return {
    ...(values.birthDate && !current.birthDate ? { birthDate: values.birthDate } : {}),
    ...(values.acquisitionSource && !current.acquisitionSource
      ? {
          acquisitionSource: values.acquisitionSource,
          acquisitionSourceDetail: values.acquisitionSourceDetail ?? null,
        }
      : {}),
    ...(addedLinks.length > 0
      ? { socialLinks: { ...current.socialLinks, ...Object.fromEntries(addedLinks) } }
      : {}),
  };
}
