import type { CustomerFieldTargetOptions } from "@louez/api/services/customer-fields-online";
import type {
  CustomerFieldAppliesTo,
  CustomerFieldCollectMode,
  CustomerFieldDefinition,
  CustomerFieldFormat,
  CustomerFieldScope,
  CustomerFieldTarget,
  CustomerFieldTargetMode,
  CustomerFieldType,
} from "@louez/types";

/** The "Réservation en ligne" settings of a field, as the Sheet edits them. */
export interface CustomerFieldOnlineSettings {
  collectMode: CustomerFieldCollectMode;
  targetMode: CustomerFieldTargetMode;
  targets: CustomerFieldTarget[];
  customerEditable: boolean;
}

export const DEFAULT_ONLINE_SETTINGS: CustomerFieldOnlineSettings = {
  collectMode: "never",
  targetMode: "all",
  targets: [],
  customerEditable: false,
};

export const pickOnlineSettings = (
  field: CustomerFieldOnlineSettings,
): CustomerFieldOnlineSettings => ({
  collectMode: field.collectMode,
  targetMode: field.targetMode,
  targets: field.targets,
  customerEditable: field.customerEditable,
});

/** A field the checkout never asks cannot be edited by the customer either: the server refuses it. */
export const patchOnlineSettings = (
  current: CustomerFieldOnlineSettings,
  patch: Partial<CustomerFieldOnlineSettings>,
): CustomerFieldOnlineSettings => {
  const next = { ...current, ...patch };
  return next.collectMode === "never" ? { ...next, customerEditable: false } : next;
};

/**
 * "Pour" only matters to a customer field while the checkout asks it (the
 * value lives on the record whatever the cart). An item field is recorded on
 * the units it targets even when only the team fills it, so it always shows.
 */
export const showsTargetChoice = (params: {
  carriesItems: boolean;
  collectMode: CustomerFieldCollectMode;
}): boolean => params.carriesItems || params.collectMode !== "never";

const toTargetKey = (target: CustomerFieldTarget) => `${target.type}:${target.id}`;

/** What the "Pour" setting of a field means today, for its row in the editor. */
export type CustomerFieldTargeting =
  /** A customer field the checkout never asks: on every record, its targets are unused. */
  | { kind: "irrelevant" }
  | { kind: "all" }
  /** "Selon les produits" with nothing picked: the field concerns no reservation. */
  | { kind: "empty" }
  | { kind: "targets"; targets: CustomerFieldTarget[] };

export const describeTargeting = (
  field: Pick<CustomerFieldDefinition, "scope" | "collectMode" | "targetMode" | "targets">,
): CustomerFieldTargeting => {
  if (
    !showsTargetChoice({ carriesItems: field.scope === "item", collectMode: field.collectMode })
  ) {
    return { kind: "irrelevant" };
  }
  if (field.targetMode === "all") return { kind: "all" };
  return field.targets.length === 0
    ? { kind: "empty" }
    : { kind: "targets", targets: field.targets };
};

/** One entry of the "Pour" picker. */
export interface CustomerFieldTargetItem {
  /** Unique across categories and products. */
  value: string;
  label: string;
  target: CustomerFieldTarget;
  image: string | null;
  /** Products in the category; null for a product. */
  productCount: number | null;
  /** Status of the product; null for a category. */
  status: CustomerFieldTargetOptions["products"][number]["status"] | null;
}

/**
 * Picker entries: every category with its product count, then the products.
 * An archived product is only listed while it is still picked, so it can be
 * removed but not added.
 */
export const buildTargetItems = (
  options: CustomerFieldTargetOptions,
  selected: readonly CustomerFieldTarget[],
): { categories: CustomerFieldTargetItem[]; products: CustomerFieldTargetItem[] } => {
  const selectedKeys = new Set(selected.map(toTargetKey));
  const productCounts = new Map<string, number>();
  for (const product of options.products) {
    if (product.status === "archived") continue;
    for (const categoryId of product.categoryIds) {
      productCounts.set(categoryId, (productCounts.get(categoryId) ?? 0) + 1);
    }
  }

  return {
    categories: options.categories.map((category) => ({
      value: `category:${category.id}`,
      label: category.name,
      target: { type: "category", id: category.id },
      image: null,
      productCount: productCounts.get(category.id) ?? 0,
      status: null,
    })),
    products: options.products
      .filter(
        (product) => product.status !== "archived" || selectedKeys.has(`product:${product.id}`),
      )
      .map((product) => ({
        value: `product:${product.id}`,
        label: product.name,
        target: { type: "product", id: product.id },
        image: product.image,
        productCount: null,
        status: product.status,
      })),
  };
};

/** The picker entries of the picked targets, in the order they were picked. */
export const selectTargetItems = (
  items: readonly CustomerFieldTargetItem[],
  targets: readonly CustomerFieldTarget[],
): CustomerFieldTargetItem[] => {
  const byValue = new Map(items.map((item) => [item.value, item]));
  return targets.flatMap((target) => {
    const item = byValue.get(toTargetKey(target));
    return item ? [item] : [];
  });
};

interface CustomerFieldDialogValues extends CustomerFieldOnlineSettings {
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  options: string[];
  unit: string;
  helpText: string;
  format?: CustomerFieldFormat | null;
  appliesTo: CustomerFieldAppliesTo;
  isRequired: boolean;
  isSearchable: boolean;
  showInList: boolean;
}

/**
 * What a new field sends. The switches an item field hides are turned off
 * (the server refuses them on that scope), empty strings become null, a
 * format only goes with a text, and a field never asked cannot stay editable
 * by the customer.
 */
export const toCustomerFieldPayload = <TValues extends CustomerFieldDialogValues>(
  values: TValues,
) => ({
  ...values,
  options: values.type === "select" ? values.options : null,
  format: values.type === "text" ? (values.format ?? null) : null,
  unit: values.unit || null,
  helpText: values.helpText || null,
  appliesTo: values.scope === "item" ? "all" : values.appliesTo,
  isRequired: values.scope === "customer" && values.isRequired,
  isSearchable: values.scope === "customer" && values.isSearchable,
  showInList: values.scope === "customer" && values.showInList,
  customerEditable: values.collectMode !== "never" && values.customerEditable,
});
