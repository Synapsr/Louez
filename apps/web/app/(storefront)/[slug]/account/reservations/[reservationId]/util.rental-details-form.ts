import {
  validateItemDetailUnits,
  type CustomerFieldIssueCode,
  type ReservationItemDetailIssue,
  type ReservationItemDetailsUpdateInput,
} from "@louez/validations";

import type {
  RentalDetailsData,
  RentalDetailsFormValues,
  RentalDetailsItem,
} from "./reservation-rental-details.types";

/** Key of one rented unit in the form. */
export const toRentalUnitKey = (reservationItemId: string, unitIndex: number): string =>
  `${reservationItemId}~${unitIndex}`;

export type RentalUnitValueName = `units.${string}.values.${string}`;

export const toRentalUnitValueName = (unitKey: string, definitionId: string): RentalUnitValueName =>
  `units.${unitKey}.values.${definitionId}`;

/** The fields of a line the customer may change themselves. */
export const getEditableFields = (item: RentalDetailsItem) =>
  item.fields.filter((field) => field.customerEditable);

/** "Modifier" is offered while the rental has not started and something is the customer's to change. */
export const canEditRentalDetails = (data: RentalDetailsData): boolean =>
  data.editable && data.items.some((item) => getEditableFields(item).length > 0);

export const getRentalDetailsDefaultValues = (
  items: readonly RentalDetailsItem[],
): RentalDetailsFormValues => ({
  units: Object.fromEntries(
    items.flatMap((item) =>
      item.units.map((unit) => [
        toRentalUnitKey(item.reservationItemId, unit.unitIndex),
        { participantName: unit.participantName ?? "", values: { ...unit.values } },
      ]),
    ),
  ),
});

const toUnitSubmission = (
  item: RentalDetailsItem,
  values: RentalDetailsFormValues,
  unitIndex: number,
) => {
  const unit = values.units[toRentalUnitKey(item.reservationItemId, unitIndex)];
  return {
    unitIndex,
    participantName: unit?.participantName?.trim() ?? "",
    values: Object.fromEntries(
      getEditableFields(item).flatMap((field) => {
        const value = unit?.values?.[field.id]?.trim();
        return value ? [[field.id, value]] : [];
      }),
    ),
  };
};

/**
 * `updateReservationDetails` input: every unit of each line holding an
 * editable field. A unit sent is replaced for those fields (a key left out
 * clears it), so all units go, blank ones included. Lines without an editable
 * field are left out: the server refuses them.
 */
export const buildRentalDetailsUpdate = (
  reservationId: string,
  items: readonly RentalDetailsItem[],
  values: RentalDetailsFormValues,
): ReservationItemDetailsUpdateInput => ({
  reservationId,
  items: items
    .filter((item) => getEditableFields(item).length > 0)
    .map((item) => ({
      reservationItemId: item.reservationItemId,
      units: Array.from({ length: item.quantity }, (_, unitIndex) =>
        toUnitSubmission(item, values, unitIndex),
      ),
    })),
});

/** Values the server would refuse, with their form path: the same shared rules, required ones enforced. */
export const getRentalDetailsIssues = (
  items: readonly RentalDetailsItem[],
  values: RentalDetailsFormValues,
): { path: string[]; code: CustomerFieldIssueCode }[] =>
  items.flatMap((item) => {
    const fields = getEditableFields(item);
    if (fields.length === 0) return [];
    const { issues } = validateItemDetailUnits({
      fields,
      quantity: item.quantity,
      units: Array.from({ length: item.quantity }, (_, unitIndex) =>
        toUnitSubmission(item, values, unitIndex),
      ),
      enforceRequired: true,
    });
    return issues.map((issue) => ({
      path: [
        "units",
        toRentalUnitKey(item.reservationItemId, issue.unitIndex),
        "values",
        issue.definitionId,
      ],
      code: issue.code,
    }));
  });

/** The input a server refusal belongs to. */
export const getRentalDetailsIssueName = (issue: ReservationItemDetailIssue): RentalUnitValueName =>
  toRentalUnitValueName(
    toRentalUnitKey(issue.reservationItemId, issue.unitIndex),
    issue.definitionId,
  );
