import {
  CUSTOMER_PROFILE_FIELD_KEYS,
  type CustomerFieldAppliesTo,
  type CustomerFieldCollectMode,
  type CustomerFieldDefinition,
  type CustomerProfileFieldKey,
  type CustomerProfileFieldSettings,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";

import { type CustomerFieldTargeting, describeTargeting } from "./util.customer-field-online";

/** A field of the canvas the owner can select: one of the store's own, or a Louez profile field. */
export type CanvasFieldRef =
  | { kind: "field"; id: string }
  | { kind: "profile"; key: CustomerProfileFieldKey };

/** How a field is marked in the DOM (`data-canvas-field`), the field being created included. */
export const toCanvasFieldKey = (ref: CanvasFieldRef | { kind: "draft" }): string => {
  switch (ref.kind) {
    case "field":
      return `field:${ref.id}`;
    case "profile":
      return `profile:${ref.key}`;
    case "draft":
      return "draft";
  }
};

export const isSameCanvasField = (
  selection: CanvasFieldRef | { kind: "draft" } | null,
  ref: CanvasFieldRef,
): boolean => selection !== null && toCanvasFieldKey(selection) === toCanvasFieldKey(ref);

/** Social links can be shown or hidden, never required (by the team or online). */
export const profileFieldAllowsRequired = (key: CustomerProfileFieldKey): boolean =>
  key !== "socialLinks";

/**
 * What the badges line under a field says, the same way for a store field and
 * a Louez one. A hidden field only says so: nothing else applies to it.
 */
export interface CanvasFieldFlags {
  /** A Louez profile field: its name and type are fixed. */
  louez: boolean;
  hidden: boolean;
  required: boolean;
  sensitive: boolean;
  collectMode: CustomerFieldCollectMode;
  appliesTo: CustomerFieldAppliesTo;
  targeting: CustomerFieldTargeting;
}

const HIDDEN_FLAGS = {
  hidden: true,
  required: false,
  sensitive: false,
  collectMode: "never",
  appliesTo: "all",
  targeting: { kind: "irrelevant" },
} as const satisfies Omit<CanvasFieldFlags, "louez">;

export const customFieldFlags = (field: CustomerFieldDefinition): CanvasFieldFlags => {
  if (!field.isActive) return { louez: false, ...HIDDEN_FLAGS };
  const isCustomer = field.scope === "customer";
  return {
    louez: false,
    hidden: false,
    required: isCustomer && field.isRequired,
    sensitive: field.isSensitive,
    collectMode: field.collectMode,
    appliesTo: isCustomer ? field.appliesTo : "all",
    targeting: describeTargeting(field),
  };
};

export const profileFieldFlags = (settings: CustomerProfileFieldSettings): CanvasFieldFlags => {
  if (settings.visibility === "hidden") return { louez: true, ...HIDDEN_FLAGS };
  return {
    louez: true,
    hidden: false,
    required: settings.visibility === "required",
    sensitive: false,
    collectMode: settings.collectMode,
    appliesTo: "all",
    targeting: describeTargeting({ scope: "customer", ...settings }),
  };
};

/**
 * The Louez profile fields "Demander un champ au client" offers: shown on the
 * record and not asked yet. Those asked while the list is open stay listed.
 */
export const listAskableProfileFields = (
  settings: ResolvedCustomerProfileSettings,
  justAsked: ReadonlySet<string> = new Set(),
): CustomerProfileFieldKey[] =>
  CUSTOMER_PROFILE_FIELD_KEYS.filter(
    (key) =>
      settings[key].visibility !== "hidden" &&
      (settings[key].collectMode === "never" || justAsked.has(key)),
  );
