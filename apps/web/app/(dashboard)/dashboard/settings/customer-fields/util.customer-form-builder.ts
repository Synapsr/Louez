import type {
  CustomerFieldCollectMode,
  CustomerFieldDefinition,
  CustomerFieldScope,
  CustomerFormLayout,
  CustomerProfileFieldKey,
  CustomerProfileFieldSettings,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  type CustomerFormCustomItem,
  type CustomerFormLayoutItem,
  isCustomerProfileFieldKey,
  moveCustomerFormLayoutItem,
  selectCustomerFormItems,
} from "@louez/validations";

import { describeTargeting } from "./util.customer-field-online";

export type CustomerType = "individual" | "business";

const toCustomItem = <TDefinition extends CustomerFieldDefinition>(
  definition: TDefinition,
  width = definition.width,
): CustomerFormCustomItem<TDefinition> => ({
  kind: "custom",
  key: definition.id,
  definition,
  width,
  fixedWidth: false,
  appliesTo: definition.scope === "item" ? "all" : definition.appliesTo,
  hidden: !definition.isActive,
  // An item value lives on a rented unit: saving a customer never needs it.
  required: definition.scope === "customer" && definition.isRequired,
  locked: false,
});

/**
 * The page's list for one tab. The order and widths come from `layout` (the
 * last saved or moved), the rest from the fields as they are now: a setting
 * just changed shows at once, without waiting for the layout to be read
 * again. A field created since is appended, as the server placed it; a field
 * deleted since is left out.
 */
export const joinCustomerFormItems = <TDefinition extends CustomerFieldDefinition>({
  scope,
  layout,
  definitions,
  profileSettings,
}: {
  scope: CustomerFieldScope;
  layout: readonly CustomerFormLayoutItem<Pick<CustomerFieldDefinition, "id">>[];
  definitions: readonly TDefinition[];
  profileSettings: ResolvedCustomerProfileSettings | undefined;
}): CustomerFormLayoutItem<TDefinition>[] => {
  const byId = new Map(
    definitions
      .filter((definition) => definition.scope === scope)
      .map((definition) => [definition.id, definition]),
  );
  const placed = new Set<string>();

  const items = layout.flatMap((item): CustomerFormLayoutItem<TDefinition>[] => {
    if (item.kind === "builtin") {
      const settings =
        profileSettings && isCustomerProfileFieldKey(item.key) ? profileSettings[item.key] : null;
      return [
        settings
          ? {
              ...item,
              hidden: settings.visibility === "hidden",
              required: settings.visibility === "required",
            }
          : item,
      ];
    }
    const definition = byId.get(item.key);
    if (!definition) return [];
    placed.add(definition.id);
    return [toCustomItem(definition, item.width)];
  });

  const created = [...byId.values()]
    .filter((definition) => !placed.has(definition.id))
    .sort((left, right) => left.position - right.position)
    .map((definition) => toCustomItem(definition));
  return [...items, ...created];
};

/**
 * What a tab shows: every item of the customer form for the customer type
 * being previewed (hidden ones included, greyed in place), every per-item field.
 */
export const selectBuilderItems = <
  TItem extends Pick<CustomerFormLayoutItem, "appliesTo" | "hidden">,
>(
  items: readonly TItem[],
  { scope, customerType }: { scope: CustomerFieldScope; customerType: CustomerType },
): TItem[] =>
  scope === "customer"
    ? selectCustomerFormItems(items, { customerType, includeHidden: true })
    : [...items];

/**
 * The full list once a shown item was dropped from `from` to `to` (indexes in
 * `shown`): it takes the place of the item it was dropped on, and the items
 * not shown (the other customer type's) keep theirs. Null when nothing moved.
 */
export const moveShownItem = <TItem extends { key: string }>(
  items: readonly TItem[],
  shown: readonly TItem[],
  from: number,
  to: number,
): TItem[] | null => {
  const moved = shown[from];
  const over = shown[to];
  if (from === to || !moved || !over) return null;
  return moveCustomerFormLayoutItem(items, moved.key, over.key);
};

/** Social links can be shown or hidden, never required (by the team or online). */
export const profileFieldAllowsRequired = (key: CustomerProfileFieldKey): boolean =>
  key !== "socialLinks";

/** What the badges under an item say. A hidden item only says so: nothing else applies to it. */
export interface CustomerFormItemFlags {
  hidden: boolean;
  /** The team must fill it to save the record. */
  required: boolean;
  sensitive: boolean;
  collectMode: CustomerFieldCollectMode;
  /** "Selon les produits" with nothing picked: the field concerns no reservation. */
  noTarget: boolean;
}

const HIDDEN_FLAGS: CustomerFormItemFlags = {
  hidden: true,
  required: false,
  sensitive: false,
  collectMode: "never",
  noTarget: false,
};

const customFieldFlags = (definition: CustomerFieldDefinition): CustomerFormItemFlags =>
  definition.isActive
    ? {
        hidden: false,
        required: definition.scope === "customer" && definition.isRequired,
        sensitive: definition.isSensitive,
        collectMode: definition.collectMode,
        noTarget: describeTargeting(definition).kind === "empty",
      }
    : HIDDEN_FLAGS;

const profileFieldFlags = (settings: CustomerProfileFieldSettings): CustomerFormItemFlags =>
  settings.visibility === "hidden"
    ? HIDDEN_FLAGS
    : {
        hidden: false,
        required: settings.visibility === "required",
        sensitive: false,
        collectMode: settings.collectMode,
        noTarget: describeTargeting({ scope: "customer", ...settings }).kind === "empty",
      };

/**
 * The badges of an item, the same way for a Louez field and one of the
 * store's. None for the locked ones: their lock already says everything.
 */
export const customerFormItemFlags = (
  item: CustomerFormLayoutItem,
  profileSettings: ResolvedCustomerProfileSettings | undefined,
): CustomerFormItemFlags | null => {
  if (item.kind === "custom") return customFieldFlags(item.definition);
  if (item.locked || !profileSettings || !isCustomerProfileFieldKey(item.key)) return null;
  return profileFieldFlags(profileSettings[item.key]);
};

/**
 * What the checkout preview resolves for the list being edited: the Louez
 * fields' places as a stored layout, and the store's shown fields with
 * their place and width. Positions follow the list, so the preview reads
 * exactly as the tab does.
 */
export const toPreviewCheckoutInput = <TDefinition extends CustomerFieldDefinition>(
  items: readonly CustomerFormLayoutItem<TDefinition>[],
): { layout: CustomerFormLayout; definitions: TDefinition[] } => {
  const layout: CustomerFormLayout = {};
  const definitions: TDefinition[] = [];
  items.forEach((item, position) => {
    if (item.kind === "builtin") {
      layout[item.key] = { position, width: item.width };
    } else if (!item.hidden) {
      definitions.push({ ...item.definition, position, width: item.width });
    }
  });
  return { layout, definitions };
};
