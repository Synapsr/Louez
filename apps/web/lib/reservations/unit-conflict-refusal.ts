/**
 * The status change's refusal when units the reservation holds cannot serve
 * it over its dates (`RESERVATION_UNITS_UNAVAILABLE`): the units' names. Null
 * for any other error. No server import.
 */
export const readUnitConflictRefusal = (error: unknown): { identifiers: string } | null => {
  if (!(error instanceof Error)) return null;
  const data: unknown = "data" in error ? error.data : undefined;
  if (!data || typeof data !== "object" || !("code" in data) || !("details" in data)) return null;
  if (data.code !== "RESERVATION_UNITS_UNAVAILABLE") return null;
  const { details } = data;
  if (!details || typeof details !== "object" || !("conflicts" in details)) return null;
  const conflicts: unknown = details.conflicts;
  if (!Array.isArray(conflicts)) return null;

  const identifiers = conflicts.flatMap((conflict: unknown) =>
    conflict &&
    typeof conflict === "object" &&
    "identifier" in conflict &&
    typeof conflict.identifier === "string"
      ? [conflict.identifier]
      : [],
  );
  return { identifiers: [...new Set(identifiers)].join(", ") };
};
