/**
 * The stock rule of a product whose units are tracked, as arithmetic on
 * combinations: no database, no dates. A combination holds a number of
 * rentable units; a demand asks for units from any of the combinations it
 * accepts (one for an exact choice, several for an open one).
 *
 * A request fits when, at every instant of its window, the other bookings
 * and the request's own lines can all be given a unit at once, the request
 * keeping the same units throughout. Other bookings come first: at each
 * instant they get as many units as the stock can give them, and the request
 * may not lower that number. What they lack because the store booked them
 * over its stock is not held against the request.
 *
 * The other bookings are placed afresh at each instant. A booking that left a
 * choice open is not followed from one instant to the next: the rule does not
 * see that it would have to change units between two of them.
 */

import type { BookingAttributeAxis, UnitAttributes } from "@louez/types";
import {
  canonicalizeAttributes,
  isPooledCombinationKey,
  matchesSelectedAttributes,
} from "@louez/utils";

/** A combination of a product's rentable units, with its values on the product's current axes. */
export interface StockCombination {
  combinationKey: string;
  selectedAttributes: UnitAttributes;
}

/**
 * The combinations whose units may serve the units a booked line has yet to
 * get, as unit assignment reads it (`resolveUnitAssignmentScope`): the one it
 * chose, or, when it left a choice open, every combination that matches what
 * it did choose on the product's current axes. A value chosen on an axis the
 * product dropped since no longer narrows anything.
 */
export const combinationsServing = (
  axes: BookingAttributeAxis[] | null | undefined,
  combinations: readonly StockCombination[],
  choice: { combinationKey?: string | null; selectedAttributes?: UnitAttributes | null },
): string[] => {
  const exactKey =
    choice.combinationKey && !isPooledCombinationKey(axes, choice.combinationKey)
      ? choice.combinationKey
      : null;
  const chosen = canonicalizeAttributes(axes, choice.selectedAttributes);
  return combinations
    .filter((combination) =>
      exactKey
        ? combination.combinationKey === exactKey
        : matchesSelectedAttributes(chosen, combination.selectedAttributes),
    )
    .map((combination) => combination.combinationKey);
};

/** Units asked from any of the combinations listed. */
export interface StockDemand {
  combinationKeys: readonly string[];
  quantity: number;
}

/** A line of the request being checked. */
export interface StockLine {
  quantity: number;
  /** The combinations that may serve the line, in the order they are tried. */
  candidates: readonly string[];
  /** One combination covers the whole line; otherwise it spreads over its candidates. */
  single: boolean;
  /**
   * The combination of each unit a spread line already holds. They are
   * counted there, before any line takes a unit it does not hold yet.
   */
  held?: readonly string[];
}

export interface StockLineAllocation {
  /** How many of the line's units the stock covers. */
  served: number;
  /** Where they are taken. A single line names its combination even when it gets none. */
  byCombination: Map<string, number>;
}

/**
 * Arrangements tried and abandoned before the search gives up and answers
 * that the request does not fit. Lines that spread never abandon one on a
 * single instant; only single lines and windows of many instants can.
 */
export const STOCK_SEARCH_BUDGET = 2_000;

class SearchExhausted extends Error {}

