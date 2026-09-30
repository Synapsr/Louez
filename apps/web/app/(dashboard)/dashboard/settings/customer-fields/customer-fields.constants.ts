import type { CustomerFieldType, CustomerProfileFieldKey } from "@louez/types";

/** Prefix of the draft Sheet's control ids. */
export const DRAFT_FIELD_ID_PREFIX = "sheet-draft";

/**
 * The draft's label input. The type picker that just closed and the Sheet
 * that opens both hand focus to it, so typing the name comes right after the type.
 */
export const DRAFT_LABEL_INPUT_ID = `${DRAFT_FIELD_ID_PREFIX}-label`;

/** The type each Louez profile field reads as: its icon in the Sheet. */
export const PROFILE_FIELD_TYPES: Record<CustomerProfileFieldKey, CustomerFieldType> = {
  birthDate: "date",
  acquisitionSource: "select",
  socialLinks: "url",
};
