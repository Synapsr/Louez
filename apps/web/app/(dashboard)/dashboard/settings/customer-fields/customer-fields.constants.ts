import type { CustomerFieldType, CustomerProfileFieldKey } from "@louez/types";

/** Prefix of the draft inspector's control ids. */
export const DRAFT_FIELD_ID_PREFIX = "inspector-draft";

/**
 * The draft's label input. The picker that just closed and the sheet that
 * opens both hand focus to it, so typing the name comes right after the type.
 */
export const DRAFT_LABEL_INPUT_ID = `${DRAFT_FIELD_ID_PREFIX}-label`;

/** The type each Louez profile field reads as: its icon, and its "Type" in the inspector. */
export const PROFILE_FIELD_TYPES: Record<CustomerProfileFieldKey, CustomerFieldType> = {
  birthDate: "date",
  acquisitionSource: "select",
  socialLinks: "url",
};

/** Marks the inspector (drawer or sheet): closing from inside it hands focus back to the field. */
export const FIELD_INSPECTOR_ATTRIBUTE = "data-field-inspector";

/** Marks the button that selects a field on the canvas, by `toCanvasFieldKey`. */
export const CANVAS_FIELD_ATTRIBUTE = "data-canvas-field";
