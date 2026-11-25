import type { BookingAttributeAxis } from "@louez/types";
import { getSortedAxes, isPooledCombinationKey } from "@louez/utils";

export interface LineAttribute {
  key: string;
  label: string;
  /** The value booked, or null for an axis the customer left open. */
  value: string | null;
}

/**
 * What a booked line shows of the product's options: the values it booked,
 * in the order of the product's axes, then any value from an axis the
 * product no longer has. A line of a tracked product that booked no exact
 * combination (a choice left open) also lists each axis it left open,
 * without a value: the store picks the unit, so no size or colour is shown
 * as the customer's.
 */
export const describeLineAttributes = (line: {
  selectedAttributes: Record<string, string> | null | undefined;
  combinationKey: string | null | undefined;
  axes: BookingAttributeAxis[] | null | undefined;
  trackUnits: boolean | null | undefined;
}): LineAttribute[] => {
  const sortedAxes = getSortedAxes(line.axes);
  const chosen = Object.fromEntries(
    Object.entries(line.selectedAttributes ?? {}).flatMap(([key, value]) =>
      typeof value === "string" && value.trim() ? [[key, value.trim()] as const] : [],
    ),
  );
  const open =
    Boolean(line.trackUnits) &&
    sortedAxes.length > 0 &&
    (line.combinationKey == null || isPooledCombinationKey(sortedAxes, line.combinationKey));

  const onAxes = sortedAxes.flatMap((axis): LineAttribute[] => {
    const value = chosen[axis.key];
    if (value) return [{ key: axis.key, label: axis.label, value }];
    return open ? [{ key: axis.key, label: axis.label, value: null }] : [];
  });
  const axisKeys = new Set(sortedAxes.map((axis) => axis.key));
  const others = Object.keys(chosen)
    .filter((key) => !axisKeys.has(key))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((key) => ({ key, label: key, value: chosen[key] ?? null }));

  return [...onAxes, ...others];
};
