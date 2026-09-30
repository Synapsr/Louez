import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";
import { formatIdentityValue } from "@louez/validations";

export interface ContractCustomerFieldLine {
  /** Definition id: a stable React key. */
  id: string;
  label: string;
  /** Null for a ticked checkbox: the label alone states the fact. */
  value: string | null;
}

type ContractFieldDefinition = Pick<
  CustomerFieldDefinition,
  "id" | "label" | "type" | "format" | "unit" | "appliesTo" | "showOnContract" | "isActive"
>;

/**
 * The customer's custom fields as printed under their contact details on the
 * contract: only fields the merchant flagged "show on contract", only when the
 * customer has a value. A sensitive field is printed in full: flagging it for
 * the contract is the merchant's explicit choice.
 */
export function getContractCustomerFieldLines(
  definitions: readonly ContractFieldDefinition[],
  values: CustomerFieldValues,
  options: {
    customerType: "individual" | "business";
    /** Formats a stored `yyyy-MM-dd` for the contract's locale. */
    formatDate: (isoDate: string) => string;
    /** Formats a stored number ("80.5") for the contract's locale; kept as stored without it. */
    formatNumber?: (value: number) => string;
  },
): ContractCustomerFieldLine[] {
  const lines: ContractCustomerFieldLine[] = [];

  for (const definition of definitions) {
    if (!definition.isActive || !definition.showOnContract) continue;
    if (definition.appliesTo !== "all" && definition.appliesTo !== options.customerType) continue;

    const stored = values[definition.id]?.trim() ?? "";
    if (stored === "") continue;

    if (definition.type === "checkbox") {
      if (stored === "true")
        lines.push({ id: definition.id, label: definition.label, value: null });
      continue;
    }

    lines.push({
      id: definition.id,
      label: definition.label,
      value: formatContractValue(definition, stored, options),
    });
  }

  return lines;
}

function formatContractValue(
  definition: Pick<ContractFieldDefinition, "type" | "format" | "unit">,
  stored: string,
  {
    formatDate,
    formatNumber,
  }: { formatDate: (isoDate: string) => string; formatNumber?: (value: number) => string },
): string {
  if (definition.type === "date") return formatDate(stored);
  if (definition.type === "number" && formatNumber && Number.isFinite(Number(stored))) {
    const display = formatNumber(Number(stored));
    return definition.unit ? `${display} ${definition.unit}` : display;
  }
  if (definition.type === "phone" || definition.type === "email" || definition.type === "url") {
    return stored;
  }

  // A party block line is a single line: a long text loses its line breaks.
  const display = definition.format
    ? formatIdentityValue(definition.format, stored)
    : stored.replace(/\s+/g, " ");
  return definition.unit ? `${display} ${definition.unit}` : display;
}
