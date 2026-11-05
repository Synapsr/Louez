import type { CustomerSocialNetwork } from "@louez/types";
import type { CustomerFieldPublic } from "@louez/validations";

/**
 * What the storefront inputs read of a field. The checkout's public shape,
 * the account shape and the dashboard definition all satisfy it, so the owner
 * preview renders the very components the customer meets.
 */
export type StorefrontCustomerField = Pick<
  CustomerFieldPublic,
  | "id"
  | "label"
  | "type"
  | "format"
  | "options"
  | "unit"
  | "helpText"
  | "collectMode"
  | "isSensitive"
>;

/** "Pour qui ?" and the values of one rented unit, as the forms hold them. */
export interface RentalUnitFormValues {
  participantName?: string;
  values?: Record<string, string>;
}

/** Links being typed: a network is present as soon as its row is shown, even while blank. */
export type CustomerSocialLinksFormValue = Partial<Record<CustomerSocialNetwork, string>>;

/**
 * The native profile fields as the storefront forms hold them (checkout,
 * account profile), one form field per native field: the source and its
 * "Précisez" travel together.
 */
export interface CustomerProfileFormValues {
  /** ISO `yyyy-MM-dd`, as the date input gives it; "" when blank. */
  birthDate: string;
  acquisitionSource: { source: string; detail: string };
  socialLinks: CustomerSocialLinksFormValue;
}
