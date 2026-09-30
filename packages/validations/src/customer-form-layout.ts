import {
  CUSTOMER_FORM_BUILT_IN_KEYS,
  CUSTOMER_PROFILE_FIELD_KEYS,
  type CustomerFieldAppliesTo,
  type CustomerFieldDefinition,
  type CustomerFieldScope,
  type CustomerFieldWidth,
  type CustomerFormBuiltInKey,
  type CustomerFormLayout,
  type CustomerFormLayoutEntry,
  type CustomerProfileFieldKey,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";
import { z } from "zod";

import {
  customerFieldAppliesToSchema,
  customerFieldScopeSchema,
  customerFieldWidthSchema,
  customerProfileFieldKeySchema,
} from "./customer-fields";
import { resolveCustomerProfileSettings } from "./customer-profile-fields";

// ----------------------------------------------------------------------------
// The Louez fields of the customer record
// ----------------------------------------------------------------------------

export const customerFormBuiltInKeySchema = z.enum(CUSTOMER_FORM_BUILT_IN_KEYS);

interface BuiltInDefaults {
  width: CustomerFieldWidth;
  /** Always on the record: moved and resized, never hidden, renamed or deleted. */
  locked: boolean;
  /** Its width never changes (the address block, the list of links). */
  fixedWidth: boolean;
  appliesTo: Extract<CustomerFieldAppliesTo, "all" | "business">;
}

/**
 * What each Louez field is when nothing is stored. The order of
 * `CUSTOMER_FORM_BUILT_IN_KEYS` is the default order: today's forms, with the
 * custom fields after them.
 */
const BUILT_IN_DEFAULTS = {
  firstName: { width: "half", locked: true, fixedWidth: false, appliesTo: "all" },
  lastName: { width: "half", locked: true, fixedWidth: false, appliesTo: "all" },
  email: { width: "half", locked: true, fixedWidth: false, appliesTo: "all" },
  phone: { width: "half", locked: true, fixedWidth: false, appliesTo: "all" },
  address: { width: "full", locked: true, fixedWidth: true, appliesTo: "all" },
  companyName: { width: "full", locked: true, fixedWidth: false, appliesTo: "business" },
  companyNumber: { width: "half", locked: true, fixedWidth: false, appliesTo: "business" },
  vatNumber: { width: "half", locked: true, fixedWidth: false, appliesTo: "business" },
  birthDate: { width: "half", locked: false, fixedWidth: false, appliesTo: "all" },
  acquisitionSource: { width: "half", locked: false, fixedWidth: false, appliesTo: "all" },
  socialLinks: { width: "full", locked: false, fixedWidth: true, appliesTo: "all" },
} as const satisfies Record<CustomerFormBuiltInKey, BuiltInDefaults>;

/** Needed to save any customer: names and e-mail always, the company name for a business. */
const ALWAYS_REQUIRED: readonly CustomerFormBuiltInKey[] = [
  "firstName",
  "lastName",
  "email",
  "companyName",
];

/** Birth date, customer source, social links: the Louez fields the owner can hide or require. */
export const isCustomerProfileFieldKey = (key: string): key is CustomerProfileFieldKey =>
  CUSTOMER_PROFILE_FIELD_KEYS.some((candidate) => candidate === key);

// ----------------------------------------------------------------------------
// Resolved items
// ----------------------------------------------------------------------------

interface CustomerFormLayoutItemBase {
  /** The Louez field's key or the definition id: what `updateLayout` takes back. */
  key: string;
  width: CustomerFieldWidth;
  /** Its width never changes: the address block and social links are always full. */
  fixedWidth: boolean;
  /** Who it concerns: the company fields and some custom fields only one customer type. */
  appliesTo: CustomerFieldAppliesTo;
  /** Off every form: a Louez field hidden in the settings, an archived custom field. */
  hidden: boolean;
  /** The team must fill it to save the record. */
  required: boolean;
}

export interface CustomerFormBuiltInItem extends CustomerFormLayoutItemBase {
  kind: "builtin";
  key: CustomerFormBuiltInKey;
  /** Always on the record: it can be moved and resized, never hidden, renamed or deleted. */
  locked: boolean;
}

export interface CustomerFormCustomItem<TDefinition> extends CustomerFormLayoutItemBase {
  kind: "custom";
  definition: TDefinition;
  locked: false;
}

/** One item of the customer form, in layout order: a Louez field or a custom field. */
export type CustomerFormLayoutItem<TDefinition = CustomerFieldDefinition> =
  | CustomerFormBuiltInItem
  | CustomerFormCustomItem<TDefinition>;

/** What the resolver reads of a definition. */
export type CustomerFormLayoutDefinition = Pick<
  CustomerFieldDefinition,
  "id" | "scope" | "position" | "width" | "isActive" | "appliesTo" | "isRequired"
>;

/** `dashboard.customerFields.layout`'s items, with the definition shape the caller picks. */
export const customerFormLayoutItemSchema = <TDefinition extends z.ZodType>(
  definition: TDefinition,
) =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("builtin"),
      key: customerFormBuiltInKeySchema,
      width: customerFieldWidthSchema,
      fixedWidth: z.boolean(),
      appliesTo: customerFieldAppliesToSchema,
      hidden: z.boolean(),
      required: z.boolean(),
      locked: z.boolean(),
    }),
    z.object({
      kind: z.literal("custom"),
      key: z.string(),
      definition,
      width: customerFieldWidthSchema,
      fixedWidth: z.boolean(),
      appliesTo: customerFieldAppliesToSchema,
      hidden: z.boolean(),
      required: z.boolean(),
      locked: z.literal(false),
    }),
  ]);

