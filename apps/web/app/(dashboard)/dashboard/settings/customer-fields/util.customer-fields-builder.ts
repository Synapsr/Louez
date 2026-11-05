import type {
  CustomerFieldAppliesTo,
  CustomerFieldDefinition,
  CustomerFieldFormat,
  CustomerFieldScope,
  CustomerFieldType,
  CustomerFieldWidth,
} from "@louez/types";
import { type CustomerFieldUpdateInput, defaultCustomerFieldWidth } from "@louez/validations";

import {
  type CustomerFieldOnlineSettings,
  patchOnlineSettings,
  pickOnlineSettings,
} from "./util.customer-field-online";

/** A definition as the settings list returns it. */
export type CustomerFieldWithUsage = CustomerFieldDefinition & { valueCount: number };

/** What `update` may change on a field: everything but its id. */
export type CustomerFieldPatch = Omit<CustomerFieldUpdateInput, "id">;

/**
 * A field once an `update` applies, the way the server stores it: empty texts
 * become null, and a field no longer asked cannot stay editable by the customer.
 */
export const patchDefinition = <TField extends CustomerFieldDefinition>(
  field: TField,
  patch: CustomerFieldPatch,
): TField => {
  const online = patchOnlineSettings(pickOnlineSettings(field), {
    ...(patch.collectMode !== undefined && { collectMode: patch.collectMode }),
    ...(patch.targetMode !== undefined && { targetMode: patch.targetMode }),
    ...(patch.targets !== undefined && { targets: patch.targets }),
    ...(patch.customerEditable !== undefined && { customerEditable: patch.customerEditable }),
  });
  return {
    ...field,
    ...online,
    label: patch.label ?? field.label,
    helpText: patch.helpText === undefined ? field.helpText : patch.helpText || null,
    unit: patch.unit === undefined ? field.unit : patch.unit || null,
    format: patch.format === undefined ? field.format : (patch.format ?? null),
    options: patch.options === undefined ? field.options : (patch.options ?? null),
    appliesTo: patch.appliesTo ?? field.appliesTo,
    isRequired: patch.isRequired ?? field.isRequired,
    isSensitive: patch.isSensitive ?? field.isSensitive,
    showOnContract: patch.showOnContract ?? field.showOnContract,
    isSearchable: patch.isSearchable ?? field.isSearchable,
    showInList: patch.showInList ?? field.showInList,
    isActive: patch.isActive ?? field.isActive,
  };
};

/**
 * The patch that puts back what a failed `update` changed, and only that: a
 * later change to another setting of the same field stays. Turning "ask the
 * customer" off also took the customer's edit right, so both come back.
 */
export const revertPatch = (
  previous: CustomerFieldDefinition,
  patch: CustomerFieldPatch,
): CustomerFieldPatch => {
  const touchesOnline = patch.collectMode !== undefined || patch.customerEditable !== undefined;
  return {
    ...(patch.label !== undefined && { label: previous.label }),
    ...(patch.helpText !== undefined && { helpText: previous.helpText }),
    ...(patch.unit !== undefined && { unit: previous.unit }),
    ...(patch.format !== undefined && { format: previous.format }),
    ...(patch.options !== undefined && { options: previous.options }),
    ...(patch.appliesTo !== undefined && { appliesTo: previous.appliesTo }),
    ...(patch.isRequired !== undefined && { isRequired: previous.isRequired }),
    ...(patch.isSensitive !== undefined && { isSensitive: previous.isSensitive }),
    ...(patch.showOnContract !== undefined && { showOnContract: previous.showOnContract }),
    ...(patch.isSearchable !== undefined && { isSearchable: previous.isSearchable }),
    ...(patch.showInList !== undefined && { showInList: previous.showInList }),
    ...(patch.isActive !== undefined && { isActive: previous.isActive }),
    ...(patch.targetMode !== undefined && { targetMode: previous.targetMode }),
    ...(patch.targets !== undefined && { targets: previous.targets }),
    ...(touchesOnline && {
      collectMode: previous.collectMode,
      customerEditable: previous.customerEditable,
    }),
  };
};

/** Only the online settings that changed, so an autosave sends one decision, not four. */
export const diffOnlineSettings = (
  current: CustomerFieldOnlineSettings,
  next: CustomerFieldOnlineSettings,
): Partial<CustomerFieldOnlineSettings> => {
  const sameTargets =
    current.targets.length === next.targets.length &&
    current.targets.every(
      (target, index) =>
        target.type === next.targets[index]?.type && target.id === next.targets[index]?.id,
    );
  return {
    ...(current.collectMode !== next.collectMode && { collectMode: next.collectMode }),
    ...(current.targetMode !== next.targetMode && { targetMode: next.targetMode }),
    ...(!sameTargets && { targets: next.targets }),
    ...(current.customerEditable !== next.customerEditable && {
      customerEditable: next.customerEditable,
    }),
  };
};

