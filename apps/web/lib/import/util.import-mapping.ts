import type { ImportColumnMapping, ImportEntityType } from "@louez/types";
import { toImportTarget } from "@louez/validations";

export interface ImportRequirement {
  /** Translation key of what is missing, relative to `dashboard.settings.import`. */
  id: "contact" | "name" | "productName" | "price";
  isMet: boolean;
}

/**
 * What a file must provide before it can be imported. A customer needs a way
 * to be reached (an e-mail or a phone) and a name (a full name to split, or
 * both halves); a product needs a name and a price.
 */
export const getImportRequirements = (
  entity: ImportEntityType,
  mapping: ImportColumnMapping,
): ImportRequirement[] => {
  const targets = new Set(Object.values(mapping));
  if (entity === "products") {
    return [
      { id: "productName", isMet: targets.has("field:name") },
      { id: "price", isMet: targets.has("field:price") },
    ];
  }
  return [
    {
      id: "contact",
      isMet: targets.has(toImportTarget("email")) || targets.has(toImportTarget("phone")),
    },
    {
      id: "name",
      isMet:
        targets.has(toImportTarget("fullName")) ||
        (targets.has(toImportTarget("firstName")) && targets.has(toImportTarget("lastName"))),
    },
  ];
};