// ----------------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The stored Louez entries that can be read: a finite position, and a width
 * (the default one when unreadable). Anything else counts as missing.
 */
const readStoredLayout = (
  stored: unknown,
): Map<CustomerFormBuiltInKey, CustomerFormLayoutEntry> => {
  const entries = new Map<CustomerFormBuiltInKey, CustomerFormLayoutEntry>();
  if (!isRecord(stored)) return entries;
  for (const key of CUSTOMER_FORM_BUILT_IN_KEYS) {
    const entry = stored[key];
    if (!isRecord(entry)) continue;
    const { position } = entry;
    if (typeof position !== "number" || !Number.isFinite(position)) continue;
    const width = customerFieldWidthSchema.safeParse(entry.width);
    entries.set(key, {
      position,
      width: width.success ? width.data : BUILT_IN_DEFAULTS[key].width,
    });
  }
  return entries;
};

type Placed<TDefinition> =
  | { kind: "builtin"; key: CustomerFormBuiltInKey; position: number }
  | { kind: "custom"; definition: TDefinition; position: number };

/** Position first; on a tie the Louez field goes first, in its default order. */
const comparePlaced = <TDefinition>(left: Placed<TDefinition>, right: Placed<TDefinition>) => {
  if (left.position !== right.position) return left.position - right.position;
  const rank = (entry: Placed<TDefinition>) =>
    entry.kind === "builtin" ? CUSTOMER_FORM_BUILT_IN_KEYS.indexOf(entry.key) : Infinity;
  const leftRank = rank(left);
  const rightRank = rank(right);
  return leftRank === rightRank ? 0 : leftRank < rightRank ? -1 : 1;
};

/**
 * Stored Louez fields and custom fields sorted by their shared positions, then
 * each Louez field without a stored entry right after the one preceding it in
 * the default order (the first one at the top). Nothing stored gives the
 * default: Louez fields first, custom fields after them by position.
 */
const placeCustomerItems = <TDefinition extends CustomerFormLayoutDefinition>(
  definitions: readonly TDefinition[],
  stored: Map<CustomerFormBuiltInKey, CustomerFormLayoutEntry>,
): Placed<TDefinition>[] => {
  const placed: Placed<TDefinition>[] = [
    ...[...stored].map(([key, entry]) => ({
      kind: "builtin" as const,
      key,
      position: entry.position,
    })),
    ...definitions.map((definition) => ({
      kind: "custom" as const,
      definition,
      position: definition.position,
    })),
  ].sort(comparePlaced);

  CUSTOMER_FORM_BUILT_IN_KEYS.forEach((key, index) => {
    if (stored.has(key)) return;
    const previous = CUSTOMER_FORM_BUILT_IN_KEYS[index - 1];
    const at =
      previous === undefined
        ? 0
        : placed.findIndex((entry) => entry.kind === "builtin" && entry.key === previous) + 1;
    placed.splice(at, 0, { kind: "builtin", key, position: Number.NaN });
  });
  return placed;
};

