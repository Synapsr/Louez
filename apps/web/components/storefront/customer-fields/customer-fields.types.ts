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

/** A field that can be grouped under its section title. */
export type StorefrontSectionedField = StorefrontCustomerField &
  Pick<CustomerFieldPublic, "section" | "position">;

/** "Pour qui ?" and the values of one rented unit, as the forms hold them. */
export interface RentalUnitFormValues {
  participantName?: string;
  values?: Record<string, string>;
}
