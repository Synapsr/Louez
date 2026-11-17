import type { AddressDetails } from "@louez/types";

interface TypedTextField {
  /** Whether leaving the field replaces the typed text by the lookup's best match. */
  resolvesTypedText: boolean;
  text: string;
  displayAddress: string;
  hasCoordinates: boolean;
  disabled: boolean;
}

/**
 * The address that replaces the typed text when the field is left, or null
 * when the text stays as it was typed. A field that keeps typed text never
 * looks it up: only a suggestion picked from its list replaces it.
 */
export const resolveTypedText = async (
  field: TypedTextField,
  lookup: (query: string) => Promise<AddressDetails | null>,
): Promise<AddressDetails | null> => {
  const query = field.text.trim();
  if (!field.resolvesTypedText || field.disabled || query.length < 3) return null;
  if (field.hasCoordinates && query === field.displayAddress) return null;
  return lookup(query);
};
