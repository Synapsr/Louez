import type { CustomerFieldDefinition } from "@louez/types";
import { resolveCheckoutFields, type CustomerFieldProduct } from "@louez/validations";

/** Matches no target: only fields asked for every product concern it. */
const ANY_PRODUCT: CustomerFieldProduct = { id: "", categoryIds: [] };

export interface PreviewCheckoutFields<TField> {
  /** The contact step's questions, for either buyer type. */
  customerFields: TField[];
  /** One unit card's questions. */
  itemFields: TField[];
}

/**
 * What the checkout asks for one product, or for any product of the store
 * when none is picked, in the owner's order. Customer fields of both buyer
 * types show: the preview answers "what can my customers be asked?".
 */
export const resolvePreviewCheckoutFields = <TField extends CustomerFieldDefinition>(
  definitions: readonly TField[],
  products: readonly CustomerFieldProduct[],
  productId: string | null,
): PreviewCheckoutFields<TField> => {
  const picked = productId
    ? products.filter((product) => product.id === productId)
    : [...products, ANY_PRODUCT];
  const lines = picked.map((product) => ({
    productId: product.id,
    categoryIds: product.categoryIds,
    quantity: 1,
  }));
  const individual = resolveCheckoutFields(definitions, lines, "individual");
  const business = resolveCheckoutFields(definitions, lines, "business");
  const customerIds = new Set(
    [...individual.customerFields, ...business.customerFields].map((field) => field.id),
  );
  const itemIds = new Set(
    individual.lines.flatMap((line) => line.itemFields).map((field) => field.id),
  );

  return {
    customerFields: definitions.filter((definition) => customerIds.has(definition.id)),
    itemFields: definitions.filter((definition) => itemIds.has(definition.id)),
  };
};