/** Which control a change came from, to put its error right under it. */
export type CustomerFieldSettingKey = keyof CustomerFieldSettingsValues | "isActive" | "online";

/** What one control of the Sheet changes on a saved field; "Afficher sur la fiche" is `isActive`. */
export type CustomerFieldSettingsChanges = Partial<
  CustomerFieldSettingsValues & Pick<CustomerFieldDefinition, "isActive">
>;

export type CustomerFieldChangeOutcome =
  | { kind: "save"; patch: CustomerFieldPatch }
  /** Nothing to send: the value did not change. */
  | { kind: "none" }
  | { kind: "reject"; reason: "labelRequired" | "optionsRequired" };

/**
 * What a change in the Sheet means for a saved field: the patch to send, or
 * why it is refused before reaching the server (a field keeps a label, a
 * list keeps a choice). Online settings go out as the difference only.
 */
export const toFieldChange = (
  field: CustomerFieldDefinition,
  key: CustomerFieldSettingKey,
  changes: CustomerFieldSettingsChanges,
): CustomerFieldChangeOutcome => {
  if (key === "online") {
    const current = pickOnlineSettings(field);
    const patch = diffOnlineSettings(current, { ...current, ...changes });
    return Object.keys(patch).length === 0 ? { kind: "none" } : { kind: "save", patch };
  }
  if (changes.label !== undefined) {
    const label = changes.label.trim();
    if (!label) return { kind: "reject", reason: "labelRequired" };
    return label === field.label ? { kind: "none" } : { kind: "save", patch: { label } };
  }
  if (changes.options !== undefined && changes.options.length === 0) {
    return { kind: "reject", reason: "optionsRequired" };
  }
  if (changes.helpText !== undefined) {
    const helpText = changes.helpText.trim();
    return helpText === (field.helpText ?? "")
      ? { kind: "none" }
      : { kind: "save", patch: { helpText } };
  }
  if (changes.unit !== undefined) {
    const unit = changes.unit.trim();
    return unit === (field.unit ?? "") ? { kind: "none" } : { kind: "save", patch: { unit } };
  }
  return { kind: "save", patch: changes };
};

/** Every setting the Sheet edits, texts as strings (empty when unset). */
export interface CustomerFieldSettingsValues extends CustomerFieldOnlineSettings {
  label: string;
  helpText: string;
  options: string[];
  unit: string;
  format: CustomerFieldFormat | null;
  appliesTo: CustomerFieldAppliesTo;
  isRequired: boolean;
  isSensitive: boolean;
  showOnContract: boolean;
  isSearchable: boolean;
  showInList: boolean;
}

export const toSettingsValues = (field: CustomerFieldDefinition): CustomerFieldSettingsValues => ({
  ...pickOnlineSettings(field),
  label: field.label,
  helpText: field.helpText ?? "",
  options: field.options ?? [],
  unit: field.unit ?? "",
  format: field.format,
  appliesTo: field.appliesTo,
  isRequired: field.isRequired,
  isSensitive: field.isSensitive,
  showOnContract: field.showOnContract,
  isSearchable: field.isSearchable,
  showInList: field.showInList,
});

/** A field being created: its settings, plus what is fixed once it exists, and its width. */
export interface CustomerFieldFormValues extends CustomerFieldSettingsValues {
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  /** Where it lands in the form: its row alone, or half of it. Saved with the field. */
  width: CustomerFieldWidth;
}

/**
 * A new field of this type: every switch off, the online settings given
 * (never asked, for every reservation), and the width its type takes by
 * default (a long text alone on its row).
 */
export const buildDraftValues = (params: {
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  online: CustomerFieldOnlineSettings;
}): CustomerFieldFormValues => ({
  ...params.online,
  type: params.type,
  scope: params.scope,
  width: defaultCustomerFieldWidth(params.type),
  label: "",
  helpText: "",
  options: [],
  unit: "",
  format: null,
  appliesTo: "all",
  isRequired: false,
  isSensitive: false,
  showOnContract: false,
  isSearchable: false,
  showInList: false,
});

/** The field being created as its row draws it, with a placeholder until it is named. */
export const toDraftPreview = (
  values: CustomerFieldFormValues,
  placeholder: string,
): Pick<CustomerFieldDefinition, "label" | "type" | "unit" | "helpText"> => ({
  label: values.label.trim() || placeholder,
  type: values.type,
  unit: values.unit.trim() || null,
  helpText: values.helpText.trim() || null,
});

/**
 * The fields an adoption added: those of the template the new list holds and
 * the previous did not. A template field the store already had (a rider's
 * height shared by skis and bikes) stays as the owner set it, so it is not one.
 */
export const findAdoptedFields = <
  TField extends Pick<CustomerFieldDefinition, "id" | "templateKey">,
>(
  before: readonly TField[],
  after: readonly TField[],
  templateId: string,
): TField[] => {
  const known = new Set(before.map((field) => field.id));
  return after.filter((field) => field.templateKey === templateId && !known.has(field.id));
};
