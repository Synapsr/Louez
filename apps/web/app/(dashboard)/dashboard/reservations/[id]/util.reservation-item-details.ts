import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ReservationItemDetail,
} from "@louez/types";
import type {
  CustomerFieldIssueCode,
  ReservationItemDetailIssue,
  ReservationItemDetailsUpdateInput,
} from "@louez/validations";

type DetailField = Pick<CustomerFieldDefinition, "id" | "collectMode">;

/** One reservation line as `dashboard.reservationDetails.itemDetails` returns it. */
export interface ItemDetailsLine<TField extends DetailField> {
  reservationItemId: string;
  productName: string;
  quantity: number;
  fields: readonly TField[];
  units: readonly ReservationItemDetail[];
}

/**
 * Units that still exist on the line. A quantity lowered after the details
 * were recorded leaves rows past the new quantity in the table: they are
 * history, never something to prepare or edit.
 */
const currentUnits = <TField extends DetailField>(line: ItemDetailsLine<TField>) =>
  line.units.filter((unit) => unit.unitIndex >= 0 && unit.unitIndex < line.quantity);

/** Fields the checkout asks as required that this unit still lacks. */
export const getMissingRequiredFieldIds = (
  fields: readonly DetailField[],
  values: CustomerFieldValues,
): string[] =>
  fields
    .filter((field) => field.collectMode === "required" && !values[field.id]?.trim())
    .map((field) => field.id);

/** "1/2" when the line rents several units; a single unit needs no position. */
export const getUnitPosition = (unitIndex: number, quantity: number): string | null =>
  quantity > 1 ? `${unitIndex + 1}/${quantity}` : null;

export interface ItemDetailRow<TField extends DetailField> {
  key: string;
  productName: string;
  position: string | null;
  participantName: string | null;
  /**
   * Recorded values in the fields' order, plus the fields the checkout asks
   * as required that are still empty (`value: null`): staff see what to ask
   * for without opening the sheet. Other empty fields are left out.
   */
  entries: { field: TField; value: string | null }[];
  /** A field the checkout asks as required is still empty. */
  isIncomplete: boolean;
}

/** One row per rented unit, lines then units in order, as staff read them while preparing. */
export const getItemDetailRows = <TField extends DetailField>(
  lines: readonly ItemDetailsLine<TField>[],
): ItemDetailRow<TField>[] =>
  lines.flatMap((line) =>
    currentUnits(line).map((unit) => {
      const missing = new Set(getMissingRequiredFieldIds(line.fields, unit.values));
      return {
        key: `${line.reservationItemId}:${unit.unitIndex}`,
        productName: line.productName,
        position: getUnitPosition(unit.unitIndex, line.quantity),
        participantName: unit.participantName,
        entries: line.fields.flatMap((field): ItemDetailRow<TField>["entries"] => {
          const value = unit.values[field.id]?.trim();
          if (value) return [{ field, value }];
          return missing.has(field.id) ? [{ field, value: null }] : [];
        }),
        isIncomplete: missing.size > 0,
      };
    }),
  );

// ----------------------------------------------------------------------------
// Edit sheet
// ----------------------------------------------------------------------------

export interface ItemDetailsFormUnit {
  unitIndex: number;
  participantName: string;
  values: CustomerFieldValues;
}

export interface ItemDetailsFormValues {
  items: { reservationItemId: string; units: ItemDetailsFormUnit[] }[];
}

export const toItemDetailsFormValues = <TField extends DetailField>(
  lines: readonly ItemDetailsLine<TField>[],
): ItemDetailsFormValues => ({
  items: lines.map((line) => ({
    reservationItemId: line.reservationItemId,
    units: currentUnits(line).map((unit) => ({
      unitIndex: unit.unitIndex,
      participantName: unit.participantName ?? "",
      values: Object.fromEntries(
        line.fields.map((field) => [field.id, unit.values[field.id] ?? ""]),
      ),
    })),
  })),
});

const sameUnit = (left: ItemDetailsFormUnit, right: ItemDetailsFormUnit) =>
  left.participantName.trim() === right.participantName.trim() &&
  Object.keys({ ...left.values, ...right.values }).every(
    (key) => (left.values[key] ?? "").trim() === (right.values[key] ?? "").trim(),
  );

/**
 * Only the units staff touched: the server replaces each unit it receives,
 * so leaving the others out keeps what a customer may have recorded from
 * their account in the meantime. Null when nothing changed.
 */
export const toItemDetailsUpdateInput = (
  reservationId: string,
  initial: ItemDetailsFormValues,
  current: ItemDetailsFormValues,
): ReservationItemDetailsUpdateInput | null => {
  const items = current.items.flatMap((item) => {
    const before = initial.items.find(
      (candidate) => candidate.reservationItemId === item.reservationItemId,
    );
    const units = item.units.filter((unit) => {
      const previous = before?.units.find((candidate) => candidate.unitIndex === unit.unitIndex);
      return !previous || !sameUnit(previous, unit);
    });
    return units.length > 0 ? [{ reservationItemId: item.reservationItemId, units }] : [];
  });
  return items.length > 0 ? { reservationId, items } : null;
};

/** Where a server issue belongs in the sheet: one field of one unit of one line. */
export const getItemDetailIssueKey = (
  reservationItemId: string,
  unitIndex: number,
  definitionId: string,
) => `${reservationItemId}:${unitIndex}:${definitionId}`;

export const indexItemDetailIssues = (
  issues: readonly ReservationItemDetailIssue[],
): Record<string, CustomerFieldIssueCode> =>
  Object.fromEntries(
    issues.map((issue) => [
      getItemDetailIssueKey(issue.reservationItemId, issue.unitIndex, issue.definitionId),
      issue.code,
    ]),
  );
