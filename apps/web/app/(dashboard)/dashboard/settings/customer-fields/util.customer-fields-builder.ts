import type {
  CustomerFieldAppliesTo,
  CustomerFieldDefinition,
  CustomerFieldFormat,
  CustomerFieldScope,
  CustomerFieldType,
  CustomerProfileFieldVisibility,
  CustomerProfileSettings,
} from "@louez/types";
import type { CustomerFieldUpdateInput } from "@louez/validations";

import {
  type CustomerFieldSection,
  groupFieldsBySection,
  moveFieldToSection,
  moveItem,
  toReorderPayload,
} from "@/lib/customers/util.customer-fields";

import type { CustomerProfileFieldKey } from "./customer-fields.types";
import {
  type CustomerFieldOnlineSettings,
  patchOnlineSettings,
  pickOnlineSettings,
} from "./util.customer-field-online";

/** A definition as the settings list returns it. */
export type CustomerFieldWithUsage = CustomerFieldDefinition & { valueCount: number };

/** What `update` may change on a field: everything but its id. */
export type CustomerFieldPatch = Omit<CustomerFieldUpdateInput, "id">;

/** A section created on the page. Sections live through their fields, so until its first field is saved only the page knows it. */
export interface LocalSection {
  key: string;
  scope: CustomerFieldScope;
  name: string;
}

export interface CanvasSection<TField> extends CustomerFieldSection<TField> {
  /** Set while the section is one created on the page and still empty. */
  localKey: string | null;
}

const activeOfScope = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  scope: CustomerFieldScope,
) => fields.filter((field) => field.isActive && field.scope === scope);

/**
 * The sections of one scope, as the canvas shows them: those holding active
 * fields in the owner's order, then the ones just created. A new section that
 * got its first field (or was renamed like an existing one) is the saved one.
 */
export const listScopeSections = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  scope: CustomerFieldScope,
  localSections: readonly LocalSection[] = [],
): CanvasSection<TField>[] => {
  const saved = groupFieldsBySection(activeOfScope(fields, scope));
  const savedNames = new Set(saved.map((section) => section.name));
  return [
    ...saved.map((section) => ({ ...section, localKey: null })),
    ...localSections
      .filter((section) => section.scope === scope && !savedNames.has(section.name))
      .map((section) => ({ name: section.name, fields: [], localKey: section.key })),
  ];
};

/** Active fields in the order the forms show them: section after section. */
export const listActiveInFormOrder = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
): TField[] =>
  groupFieldsBySection(fields.filter((field) => field.isActive)).flatMap(
    (section) => section.fields,
  );

/**
 * The reorder payload once one scope's sections changed. `reorder` wants every
 * active field; the other scope keeps its order, placed after the customer
 * record's fields (the two are never shown mixed).
 */
const payloadWith = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  scope: CustomerFieldScope,
  next: readonly CustomerFieldSection<TField>[],
) => {
  const customer =
    scope === "customer" ? next : groupFieldsBySection(activeOfScope(fields, "customer"));
  const item = scope === "item" ? next : groupFieldsBySection(activeOfScope(fields, "item"));
  return toReorderPayload([...customer, ...item]);
};

/** A section's fields in the order they were dropped in. */
export const reorderSectionPayload = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  scope: CustomerFieldScope,
  section: string,
  ordered: readonly TField[],
) =>
  payloadWith(
    fields,
    scope,
    groupFieldsBySection(activeOfScope(fields, scope)).map((entry) =>
      entry.name === section ? { ...entry, fields: [...ordered] } : entry,
    ),
  );

/** A field sent to the end of another section of its scope (created when new). */
export const moveFieldPayload = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  field: Pick<TField, "id" | "scope">,
  target: string,
) =>
  payloadWith(
    fields,
    field.scope,
    moveFieldToSection(groupFieldsBySection(activeOfScope(fields, field.scope)), field.id, target),
  );

/** A section one step up (-1) or down (+1) among the sections of its scope. */
export const moveSectionPayload = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  scope: CustomerFieldScope,
  section: string,
  direction: -1 | 1,
) => {
  const sections = groupFieldsBySection(activeOfScope(fields, scope));
  const from = sections.findIndex((entry) => entry.name === section);
  return payloadWith(fields, scope, moveItem(sections, from, from + direction));
};

/** The list once a reorder applies, so the canvas does not jump back while it saves. */
export const applyReorder = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  payload: readonly { id: string; section: string }[],
): TField[] => {
  const placement = new Map(
    payload.map((entry, index) => [entry.id, { section: entry.section, position: index + 1 }]),
  );
  return fields.map((field) => {
    const next = placement.get(field.id);
    return next ? { ...field, ...next } : field;
  });
};