/** True when the item concerns this customer type. */
export const appliesToCustomerType = (
  item: Pick<CustomerFormLayoutItemBase, "appliesTo">,
  customerType: "individual" | "business",
): boolean => item.appliesTo === "all" || item.appliesTo === customerType;

/**
 * The items a form shows: hidden ones left out unless asked for, and only
 * those concerning the customer type when one is given.
 */
export const selectCustomerFormItems = <
  TItem extends Pick<CustomerFormLayoutItemBase, "appliesTo" | "hidden">,
>(
  items: readonly TItem[],
  options: { customerType?: "individual" | "business"; includeHidden?: boolean } = {},
): TItem[] =>
  items.filter(
    (item) =>
      (options.includeHidden || !item.hidden) &&
      (!options.customerType || appliesToCustomerType(item, options.customerType)),
  );

const toCustomItem = <TDefinition extends CustomerFormLayoutDefinition>(
  definition: TDefinition,
): CustomerFormCustomItem<TDefinition> => ({
  kind: "custom",
  key: definition.id,
  definition,
  width: definition.width,
  fixedWidth: false,
  appliesTo: definition.scope === "item" ? "all" : definition.appliesTo,
  hidden: !definition.isActive,
  // An item-scope value lives on a rented unit: saving a customer never needs it.
  required: definition.scope === "customer" && definition.isRequired,
  locked: false,
});

const toBuiltInItem = (
  key: CustomerFormBuiltInKey,
  stored: CustomerFormLayoutEntry | undefined,
  profileSettings: ResolvedCustomerProfileSettings,
): CustomerFormBuiltInItem => {
  const defaults = BUILT_IN_DEFAULTS[key];
  const visibility = isCustomerProfileFieldKey(key) ? profileSettings[key].visibility : null;
  return {
    kind: "builtin",
    key,
    width: defaults.fixedWidth ? "full" : (stored?.width ?? defaults.width),
    fixedWidth: defaults.fixedWidth,
    appliesTo: defaults.appliesTo,
    hidden: visibility === "hidden",
    required: ALWAYS_REQUIRED.includes(key) || visibility === "required",
    locked: defaults.locked,
  };
};

export type ResolveCustomerFormLayoutParams<TDefinition extends CustomerFormLayoutDefinition> =
  | {
      scope: "customer";
      /** The store's definitions; those of the other scope are ignored. */
      definitions: readonly TDefinition[];
      /** `stores.settings.customerFormLayout` as stored, read leniently. */
      layout: unknown;
      /** Hides and requires the editable Louez fields (`resolveCustomerProfileSettings`). */
      profileSettings: ResolvedCustomerProfileSettings;
      /** Only the items concerning this customer type; every item when absent. */
      customerType?: "individual" | "business";
      /** Keep the hidden items (the settings page); forms leave them out. */
      includeHidden?: boolean;
    }
  | {
      /** Per rented item: custom fields only, in position order. */
      scope: "item";
      definitions: readonly TDefinition[];
      includeHidden?: boolean;
    };

/**
 * The customer form as the owner laid it out: one ordered list of Louez and
 * custom fields, each with its width. Every form and display reads its order
 * from here; nobody sorts or groups fields on its own.
 */
