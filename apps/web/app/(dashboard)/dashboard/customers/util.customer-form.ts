import type { CustomerFieldValues, CustomerFormBuiltInKey } from "@louez/types";
import { resolveCustomerSocialLinks } from "@louez/utils";
import type {
  CustomerFormLayoutItem,
  CustomerInput,
  CustomerSectionInput,
} from "@louez/validations";

import type {
  CustomerFormCustomer,
  CustomerFormPrefill,
  CustomerFormValues,
} from "./customer-form.types";

/** The record's title: its header shows them and "Modifier" edits them, its Informations never do. */
const RECORD_TITLE_KEYS: readonly CustomerFormBuiltInKey[] = [
  "firstName",
  "lastName",
  "companyName",
];

type LayoutItem = CustomerFormLayoutItem<{ id: string }>;

/** The form's starting values: the customer's, or blanks (with what a search already typed). */
export const getCustomerFormDefaults = (
  customer: CustomerFormCustomer | undefined,
  customFields: CustomerFieldValues,
  prefill: CustomerFormPrefill = {},
): CustomerFormValues => ({
  customerType: customer?.customerType ?? "individual",
  email: customer?.email ?? prefill.email ?? "",
  firstName: customer?.firstName ?? prefill.firstName ?? "",
  lastName: customer?.lastName ?? prefill.lastName ?? "",
  companyName: customer?.companyName ?? "",
  companyNumber: customer?.companyNumber ?? "",
  vatNumber: customer?.vatNumber ?? "",
  phone: customer?.phone ?? prefill.phone ?? "",
  address: customer?.address ?? "",
  city: customer?.city ?? "",
  postalCode: customer?.postalCode ?? "",
  country: customer?.country ?? "",
  birthDate: customer?.birthDate ?? "",
  acquisitionSource: customer?.acquisitionSource ?? "",
  acquisitionSourceDetail: customer?.acquisitionSourceDetail ?? "",
  socialLinks: Object.fromEntries(
    resolveCustomerSocialLinks(customer?.socialLinks).map(({ network, value }) => [network, value]),
  ),
  notes: customer?.notes ?? "",
  customFields,
});

const blankToUndefined = (value: string) => (value.trim() === "" ? undefined : value);

/** What the create and update actions expect: blanks dropped rather than sent as empty strings. */
export const toCustomerInput = (values: CustomerFormValues): CustomerInput => ({
  ...values,
  companyName: blankToUndefined(values.companyName),
  companyNumber: blankToUndefined(values.companyNumber),
  vatNumber: blankToUndefined(values.vatNumber),
  phone: blankToUndefined(values.phone),
  address: blankToUndefined(values.address),
  city: blankToUndefined(values.city),
  postalCode: blankToUndefined(values.postalCode),
  country: blankToUndefined(values.country),
  birthDate: blankToUndefined(values.birthDate),
  acquisitionSource: values.acquisitionSource || undefined,
  acquisitionSourceDetail: blankToUndefined(values.acquisitionSourceDetail),
  notes: blankToUndefined(values.notes),
});

/** The items the record's "Informations" card lists and its Sheet edits: all but its title. */
export const listCustomerRecordItems = <TItem extends LayoutItem>(
  items: readonly TItem[],
): TItem[] =>
  items.filter((item) => item.kind === "custom" || !RECORD_TITLE_KEYS.includes(item.key));

/** The columns one Louez field writes from the record's Sheet. */
const toBuiltInRecordInput = (
  key: CustomerFormBuiltInKey,
  values: CustomerFormValues,
): CustomerSectionInput => {
  switch (key) {
    case "email":
      return { email: values.email };
    case "phone":
      return { phone: values.phone };
    case "address":
      return {
        address: values.address,
        city: values.city,
        postalCode: values.postalCode,
        country: values.country || undefined,
      };
    case "companyNumber":
      return { companyNumber: values.companyNumber };
    case "vatNumber":
      return { vatNumber: values.vatNumber };
    case "birthDate":
      return { birthDate: values.birthDate };
    case "acquisitionSource":
      return {
        acquisitionSource: values.acquisitionSource || null,
        acquisitionSourceDetail: values.acquisitionSourceDetail,
      };
    case "socialLinks":
      return { socialLinks: values.socialLinks };
    case "firstName":
    case "lastName":
    case "companyName":
      return {};
  }
};

/**
 * What the record's Sheet sends: only what it shows, so the rest of the
 * record (a field hidden since, the notes) is never touched.
 */
export const toCustomerRecordInput = (
  values: CustomerFormValues,
  items: readonly LayoutItem[],
): CustomerSectionInput => {
  const customIds = items.flatMap((item) => (item.kind === "custom" ? [item.definition.id] : []));
  const builtIns = items.reduce<CustomerSectionInput>(
    (input, item) =>
      item.kind === "builtin" ? { ...input, ...toBuiltInRecordInput(item.key, values) } : input,
    {},
  );
  return customIds.length > 0
    ? {
        ...builtIns,
        customFields: Object.fromEntries(
          customIds.map((id) => [id, values.customFields[id] ?? ""]),
        ),
      }
    : builtIns;
};

const hasText = (value: string | null | undefined) => Boolean(value?.trim());

/** True when the record holds something for this item: the card only lists those. */
export const isCustomerRecordItemFilled = (
  item: LayoutItem,
  customer: CustomerFormCustomer,
  customFields: CustomerFieldValues,
): boolean => {
  if (item.kind === "custom") return hasText(customFields[item.definition.id]);
  switch (item.key) {
    case "address":
      return hasText(customer.address) || hasText(customer.city) || hasText(customer.postalCode);
    case "socialLinks":
      return resolveCustomerSocialLinks(customer.socialLinks).length > 0;
    case "acquisitionSource":
      return customer.acquisitionSource !== null;
    default:
      return hasText(customer[item.key]);
  }
};

/** SIREN in France, BCE number in Belgium, a plain "company number" elsewhere. */
export const getCompanyNumberLabelKey = (
  country: string | null | undefined,
): "companyNumberSiren" | "companyNumberBce" | "companyNumber" =>
  country === "FR" ? "companyNumberSiren" : country === "BE" ? "companyNumberBce" : "companyNumber";
