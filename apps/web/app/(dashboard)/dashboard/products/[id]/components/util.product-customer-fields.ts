import type { CustomerFieldDefinition } from "@louez/types";

/**
 * Fields worth showing on a product: those the checkout asks for it, and the
 * per-unit fields its rented units carry. A customer-record field the team
 * alone fills concerns every product alike, so it would only add noise.
 */
export const productCardFields = <
  TField extends Pick<CustomerFieldDefinition, "scope" | "collectMode">,
>(
  fields: readonly TField[],
): TField[] => fields.filter((field) => field.scope === "item" || field.collectMode !== "never");
