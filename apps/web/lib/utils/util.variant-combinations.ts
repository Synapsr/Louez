import type { BookingAttributeAxis, CombinationAvailability, UnitAttributes } from "@louez/types";
import {
  buildCombinationKey,
  getDeterministicCombinationSortValue,
  getSortedAxes,
} from "@louez/utils";

import type { StorefrontProductUnit } from "@/lib/storefront/storefront.types";

/** A unit the customer can book right now: active and not in downtime. */
export const isBookableUnit = (
  unit: Pick<StorefrontProductUnit, "lifecycleStatus" | "inDowntimeNow">,
): boolean => (unit.lifecycleStatus ?? "active") === "active" && !unit.inDowntimeNow;

const compareCombinations =
  (axes: BookingAttributeAxis[]) =>
  (a: CombinationAvailability, b: CombinationAvailability): number =>
    getDeterministicCombinationSortValue(axes, a.selectedAttributes).localeCompare(
      getDeterministicCombinationSortValue(axes, b.selectedAttributes),
      "en",
    );

/**
 * Counts the bookable units per attribute combination, in deterministic
 * order. This is the client fallback when the availability call has not
 * answered yet, so nothing is reserved and every combination is "available".
 */
export const groupUnitsIntoCombinations = (
  axes: BookingAttributeAxis[],
  units: readonly StorefrontProductUnit[],
): CombinationAvailability[] => {
  const byKey = new Map<
    string,
    { selectedAttributes: UnitAttributes; availableQuantity: number }
  >();

  for (const unit of units) {
    if (!isBookableUnit(unit)) continue;

    const selectedAttributes = unit.attributes ?? {};
    const combinationKey = buildCombinationKey(axes, selectedAttributes);
    const current = byKey.get(combinationKey);

    if (current) {
      current.availableQuantity += 1;
    } else {
      byKey.set(combinationKey, { selectedAttributes, availableQuantity: 1 });
    }
  }

  return [...byKey.entries()]
    .map(
      ([combinationKey, { selectedAttributes, availableQuantity }]): CombinationAvailability => ({
        combinationKey,
        selectedAttributes,
        availableQuantity,
        totalQuantity: availableQuantity,
        reservedQuantity: 0,
        status: "available",
      }),
    )
    .sort(compareCombinations(axes));
};

export interface AttributeValueSources {
  /**
   * Combinations from the availability call for the selected period; only
   * those with stock count. When present, they are the only source: a value
   * whose units are all reserved must not be selectable.
   */
  combinations?: readonly Pick<
    CombinationAvailability,
    "selectedAttributes" | "availableQuantity"
  >[];
  /**
   * Units known client-side; only bookable ones count. Read only while the
   * availability call has not answered (no period, or still loading).
   */
  units?: readonly StorefrontProductUnit[];
}

const addTrimmed = (values: Set<string>, value: string | undefined): void => {
  const trimmed = value?.trim();
  if (trimmed) values.add(trimmed);
};

/**
 * Selectable values per axis, as the variant selectors list them, sorted.
 * The sources are exclusive: once the availability call has answered for the
 * period, only its combinations with stock are listed; before that, the
 * bookable units are.
 */
export const deriveAttributeValues = (
  axes: BookingAttributeAxis[],
  { combinations, units = [] }: AttributeValueSources,
): Record<string, string[]> => {
  const result: Record<string, string[]> = {};

  for (const axis of getSortedAxes(axes)) {
    const values = new Set<string>();

    if (combinations) {
      for (const combination of combinations) {
        if (combination.availableQuantity <= 0) continue;
        addTrimmed(values, combination.selectedAttributes?.[axis.key]);
      }
    } else {
      for (const unit of units) {
        if (!isBookableUnit(unit)) continue;
        addTrimmed(values, unit.attributes?.[axis.key]);
      }
    }

    result[axis.key] = [...values].sort((a, b) => a.localeCompare(b, "en"));
  }

  return result;
};

/**
 * Axes for a product that tracks units but never declared any: one axis per
 * attribute key found on its units, labelled by the key, in alphabetical
 * order.
 */
export const inferAttributeAxesFromUnits = (
  units: readonly Pick<StorefrontProductUnit, "attributes">[],
): BookingAttributeAxis[] => {
  const keys = new Set<string>();

  for (const unit of units) {
    for (const key of Object.keys(unit.attributes ?? {})) {
      addTrimmed(keys, key);
    }
  }

  return [...keys]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((key, index) => ({ key, label: key, position: index }));
};
