export interface TrackedUnitCapacityReservation {
  startDate: Date;
  endDate: Date;
  combinationKey: string | null;
  quantity: number;
}

interface CapacityEvent {
  combinationKey: string | null;
  quantityDelta: number;
}

function haveSameTrackedUnitCapacity(
  currentAvailableByCombination: ReadonlyMap<string, number>,
  proposedAvailableByCombination: ReadonlyMap<string, number>,
): boolean {
  if (currentAvailableByCombination.size !== proposedAvailableByCombination.size) {
    return false;
  }

  for (const [combinationKey, currentQuantity] of currentAvailableByCombination) {
    if (proposedAvailableByCombination.get(combinationKey) !== currentQuantity) {
      return false;
    }
  }

  return true;
}

/**
 * The reservation-capacity guard is only relevant when enabling tracked units
 * or when the submitted unit distribution changes. Unrelated product edits
 * must not be blocked by a pre-existing capacity conflict.
 */
export function shouldValidateTrackedUnitCapacity({
  wasTrackingUnits,
  currentAvailableByCombination,
  proposedAvailableByCombination,
}: {
  wasTrackingUnits: boolean;
  currentAvailableByCombination: ReadonlyMap<string, number>;
  proposedAvailableByCombination: ReadonlyMap<string, number>;
}): boolean {
  return (
    !wasTrackingUnits ||
    !haveSameTrackedUnitCapacity(currentAvailableByCombination, proposedAvailableByCombination)
  );
}

function addCapacityEvent(
  eventsByTimestamp: Map<number, CapacityEvent[]>,
  timestamp: number,
  event: CapacityEvent,
) {
  const events = eventsByTimestamp.get(timestamp) || [];
  events.push(event);
  eventsByTimestamp.set(timestamp, events);
}

/**
 * Checks the proposed tracked-unit capacity against the peak concurrent demand.
 *
 * Legacy non-tracked reservations have no combination and can be fulfilled by
 * any tracked unit. Reservations with a combination (including `__default`)
 * must fit that exact combination as well as the product's total capacity.
 */
export function hasTrackedUnitCapacityConflict({
  availableByCombination,
  reservations,
  from,
}: {
  availableByCombination: ReadonlyMap<string, number>;
  reservations: TrackedUnitCapacityReservation[];
  from: Date;
}): boolean {
  const fromTimestamp = from.getTime();
  const eventsByTimestamp = new Map<number, CapacityEvent[]>();

  for (const reservation of reservations) {
    if (reservation.quantity <= 0) {
      continue;
    }

    const startTimestamp = Math.max(fromTimestamp, reservation.startDate.getTime());
    const endTimestamp = reservation.endDate.getTime();
    if (
      !Number.isFinite(startTimestamp) ||
      !Number.isFinite(endTimestamp) ||
      startTimestamp >= endTimestamp
    ) {
      continue;
    }

    addCapacityEvent(eventsByTimestamp, startTimestamp, {
      combinationKey: reservation.combinationKey,
      quantityDelta: reservation.quantity,
    });
    addCapacityEvent(eventsByTimestamp, endTimestamp, {
      combinationKey: reservation.combinationKey,
      quantityDelta: -reservation.quantity,
    });
  }

  const totalAvailable = [...availableByCombination.values()].reduce(
    (total, quantity) => total + Math.max(0, quantity),
    0,
  );
  const reservedByCombination = new Map<string | null, number>();
  let totalReserved = 0;

  for (const timestamp of [...eventsByTimestamp.keys()].sort((left, right) => left - right)) {
    const quantityDeltaByCombination = new Map<string | null, number>();
    for (const event of eventsByTimestamp.get(timestamp) || []) {
      quantityDeltaByCombination.set(
        event.combinationKey,
        (quantityDeltaByCombination.get(event.combinationKey) || 0) + event.quantityDelta,
      );
    }

    for (const [combinationKey, quantityDelta] of quantityDeltaByCombination) {
      const nextReserved = (reservedByCombination.get(combinationKey) || 0) + quantityDelta;
      reservedByCombination.set(combinationKey, nextReserved);
      totalReserved += quantityDelta;
    }

    if (totalReserved > totalAvailable) {
      return true;
    }

    for (const [combinationKey, reservedQuantity] of reservedByCombination) {
      if (combinationKey === null) {
        continue;
      }

      if (reservedQuantity > (availableByCombination.get(combinationKey) || 0)) {
        return true;
      }
    }
  }

  return false;
}
