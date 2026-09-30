import type {
  CustomerProfileFieldKey,
  CustomerProfileFieldSettings,
  CustomerProfileFieldVisibility,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  type CustomerProfileFieldUpdateInput,
  mergeCustomerProfileFieldSettings,
} from "@louez/validations";

/** What `updateProfileField` may change on a Louez profile field. */
export type CustomerProfileFieldPatch = Omit<CustomerProfileFieldUpdateInput, "field">;

/**
 * The stored visibility behind the record switches: "Afficher sur la fiche"
 * hides or shows, "Obligatoire pour l'équipe" makes a shown field required.
 * Shown again, a field comes back optional.
 */
export const toProfileVisibility = (
  change: { shown: boolean } | { required: boolean },
): CustomerProfileFieldVisibility => {
  if ("shown" in change) return change.shown ? "optional" : "hidden";
  return change.required ? "required" : "optional";
};

const withField = (
  settings: ResolvedCustomerProfileSettings,
  field: CustomerProfileFieldKey,
  next: CustomerProfileFieldSettings,
): ResolvedCustomerProfileSettings => ({
  birthDate: field === "birthDate" ? next : settings.birthDate,
  acquisitionSource: field === "acquisitionSource" ? next : settings.acquisitionSource,
  socialLinks: field === "socialLinks" ? next : settings.socialLinks,
});

/**
 * The settings once a patch applies, the way the server stores them (hiding
 * stops asking, "Non" takes the customer's edit right). A patch the server
 * would refuse leaves them as they are.
 */
export const applyProfileFieldPatch = (
  settings: ResolvedCustomerProfileSettings,
  field: CustomerProfileFieldKey,
  patch: CustomerProfileFieldPatch,
): ResolvedCustomerProfileSettings => {
  const next = mergeCustomerProfileFieldSettings(field, settings[field], patch);
  return next ? withField(settings, field, next) : settings;
};

/**
 * What a refused update puts back, and only that: a later change to another
 * setting of the same field stays. Visibility and "Demander au client" move
 * the customer's edit right with them, so it comes back too.
 */
export const revertProfileFieldPatch = (
  settings: ResolvedCustomerProfileSettings,
  field: CustomerProfileFieldKey,
  previous: CustomerProfileFieldSettings,
  patch: CustomerProfileFieldPatch,
): ResolvedCustomerProfileSettings => {
  const touchesAsking =
    patch.visibility !== undefined ||
    patch.collectMode !== undefined ||
    patch.customerEditable !== undefined;
  return withField(settings, field, {
    ...settings[field],
    ...(patch.visibility !== undefined && { visibility: previous.visibility }),
    ...(touchesAsking && {
      collectMode: previous.collectMode,
      customerEditable: previous.customerEditable,
    }),
    ...(patch.targetMode !== undefined && { targetMode: previous.targetMode }),
    ...(patch.targets !== undefined && { targets: previous.targets }),
  });
};