/** The list once a section is renamed (archived fields follow, as on the server). */
export const applySectionRename = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  from: string,
  to: string,
): TField[] => fields.map((field) => (field.section === from ? { ...field, section: to } : field));

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
    section: patch.section ?? field.section,
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
    ...(patch.section !== undefined && { section: previous.section }),
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
export type CustomerFieldSettingKey = keyof CustomerFieldSettingsValues | "online";

export type CustomerFieldChangeOutcome =
  | { kind: "save"; patch: CustomerFieldPatch }
  /** Nothing to send: the value did not change. */
  | { kind: "none" }
  | { kind: "reject"; reason: "labelRequired" | "optionsRequired" };

/**
 * What an inspector change means for a saved field: the patch to send, or
 * why it is refused before reaching the server (a field keeps a label, a
 * list keeps a choice). Online settings go out as the difference only.
 */
export const toFieldChange = (
  field: CustomerFieldDefinition,
  key: CustomerFieldSettingKey,
  changes: Partial<CustomerFieldSettingsValues>,
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

/** Every setting the inspector edits, texts as strings (empty when unset). */
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

/** A field being created: its settings, plus what is fixed once it exists. */
export interface CustomerFieldFormValues extends CustomerFieldSettingsValues {
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  section: string;
}

/**
 * A new field of this type, in this section: every switch off, and the online
 * settings its section's fields share (`newFieldDefaults`).
 */
export const buildDraftValues = (params: {
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  section: string;
  online: CustomerFieldOnlineSettings;
}): CustomerFieldFormValues => ({
  ...params.online,
  type: params.type,
  scope: params.scope,
  section: params.section,
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

/** The field being created as the canvas draws it, with a placeholder until it is named. */
export const toDraftPreview = (
  values: CustomerFieldFormValues,
  placeholder: string,
): Pick<
  CustomerFieldDefinition,
  | "id"
  | "label"
  | "type"
  | "format"
  | "options"
  | "unit"
  | "helpText"
  | "isRequired"
  | "isSensitive"
  | "isSearchable"
> => ({
  id: "draft",
  label: values.label.trim() || placeholder,
  type: values.type,
  format: values.type === "text" ? values.format : null,
  options: values.options,
  unit: values.unit.trim() || null,
  helpText: values.helpText.trim() || null,
  isRequired: values.scope === "customer" && values.isRequired,
  isSensitive: values.isSensitive,
  isSearchable: false,
});

/** The settings change for one native profile field; social links are never required. */
export const toProfileSettingsPatch = (
  field: CustomerProfileFieldKey,
  visibility: CustomerProfileFieldVisibility,
): CustomerProfileSettings | null => {
  if (field === "birthDate") return { birthDate: visibility };
  if (field === "acquisitionSource") return { acquisitionSource: visibility };
  return visibility === "required" ? null : { socialLinks: visibility };
};

/** "Nouvelle section", then "Nouvelle section 2"… so two new sections never merge. */
export const nextSectionName = (base: string, taken: readonly string[]): string => {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
};

/**
 * Where a field added from the header lands: the last section of its scope,
 * so it shows at the end of the form; the default name when the scope has none.
 */
export const defaultSectionFor = (
  sections: readonly Pick<CanvasSection<unknown>, "name">[],
  fallback: string,
): string => sections.at(-1)?.name ?? fallback;

/** The field a create added: the one the new list holds and the previous did not. */
export const findCreatedField = <TField extends Pick<CustomerFieldDefinition, "id">>(
  before: readonly TField[],
  after: readonly TField[],
): TField | null => {
  const known = new Set(before.map((field) => field.id));
  return after.find((field) => !known.has(field.id)) ?? null;
};

/**
 * The "Demander au client" list: active fields the checkout does not ask yet,
 * per scope. Those asked while the list is open stay in place (`justAsked`),
 * so a row does not vanish under the pointer.
 */
export const listAskableFields = <TField extends CustomerFieldDefinition>(
  fields: readonly TField[],
  justAsked: ReadonlySet<string> = new Set(),
): { customer: TField[]; item: TField[] } => {
  const askable = fields.filter(
    (field) => field.isActive && (field.collectMode === "never" || justAsked.has(field.id)),
  );
  return {
    customer: askable.filter((field) => field.scope === "customer"),
    item: askable.filter((field) => field.scope === "item"),
  };
};
