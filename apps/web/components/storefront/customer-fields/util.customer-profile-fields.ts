import {
  CUSTOMER_SOCIAL_NETWORKS,
  type CustomerProfileFieldKey,
  type CustomerSocialNetwork,
} from "@louez/types";
import {
  acquisitionSourceTakesDetail,
  customerProfileFieldIssueSchema,
  validateCustomerProfileValues,
  type CheckoutProfileField,
  type CustomerProfileFieldIssue,
  type CustomerProfileValues,
  type CustomerProfileValuesInput,
} from "@louez/validations";
import { z } from "zod";

import type {
  CustomerProfileFormValues,
  CustomerSocialLinksFormValue,
  StorefrontCustomerField,
} from "./customer-fields.types";

/** A native field has no help text and no identifier format. */
export const NO_PROFILE_FIELD_HINTS: Pick<StorefrontCustomerField, "helpText" | "format"> = {
  helpText: null,
  format: null,
};

export const EMPTY_CUSTOMER_PROFILE_FORM_VALUES: CustomerProfileFormValues = {
  birthDate: "",
  acquisitionSource: { source: "", detail: "" },
  socialLinks: {},
};

/** Where the native fields sit in a storefront form (checkout, account profile). */
export type CustomerProfileFieldName = `profileFields.${CustomerProfileFieldKey}`;

export const toProfileFieldName = (key: CustomerProfileFieldKey): CustomerProfileFieldName =>
  `profileFields.${key}`;

/** Stored links as rows to edit: only the networks the customer has. */
const toSocialLinksFormValue = (
  links: CustomerProfileValues["socialLinks"],
): CustomerSocialLinksFormValue =>
  Object.fromEntries(
    CUSTOMER_SOCIAL_NETWORKS.flatMap((network) => {
      const link = links?.[network]?.trim();
      return link ? [[network, link]] : [];
    }),
  );

/** A customer's native values as the forms hold them; blank for what is not on file. */
export const toCustomerProfileFormValues = (
  values: CustomerProfileValues | null,
): CustomerProfileFormValues =>
  values
    ? {
        birthDate: values.birthDate ?? "",
        acquisitionSource: {
          source: values.acquisitionSource ?? "",
          detail: values.acquisitionSourceDetail ?? "",
        },
        socialLinks: toSocialLinksFormValue(values.socialLinks),
      }
    : EMPTY_CUSTOMER_PROFILE_FORM_VALUES;

/**
 * What a form sends of the native fields: only the ones listed (asked, or
 * editable), blanks included so a signed-in customer can clear a value. A
 * "Précisez" typed before switching to a source without detail stays behind.
 */
export const toCustomerProfileValuesInput = (
  values: CustomerProfileFormValues,
  fields: readonly Pick<CheckoutProfileField, "key">[],
): CustomerProfileValuesInput => {
  const keys = new Set(fields.map((field) => field.key));
  const source = values.acquisitionSource.source.trim();
  const links = CUSTOMER_SOCIAL_NETWORKS.flatMap((network): [CustomerSocialNetwork, string][] => {
    const link = values.socialLinks[network]?.trim();
    return link ? [[network, link]] : [];
  });
  return {
    ...(keys.has("birthDate") ? { birthDate: values.birthDate.trim() } : {}),
    ...(keys.has("acquisitionSource")
      ? {
          acquisitionSource: source,
          ...(acquisitionSourceTakesDetail(source)
            ? { acquisitionSourceDetail: values.acquisitionSource.detail.trim() }
            : {}),
        }
      : {}),
    ...(keys.has("socialLinks") ? { socialLinks: Object.fromEntries(links) } : {}),
  };
};

/**
 * Every native value the shared rules refuse, as the server would: required
 * left empty, a date that cannot be a birth date, a link that cannot be kept.
 */
export const getCustomerProfileFormIssues = (
  values: CustomerProfileFormValues,
  fields: readonly CheckoutProfileField[],
): CustomerProfileFieldIssue[] =>
  fields.length === 0
    ? []
    : validateCustomerProfileValues({
        fields,
        values: toCustomerProfileValuesInput(values, fields),
      }).issues;

/**
 * A signed-in customer already gave every asked native value and each still
 * passes the rules: the contact step can fold them with the custom ones.
 */
export const hasEveryProfileValueOnFile = (
  fields: readonly CheckoutProfileField[],
  saved: CustomerProfileFormValues,
): boolean =>
  getCustomerProfileFormIssues(
    saved,
    fields.map((field) => ({ ...field, collectMode: "required" })),
  ).length === 0;

const profileIssuesErrorSchema = z.object({
  data: z.object({ profileIssues: z.array(customerProfileFieldIssueSchema) }),
});

/** `data.profileIssues` of an `errors.customFieldsInvalid` refusal of `updateMyValues`. */
export const readCustomerProfileFieldIssues = (error: unknown): CustomerProfileFieldIssue[] => {
  const parsed = profileIssuesErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.data.profileIssues : [];
};