export function resolveCustomerFormLayout<TDefinition extends CustomerFormLayoutDefinition>(
  params: ResolveCustomerFormLayoutParams<TDefinition>,
): CustomerFormLayoutItem<TDefinition>[] {
  const definitions = params.definitions.filter((definition) => definition.scope === params.scope);

  if (params.scope === "item") {
    const items = [...definitions]
      .sort((left, right) => left.position - right.position)
      .map((definition) => toCustomItem(definition));
    return selectCustomerFormItems(items, { includeHidden: params.includeHidden });
  }

  const stored = readStoredLayout(params.layout);
  const items = placeCustomerItems(definitions, stored).map(
    (entry): CustomerFormLayoutItem<TDefinition> =>
      entry.kind === "builtin"
        ? toBuiltInItem(entry.key, stored.get(entry.key), params.profileSettings)
        : toCustomItem(entry.definition),
  );
  return selectCustomerFormItems(items, {
    customerType: params.customerType,
    includeHidden: params.includeHidden,
  });
}

/**
 * `resolveCustomerFormLayout` straight from a store's settings (its stored
 * layout and profile settings, both read leniently): what pages and
 * procedures call with `store.settings`.
 */
export const resolveStoreCustomerFormLayout = <
  TDefinition extends CustomerFormLayoutDefinition,
>(params: {
  settings: { customerFormLayout?: unknown; customerProfile?: unknown } | null | undefined;
  scope: CustomerFieldScope;
  definitions: readonly TDefinition[];
  customerType?: "individual" | "business";
  includeHidden?: boolean;
}): CustomerFormLayoutItem<TDefinition>[] =>
  params.scope === "item"
    ? resolveCustomerFormLayout({
        scope: "item",
        definitions: params.definitions,
        includeHidden: params.includeHidden,
      })
    : resolveCustomerFormLayout({
        scope: "customer",
        definitions: params.definitions,
        layout: params.settings?.customerFormLayout,
        profileSettings: resolveCustomerProfileSettings(params.settings?.customerProfile),
        customerType: params.customerType,
        includeHidden: params.includeHidden,
      });

/**
 * The highest position the stored layout gives a Louez field, or null: a new
 * custom field goes after it so it lands at the very end of the form.
 */
export const lastStoredCustomerFormLayoutPosition = (layout: unknown): number | null => {
  const positions = [...readStoredLayout(layout).values()].map((entry) => entry.position);
  return positions.length > 0 ? Math.max(...positions) : null;
};

// ----------------------------------------------------------------------------
// Updating the layout (drag and drop, width toggle)
// ----------------------------------------------------------------------------

export const customerFormLayoutUpdateInputSchema = z.object({
  scope: customerFieldScopeSchema,
  /**
   * Every item of the scope in its new order, hidden and business ones
   * included (the `layout` answer, rearranged). Keys are Louez field keys or
   * definition ids.
   */
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(64),
        width: customerFieldWidthSchema,
      }),
    )
    .max(250)
    .refine(
      (items) => new Set(items.map((item) => item.key)).size === items.length,
      "errors.invalidData",
    ),
});

export type CustomerFormLayoutUpdateInput = z.infer<typeof customerFormLayoutUpdateInputSchema>;

export type CustomerFormLayoutPlan =
  | {
      ok: true;
      /** The whole `customerFormLayout` to store (customer scope; empty for items). */
      builtIns: CustomerFormLayout;
      /** Every definition of the scope with its new position and width. */
      definitions: { id: string; position: number; width: CustomerFieldWidth }[];
    }
  | { ok: false; error: "unknownKey" | "duplicateKey" | "missingBuiltIn" };

/**
 * What an `updateLayout` writes, decided before any SQL. `current` is the
 * scope's resolved layout, hidden items included. Positions become 0..n in
 * the order sent; a key that is not in the scope is refused, and so is a list
 * missing a Louez field. A custom field created meanwhile (absent from the
 * list) keeps its place after the others. The address block and social links
 * stay full width whatever is sent.
 */