/** The largest n in 0..max that holds, for a rule that holds up to some n and never beyond. */
const largestWhere = (max: number, holds: (n: number) => boolean): number => {
  if (max <= 0 || holds(max)) return Math.max(0, max);
  let low = 0;
  let high = max - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (holds(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
};

/** Demands that accept the same combinations ask together. */
const mergeDemands = (demands: readonly StockDemand[]): StockDemand[] => {
  const merged = new Map<string, StockDemand>();
  for (const demand of demands) {
    if (demand.quantity <= 0) continue;
    const combinationKeys = [...new Set(demand.combinationKeys)].sort();
    const signature = JSON.stringify(combinationKeys);
    merged.set(signature, {
      combinationKeys,
      quantity: (merged.get(signature)?.quantity ?? 0) + demand.quantity,
    });
  }
  return [...merged.values()];
};

/**
 * How many of the units asked the combinations can serve at once: a maximum
 * flow from the demands to the combinations, grown one augmenting path at a
 * time.
 */
export const maxServed = (
  demands: readonly StockDemand[],
  capacityOf: (combinationKey: string) => number,
): number => {
  /** Per combination, the units each demand takes there. */
  const takers = new Map<string, Map<number, number>>();
  const load = new Map<string, number>();
  const roomOn = (combinationKey: string) =>
    capacityOf(combinationKey) - (load.get(combinationKey) ?? 0);
  const move = (demand: number, combinationKey: string, quantity: number) => {
    const there = takers.get(combinationKey) ?? new Map<number, number>();
    const taken = (there.get(demand) ?? 0) + quantity;
    if (taken > 0) there.set(demand, taken);
    else there.delete(demand);
    takers.set(combinationKey, there);
    load.set(combinationKey, (load.get(combinationKey) ?? 0) + quantity);
  };

  /** Serves up to `quantity` more units of a demand along one path; returns how many. */
  const serve = (demand: number, quantity: number, visited: Set<string>): number => {
    const combinationKeys = demands[demand]?.combinationKeys ?? [];
    for (const combinationKey of combinationKeys) {
      const served = Math.min(quantity, roomOn(combinationKey));
      if (served > 0) {
        move(demand, combinationKey, served);
        return served;
      }
    }
    // Every combination it accepts is full: a demand served there may move elsewhere.
    for (const combinationKey of combinationKeys) {
      if (visited.has(combinationKey)) continue;
      visited.add(combinationKey);
      for (const [other, there] of takers.get(combinationKey) ?? []) {
        if (other === demand) continue;
        const moved = serve(other, Math.min(quantity, there), visited);
        if (moved > 0) {
          move(other, combinationKey, -moved);
          move(demand, combinationKey, moved);
          return moved;
        }
      }
    }
    return 0;
  };

  let total = 0;
  for (const [index, demand] of demands.entries()) {
    let unserved = demand.quantity;
    while (unserved > 0) {
      const served = serve(index, unserved, new Set());
      if (served === 0) break;
      unserved -= served;
      total += served;
    }
  }
  return total;
};

/**
 * The sets of demands held together at some instant, from the span each
 * booking holds its units (`end` excluded). Only the sets no other contains
 * are kept: a stock that serves a set serves any part of it.
 */
export const demandInstants = <T>(
  spans: ReadonlyArray<{ start: number; end: number; demand: T }>,
): T[][] => {
  const events = spans
    .flatMap((span, index) =>
      span.start < span.end
        ? [
            { at: span.start, opens: true, index },
            { at: span.end, opens: false, index },
          ]
        : [],
    )
    // A span that ends when another starts does not meet it.
    .sort((a, b) => a.at - b.at || Number(a.opens) - Number(b.opens) || a.index - b.index);

  const instants: T[][] = [];
  const open = new Set<number>();
  let grew = false;
  for (const event of events) {
    if (event.opens) {
      open.add(event.index);
      grew = true;
      continue;
    }
    if (grew) {
      const together: T[] = [];
      for (const index of [...open].sort((a, b) => a - b)) {
        const span = spans[index];
        if (span) together.push(span.demand);
      }
      instants.push(together);
      grew = false;
    }
    open.delete(event.index);
  }
  return instants;
};

interface Part {
  line: number;
  candidates: readonly string[];
  quantity: number;
  single: boolean;
}

/**
 * Gives each line of a request the largest quantity the stock covers, next
 * to what the other bookings ask at each instant of the window.
 *
 * The units lines already hold are granted first, then the lines in their
 * order: a line gets the most that still fits with what was granted before
 * it, whatever combinations those earlier lines end on. The request fits
 * whole exactly when every line is served its full quantity.
 *
 * Which combinations are taken is deterministic: single lines first, each on
 * its first candidate that leaves a place for everything else, then the
 * spread lines, each filling its candidates in their order.
 */
export const allocateStock = (input: {
  /** Rentable units per combination. */
  capacity: ReadonlyMap<string, number>;
  /** What the other bookings ask at each instant of the window (`demandInstants`). */
  instants: ReadonlyArray<readonly StockDemand[]>;
  lines: readonly StockLine[];
  /** In place of `STOCK_SEARCH_BUDGET`. */
  searchBudget?: number;
}): StockLineAllocation[] => {
  const { capacity, lines } = input;
  const capacityOf = (combinationKey: string) => capacity.get(combinationKey) ?? 0;
  // With no other booking, the request is still checked against the stock.
  const instants = input.instants.length > 0 ? input.instants.map(mergeDemands) : [[]];
  // What the other bookings get of the whole stock: all they ask, or less
  // when the store booked them over it.
  const othersServed = instants.map((demands) => maxServed(demands, capacityOf));

  /**
   * Whether, at every instant, the stock less the pinned units still serves
   * the other bookings as well as before, and `flexible` in full.
   */
  const fits = (pinned: ReadonlyMap<string, number>, flexible: readonly StockDemand[]): boolean => {
    for (const [combinationKey, quantity] of pinned) {
      if (quantity > capacityOf(combinationKey)) return false;
    }
    const asked = flexible.reduce((sum, demand) => sum + demand.quantity, 0);
    const left = (combinationKey: string) =>
      capacityOf(combinationKey) - (pinned.get(combinationKey) ?? 0);
    return instants.every(
      (demands, index) =>
        maxServed([...demands, ...flexible], left) === (othersServed[index] ?? 0) + asked,
    );
  };

  /**
   * How many more units `combinationKeys` can give at every instant, once
   * the pinned units are taken and the other bookings and `flexible` are
   * served, which they must be (`fits`). A served set of demands can always
   * be kept served while more is taken, so one flow per instant tells.
   */
  const room = (
    pinned: ReadonlyMap<string, number>,
    flexible: readonly StockDemand[],
    combinationKeys: readonly string[],
  ): number => {
    const asked = flexible.reduce((sum, demand) => sum + demand.quantity, 0);
    const left = (combinationKey: string) =>
      capacityOf(combinationKey) - (pinned.get(combinationKey) ?? 0);
    const everything = { combinationKeys, quantity: Number.POSITIVE_INFINITY };
    return Math.min(
      ...instants.map(
        (demands, index) =>
          maxServed([...demands, ...flexible, everything], left) -
          (othersServed[index] ?? 0) -
          asked,
      ),
    );
  };

  const pin = (pinned: ReadonlyMap<string, number>, combinationKey: string, quantity: number) =>
    new Map(pinned).set(combinationKey, (pinned.get(combinationKey) ?? 0) + quantity);
  const asDemand = (part: Part): StockDemand => ({
    combinationKeys: part.candidates,
    quantity: part.quantity,
  });

  let abandoned = 0;
  const abandon = () => {
    abandoned += 1;
    if (abandoned > (input.searchBudget ?? STOCK_SEARCH_BUDGET)) throw new SearchExhausted();
  };

  /**
   * Places every part, in order, on top of the pinned units: the first
   * arrangement found, as one map per part, or null when there is none. A
   * choice is kept only while each instant can still place the parts after
   * it; when they cannot all agree later, the choice is abandoned.
   */
  const place = (
    parts: readonly Part[],
    pinned: ReadonlyMap<string, number>,
  ): Array<Map<string, number>> | null => {
    const [part, ...rest] = parts;
    if (!part) return [];
    if (part.quantity === 0) {
      const placed = place(rest, pinned);
      return placed && [new Map(), ...placed];
    }
    const later = rest.map(asDemand);

    if (part.single) {
      for (const combinationKey of part.candidates) {
        const next = pin(pinned, combinationKey, part.quantity);
        if (!fits(next, later)) continue;
        const placed = place(rest, next);
        if (placed) return [new Map([[combinationKey, part.quantity]]), ...placed];
        abandon();
      }
      return null;
    }

    const [combinationKey, ...otherCandidates] = part.candidates;
    if (combinationKey === undefined) return null;
    // The first candidate takes all it can; the remainder goes to the next ones.
    const most = Math.min(part.quantity, room(pinned, later, [combinationKey]));
    for (let quantity = most; quantity >= 0; quantity -= 1) {
      const next = pin(pinned, combinationKey, quantity);
      const remainder = {
        ...part,
        candidates: otherCandidates,
        quantity: part.quantity - quantity,
      };
      // Taking less here only asks more of the next candidates.
      if (!fits(next, [asDemand(remainder), ...later])) return null;
      const placed = place([remainder, ...rest], next);
      const [remainderPlaced, ...restPlaced] = placed ?? [];
      if (remainderPlaced) {
        if (quantity > 0) remainderPlaced.set(combinationKey, quantity);
        return [remainderPlaced, ...restPlaced];
      }
      abandon();
    }
    return null;
  };

  const granted: Array<{ held: string[]; free: number }> = lines.map(() => ({
    held: [],
    free: 0,
  }));

  /** What is granted so far: the held units, pinned, and the rest of each line, single lines first. */
  const grantedParts = () => {
    let pinned: ReadonlyMap<string, number> = new Map();
    for (const { held } of granted) {
      for (const combinationKey of held) pinned = pin(pinned, combinationKey, 1);
    }
    const parts = lines.map((line, index) => ({
      line: index,
      candidates: line.candidates,
      quantity: granted[index]?.free ?? 0,
      single: line.single,
    }));
    const ordered = [
      ...parts.filter((part) => part.single),
      ...parts.filter((part) => !part.single),
    ];
    return { pinned, ordered };
  };

  /** Where every line is taken for what is granted so far, or null when that cannot be placed. */
  const arrange = (): Array<Map<string, number>> | null => {
    const { pinned, ordered } = grantedParts();

    abandoned = 0;
    let placed: Array<Map<string, number>> | null;
    try {
      placed = fits(pinned, ordered.map(asDemand)) ? place(ordered, pinned) : null;
    } catch (error) {
      if (!(error instanceof SearchExhausted)) throw error;
      placed = null;
    }
    if (!placed) return null;

    const byLine = lines.map(() => new Map<string, number>());
    for (const [position, part] of ordered.entries()) {
      byLine[part.line] = placed[position] ?? new Map();
    }
    return byLine;
  };

  const heldOf = (line: StockLine) => (line.held ?? []).slice(0, line.quantity);
  for (const [index, line] of lines.entries()) {
    const grant = granted[index];
    if (!grant) continue;
    for (const combinationKey of heldOf(line)) {
      grant.held.push(combinationKey);
      if (!arrange()) grant.held.pop();
    }
  }
  for (const [index, line] of lines.entries()) {
    const grant = granted[index];
    if (!grant) continue;
    // No more than its candidates can still give next to what is granted,
    // which is what the line gets unless the arrangement says otherwise.
    const { pinned, ordered } = grantedParts();
    const others = ordered.map(asDemand);
    const mostLeft = line.single
      ? Math.max(0, ...line.candidates.map((candidate) => room(pinned, others, [candidate])))
      : room(pinned, others, line.candidates);
    // A held unit that does not fit is not replaced by another one.
    const wanted = line.quantity - heldOf(line).length;
    grant.free = largestWhere(Math.min(wanted, mostLeft), (quantity) => {
      grant.free = quantity;
      return arrange() !== null;
    });
  }

  const arranged = arrange() ?? [];
  return lines.map((line, index) => {
    const byCombination = new Map(arranged[index]);
    const grant = granted[index] ?? { held: [], free: 0 };
    for (const combinationKey of grant.held) {
      byCombination.set(combinationKey, (byCombination.get(combinationKey) ?? 0) + 1);
    }
    const [firstCandidate] = line.candidates;
    if (line.single && byCombination.size === 0 && firstCandidate !== undefined) {
      byCombination.set(firstCandidate, 0);
    }
    return { served: grant.held.length + grant.free, byCombination };
  });
};
