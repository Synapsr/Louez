import type { CustomerFieldDefinition, ResolvedCustomerProfileSettings } from "@louez/types";
import {
  resolveCheckoutFields,
  resolveCheckoutProfileFields,
  resolveCustomerFormLayout,
  toCustomerExtraLayout,
  type CheckoutProfileField,
  type CustomerExtraLayoutItem,
  type CustomerFieldProduct,
} from "@louez/validations";

/** Matches no target: only fields asked for every product concern it. */
const ANY_PRODUCT: CustomerFieldProduct = { id: "", categoryIds: [] };

export interface PreviewCheckoutFields<TField> {
  /** Birth date, source, links the checkout asks. */
  profileFields: CheckoutProfileField[];
  /** The contact step's questions, for either buyer type. */
  customerFields: TField[];
  /** How the contact step lays those native and custom questions out (`joinCustomerExtraLayout`). */
  customerLayout: CustomerExtraLayoutItem[];
  /** One unit card's questions, in the layout's order. */
  itemFields: TField[];
}

/**
 * What the checkout asks for one product, or for any product of the store
 * when none is picked, in the owner's layout. Customer fields of both buyer
 * types show: the preview answers "what can my customers be asked?".
 * `layout` is the stored `customerFormLayout`, or a layout being edited.
 */
export const resolvePreviewCheckoutFields = <TField extends CustomerFieldDefinition>(
  definitions: readonly TField[],
  products: readonly CustomerFieldProduct[],
  productId: string | null,
  profileSettings: ResolvedCustomerProfileSettings,
  layout?: unknown,
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
  const profileFields = resolveCheckoutProfileFields(profileSettings, picked);
  const customerFields = definitions.filter((definition) => customerIds.has(definition.id));

  return {
    profileFields,
    customerFields,
    customerLayout: toCustomerExtraLayout(
      resolveCustomerFormLayout({
        scope: "customer",
        definitions: customerFields,
        layout,
        profileSettings,
      }),
      { profileFields, customerFields },
    ),
    itemFields: resolveCustomerFormLayout({
      scope: "item",
      definitions: definitions.filter((definition) => itemIds.has(definition.id)),
    }).flatMap((item) => (item.kind === "custom" ? [item.definition] : [])),
  };
};
