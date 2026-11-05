import type { CustomerFieldDefinition, ReservationItemDetail } from "@louez/types";

import { getContractCustomerFieldLines } from "./util.contract-customer-fields";

export interface ContractItemDetailLine {
  /** `<reservationItemId>:<unitIndex>`: a stable React key. */
  id: string;
  /** "Léa — Taille : 172 cm · Pointure : 38" */
  text: string;
}

type ContractItemField = Pick<
  CustomerFieldDefinition,
  "id" | "label" | "type" | "format" | "unit" | "showOnContract" | "isActive"
>;

/** One reservation line as `listReservationItemDetails` reads it for the team. */
export interface ContractItemDetailsSource {
  reservationItemId: string;
  quantity: number;
  fields: readonly ContractItemField[];
  units: readonly ReservationItemDetail[];
}

/**
 * The per-unit details printed under each equipment line of the contract,
 * keyed by reservation item id: only fields flagged "show on contract", one
 * line per unit that has something to print. The participant's name leads
 * the line; without one, "2/3" tells units of the same line apart.
 */
export function getContractItemDetailLines(
  sources: readonly ContractItemDetailsSource[],
  options: {
    /** Formats a stored `yyyy-MM-dd` for the contract's locale. */
    formatDate: (isoDate: string) => string;
    formatNumber?: (value: number) => string;
  },
): Map<string, ContractItemDetailLine[]> {
  const linesByItem = new Map<string, ContractItemDetailLine[]>();

  for (const source of sources) {
    // "Applies to" is a customer-record notion: every unit of the line carries these fields.
    const fields = source.fields
      .filter((field) => field.isActive && field.showOnContract)
      .map((field): ContractItemField & Pick<CustomerFieldDefinition, "appliesTo"> => ({
        ...field,
        appliesTo: "all",
      }));
    // Nothing flagged for the contract: the store did not ask for these details on paper.
    if (fields.length === 0) continue;

    const lines: ContractItemDetailLine[] = [];
    for (const unit of source.units) {
      // Units past a lowered quantity are history, not rented equipment.
      if (unit.unitIndex < 0 || unit.unitIndex >= source.quantity) continue;

      const values = getContractCustomerFieldLines(fields, unit.values, {
        customerType: "individual",
        formatDate: options.formatDate,
        formatNumber: options.formatNumber,
      }).map((line) => (line.value === null ? line.label : `${line.label} : ${line.value}`));
      const name = unit.participantName?.trim() ?? "";
      if (values.length === 0 && name === "") continue;

      const who = name || (source.quantity > 1 ? `${unit.unitIndex + 1}/${source.quantity}` : "");
      lines.push({
        id: `${source.reservationItemId}:${unit.unitIndex}`,
        text: [who, values.join(" · ")].filter(Boolean).join(" — "),
      });
    }

    if (lines.length > 0) linesByItem.set(source.reservationItemId, lines);
  }

  return linesByItem;
}