export function planCustomerFormLayoutUpdate(params: {
  current: readonly CustomerFormLayoutItem<Pick<CustomerFieldDefinition, "id">>[];
  items: readonly { key: string; width: CustomerFieldWidth }[];
}): CustomerFormLayoutPlan {
  const currentByKey = new Map(params.current.map((item) => [item.key, item]));
  const sent = new Set<string>();
  const ordered: {
    item: CustomerFormLayoutItem<Pick<CustomerFieldDefinition, "id">>;
    width: CustomerFieldWidth;
  }[] = [];

  for (const { key, width } of params.items) {
    const item = currentByKey.get(key);
    if (!item) return { ok: false, error: "unknownKey" };
    if (sent.has(key)) return { ok: false, error: "duplicateKey" };
    sent.add(key);
    ordered.push({ item, width });
  }
  if (params.current.some((item) => item.kind === "builtin" && !sent.has(item.key))) {
    return { ok: false, error: "missingBuiltIn" };
  }
  for (const item of params.current) {
    if (!sent.has(item.key)) ordered.push({ item, width: item.width });
  }

  const builtIns: CustomerFormLayout = {};
  const definitions: { id: string; position: number; width: CustomerFieldWidth }[] = [];
  ordered.forEach(({ item, width }, position) => {
    const settled = item.fixedWidth ? "full" : width;
    if (item.kind === "builtin") {
      builtIns[item.key] = { position, width: settled };
    } else {
      definitions.push({ id: item.definition.id, position, width: settled });
    }
  });
  return { ok: true, builtIns, definitions };
}

/**
 * The full list once the item `key` moved to where `overKey` is (a drop on
 * another item). Items not shown while dragging (business fields in the
 * "Particulier" preview) keep their place among the others.
 */
export const moveCustomerFormLayoutItem = <TItem extends { key: string }>(
  items: readonly TItem[],
  key: string,
  overKey: string,
): TItem[] => {
  const from = items.findIndex((item) => item.key === key);
  const to = items.findIndex((item) => item.key === overKey);
  if (from === -1 || to === -1 || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/** The list with one item's width changed; a fixed-width item stays full. */
export const setCustomerFormLayoutItemWidth = <
  TItem extends { key: string; width: CustomerFieldWidth; fixedWidth: boolean },
>(
  items: readonly TItem[],
  key: string,
  width: CustomerFieldWidth,
): TItem[] =>
  items.map((item) =>
    item.key === key && !item.fixedWidth && item.width !== width ? { ...item, width } : item,
  );

/** What `updateLayout` takes: every item in order, with its width. */
export const toCustomerFormLayoutUpdateItems = (
  items: readonly { key: string; width: CustomerFieldWidth }[],
): CustomerFormLayoutUpdateInput["items"] => items.map(({ key, width }) => ({ key, width }));

// ----------------------------------------------------------------------------
// The storefront's extra block
// ----------------------------------------------------------------------------

/**
 * One item of the storefront's extra block (checkout contact step, account
 * profile) in the owner's layout: an asked Louez field by key, an asked custom
 * field by id. The fields themselves travel next to it.
 */
export const customerExtraLayoutItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("builtin"),
    key: customerProfileFieldKeySchema,
    width: customerFieldWidthSchema,
  }),
  z.object({
    kind: z.literal("custom"),
    key: z.string(),
    width: customerFieldWidthSchema,
  }),
]);

export type CustomerExtraLayoutItem = z.infer<typeof customerExtraLayoutItemSchema>;

/**
 * The extra block of a storefront form: the asked Louez fields and custom
 * fields, interleaved as in the layout. The contact fields the storefront
 * lays out itself (names, e-mail, phone, address, company) are left out.
 */
export const toCustomerExtraLayout = (
  items: readonly CustomerFormLayoutItem<Pick<CustomerFieldDefinition, "id">>[],
  asked: {
    profileFields: readonly { key: CustomerProfileFieldKey }[];
    customerFields: readonly { id: string }[];
  },
): CustomerExtraLayoutItem[] => {
  const profileKeys = new Set<string>(asked.profileFields.map((field) => field.key));
  const customIds = new Set(asked.customerFields.map((field) => field.id));
  return items.flatMap((item): CustomerExtraLayoutItem[] => {
    if (item.kind === "custom") {
      return customIds.has(item.definition.id)
        ? [{ kind: "custom", key: item.definition.id, width: item.width }]
        : [];
    }
    return isCustomerProfileFieldKey(item.key) && profileKeys.has(item.key)
      ? [{ kind: "builtin", key: item.key, width: item.width }]
      : [];
  });
};
