/**
 * The stock rule of a product whose units are tracked, as arithmetic on
 * combinations: no database, no dates. A combination holds a number of
 * rentable units; a demand asks for units from any of the combinations it
 * accepts (one for an exact choice, several for an open one).
 *
 * The rule (docs/domain/reservation-invariants.md, S1):
 *
 * - Fits: at an instant, the request fits when the most units the stock can
 *   give the other bookings and the request together is the most it can give
 *   the other bookings alone, plus everything the request asks. The others
 *   are served first; what they lack because the store booked them over its
 *   stock is not held against the request. The request fits when it fits at
 *   every instant of its window.
 * - The units a spread line already holds are granted first, each on its own
 *   combination, one by one, each only if it fits.
 * - Then the lines, in their order. A spread line (one booked with no exact
 *   combination) is a demand like the others' and gets the most that fits
 *   next to what was granted before it. A single line (a checkout line, or
 *   any line with an exact combination) is placed whole on its first candidate where
 *   what was granted, the spread lines after it and the other bookings still
 *   fit, or failing that on its first candidate where what was granted still
 *   fits. A placement is never revisited.
 * - A line that does not fit whole takes the most that fits: a single line
 *   the most one candidate gives, the first of them on a tie.
 *
 * What the rule does not see:
 *
 * - A cart of several single lines that only another placement of an earlier
 *   line would fit is refused: no placement is revisited. The rule is exact
 *   for everything else.
 * - It fixes quantities per combination, not physical units: two units of a
 *   combination each out for half of the window serve a request for the
 *   whole window on paper, with a swap in the middle.
 * - The other bookings that left a choice open, and the request's spread
 *   lines, are placed afresh at each instant: one may be given a unit on
 *   Monday and another on Tuesday.
 *
 * Cost: an exact demand (one candidate) is folded into the room each
 * combination has left at each instant, and an instant another one
 * dominates (less room, more open demands) is dropped; a flow is solved only
 * for the open demands left. When no demand is open, a line fits exactly when
 * every combination it takes keeps enough room at its tightest instant, and
 * no flow is built. No search, no budget: the work is bounded by the
 * instants, the combinations and the lines.
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

/** What another booking asks, from `start` to `end` (excluded). */
export interface StockBooking {
  start: number;
  end: number;
  demand: StockDemand;
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
   * granted there, before any line takes a unit it does not hold yet.
   */
  held?: readonly string[];
}

export interface StockLineAllocation {
  /** How many of the line's units the stock covers. */
  served: number;
  /**
   * A single line: the combination it is placed on, also when it is short.
   * Null for a spread line, which no combination has to cover alone, and for
   * a line with no candidate.
   */
  combinationKey: string | null;
}

// --- Flows on combination indices ---------------------------------------------

/** Units asked from any of the combinations at these indices. */
interface Demand {
  combinations: readonly number[];
  quantity: number;
}

/**
 * The most units of `demands` the combinations serve at once, each holding
 * `room[c]` units, and how many each combination gives: a maximum flow, grown
 * one augmenting path at a time.
 */
const solveFlow = (
  demands: readonly Demand[],
  room: ArrayLike<number>,
  size: number,
): { total: number; used: Int32Array } => {
  const used = new Int32Array(size);
  const taken = demands.map(() => new Int32Array(size));

  /** Serves up to `want` more units of a demand along one path; returns how many. */
  const serve = (demand: number, want: number, visited: Uint8Array): number => {
    const combinations = demands[demand]?.combinations ?? [];
    const mine = taken[demand];
    if (!mine) return 0;
    for (const combination of combinations) {
      const free = (room[combination] ?? 0) - (used[combination] ?? 0);
      if (free > 0) {
        const served = Math.min(want, free);
        mine[combination] = (mine[combination] ?? 0) + served;
        used[combination] = (used[combination] ?? 0) + served;
        return served;
      }
    }
    // Every combination it accepts is full: a demand served there may move elsewhere.
    for (const combination of combinations) {
      if (visited[combination]) continue;
      visited[combination] = 1;
      for (const [other, theirs] of taken.entries()) {
        const there = theirs[combination] ?? 0;
        if (other === demand || there <= 0) continue;
        const moved = serve(other, Math.min(want, there), visited);
        if (moved > 0) {
          theirs[combination] = there - moved;
          mine[combination] = (mine[combination] ?? 0) + moved;
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
      const served = serve(index, unserved, new Uint8Array(size));
      if (served === 0) break;
      unserved -= served;
      total += served;
    }
  }
  return { total, used };
};

/**
 * How many of the units asked the combinations can serve at once: a maximum
 * flow from the demands to the combinations.
 */
export const maxServed = (
  demands: readonly StockDemand[],
  capacityOf: (combinationKey: string) => number,
): number => {
  const keys = [...new Set(demands.flatMap((demand) => demand.combinationKeys))];
  const indexOf = new Map(keys.map((key, index) => [key, index]));
  return solveFlow(
    demands.map((demand) => ({
      combinations: [...new Set(demand.combinationKeys)].flatMap((key) => {
        const index = indexOf.get(key);
        return index === undefined ? [] : [index];
      }),
      quantity: demand.quantity,
    })),
    keys.map((key) => Math.max(0, capacityOf(key))),
    keys.length,
  ).total;
};

// --- Instants --------------------------------------------------------------------

/** The demands held together at an instant where the other bookings peak. */
interface Instant {
  /** Units each combination has left once the exact demands are served; below zero when overbooked. */
  room: Int32Array;
  /** The open demands, one per set of combinations. */
  open: Demand[];
  /** Every demand, exact ones included: kept for the literal check only. */
  all: Demand[];
}

const signatureOf = (combinations: readonly number[]) => combinations.join(",");

/** Adds a demand to those that accept the same combinations. */
const addTo = (bySignature: Map<string, Demand>, demand: Demand, sign: 1 | -1) => {
  const signature = signatureOf(demand.combinations);
  const quantity = (bySignature.get(signature)?.quantity ?? 0) + sign * demand.quantity;
  if (quantity > 0) bySignature.set(signature, { combinations: demand.combinations, quantity });
  else bySignature.delete(signature);
};

/**
 * The instants that can bind: each time a booking ends after others started,
 * what is held at that moment. A set of bookings held together that a later
 * set contains is never taken alone.
 */
const instantsOf = (
  bookings: ReadonlyArray<{ start: number; end: number; demand: Demand }>,
  capacity: Int32Array,
  keepAll: boolean,
): Instant[] => {
  const size = capacity.length;
  const events = bookings
    .flatMap((booking, index) =>
      booking.start < booking.end
        ? [
            { at: booking.start, opens: true, index },
            { at: booking.end, opens: false, index },
          ]
        : [],
    )
    // A booking that ends when another starts does not meet it.
    .sort((a, b) => a.at - b.at || Number(a.opens) - Number(b.opens) || a.index - b.index);

  const load = new Int32Array(size);
  const open = new Map<string, Demand>();
  const all = new Map<string, Demand>();
  const instants: Instant[] = [];
  let grew = false;
  for (const event of events) {
    const booking = bookings[event.index];
    if (!booking) continue;
    const { demand } = booking;
    const [only] = demand.combinations;
    if (event.opens) grew = true;
    else if (grew) {
      instants.push({
        room: capacity.map((units, combination) => units - (load[combination] ?? 0)),
        open: [...open.values()],
        all: keepAll ? [...all.values()] : [],
      });
      grew = false;
    }
    const sign = event.opens ? 1 : -1;
    if (keepAll) addTo(all, demand, sign);
    if (demand.combinations.length > 1) addTo(open, demand, sign);
    else if (only !== undefined) load[only] = (load[only] ?? 0) + sign * demand.quantity;
  }
  return instants.length > 0 ? instants : [{ room: capacity.slice(), open: [], all: [] }];
};

interface FlowInstant {
  /** Room left, never below zero. */
  room: Int32Array;
  open: Demand[];
  /** The combinations the open demands accept: only they matter to the flow. */
  openCombinations: number[];
  /** What the other bookings get there, and where. */
  baseline: { total: number; used: Int32Array };
}

/**
 * Drops the instants another one dominates. Room only helps and fewer open
 * demands only help (a request that fits next to more demands, in less room,
 * fits next to fewer, in more): of two instants, one with less room on the
 * combinations a flow can reach and at least the same open demands is the
 * only one to check.
 */
const bindingInstants = (
  instants: readonly FlowInstant[],
  requestCombinations: readonly number[],
): FlowInstant[] => {
  // Each set of combinations an open demand accepts, numbered once.
  const numbered = new Map<string, number>();
  for (const instant of instants) {
    for (const demand of instant.open) {
      const signature = signatureOf(demand.combinations);
      if (!numbered.has(signature)) numbered.set(signature, numbered.size);
    }
  }
  const described = instants.map((instant) => {
    const combinations = Int32Array.from(
      new Set([...instant.openCombinations, ...requestCombinations]),
    ).sort();
    const open = instant.open
      .map((demand) => ({
        index: numbered.get(signatureOf(demand.combinations)) ?? 0,
        quantity: demand.quantity,
      }))
      .sort((a, b) => a.index - b.index);
    let roomTotal = 0;
    for (const combination of combinations) roomTotal += instant.room[combination] ?? 0;
    return {
      instant,
      combinations,
      open,
      key: [
        open.map((demand) => `${demand.index}x${demand.quantity}`).join(","),
        [...combinations].map((combination) => instant.room[combination] ?? 0).join(","),
      ].join("|"),
      openQuantity: open.reduce((sum, demand) => sum + demand.quantity, 0),
      roomTotal,
    };
  });
  // The most open demands and the least room first: they dominate the others.
  const unique = [...new Map(described.map((entry) => [entry.key, entry])).values()].sort(
    (a, b) => b.openQuantity - a.openQuantity || a.roomTotal - b.roomTotal,
  );

  const kept: Array<{ entry: (typeof unique)[number]; openByIndex: Int32Array }> = [];
  for (const candidate of unique) {
    const { room } = candidate.instant;
    const dominated = kept.some(({ entry, openByIndex }) => {
      if (entry.openQuantity < candidate.openQuantity) return false;
      for (const combination of entry.combinations) {
        if ((entry.instant.room[combination] ?? 0) > (room[combination] ?? 0)) return false;
      }
      for (const { index, quantity } of candidate.open) {
        if ((openByIndex[index] ?? 0) < quantity) return false;
      }
      return true;
    });
    if (dominated) continue;
    const openByIndex = new Int32Array(numbered.size);
    for (const { index, quantity } of candidate.open) openByIndex[index] = quantity;
    kept.push({ entry: candidate, openByIndex });
  }
  return kept.map(({ entry }) => entry.instant);
};

/**
 * Whether a request fits, at every instant, next to the other bookings: the
 * test of the rule, built once per product.
 */
const fitTest = (
  instants: readonly Instant[],
  capacity: Int32Array,
  requestCombinations: readonly number[],
  check: "folded" | "literal",
): ((request: readonly Demand[]) => boolean) => {
  const size = capacity.length;
  if (check === "literal") {
    // The rule as written: a flow per instant over every demand.
    const baselines = instants.map((instant) => solveFlow(instant.all, capacity, size).total);
    return (request) => {
      const asked = request.reduce((sum, demand) => sum + demand.quantity, 0);
      return instants.every(
        (instant, index) =>
          solveFlow([...instant.all, ...request], capacity, size).total ===
          (baselines[index] ?? 0) + asked,
      );
    };
  }

  // The room each combination keeps at its tightest instant.
  const tightest = Int32Array.from(capacity);
  for (const instant of instants) {
    for (let combination = 0; combination < size; combination += 1) {
      tightest[combination] = Math.min(
        tightest[combination] ?? 0,
        Math.max(0, instant.room[combination] ?? 0),
      );
    }
  }
  // An instant needs a flow when another booking left a choice open there,
  // or when the request may leave one open.
  const flowInstants = bindingInstants(
    instants
      .filter((instant) => instant.open.length > 0 || requestCombinations.length > 0)
      .map((instant) => {
        const room = instant.room.map((units) => Math.max(0, units));
        return {
          room,
          open: instant.open,
          openCombinations: [...new Set(instant.open.flatMap((demand) => demand.combinations))],
          baseline: solveFlow(instant.open, room, size),
        };
      }),
    requestCombinations,
  );

  return (request) => {
    const exact = new Int32Array(size);
    const open: Demand[] = [];
    let openAsked = 0;
    for (const demand of request) {
      if (demand.quantity <= 0) continue;
      const [only, ...others] = demand.combinations;
      if (only === undefined) return false;
      if (others.length === 0) exact[only] = (exact[only] ?? 0) + demand.quantity;
      else {
        open.push(demand);
        openAsked += demand.quantity;
      }
    }
    // Exact demands: enough room at the tightest instant.
    for (let combination = 0; combination < size; combination += 1) {
      if ((exact[combination] ?? 0) > (tightest[combination] ?? 0)) return false;
    }
    return flowInstants.every((instant) => {
      if (open.length === 0) {
        // The others keep their flow when it still fits in the room the request leaves.
        const keepsBaseline = instant.openCombinations.every(
          (combination) =>
            (exact[combination] ?? 0) <=
            (instant.room[combination] ?? 0) - (instant.baseline.used[combination] ?? 0),
        );
        if (keepsBaseline) return true;
      }
      const room = instant.room.map((units, combination) => units - (exact[combination] ?? 0));
      return (
        solveFlow([...instant.open, ...open], room, size).total ===
        instant.baseline.total + openAsked
      );
    });
  };
};

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

/**
 * Gives each line of a request the largest quantity the stock covers, next
 * to what the other bookings ask at each instant of the window, by the rule
 * stated at the top of this file. The request fits whole exactly when every
 * line is served its full quantity.
 */
export const allocateStock = (input: {
  /** Rentable units per combination. */
  capacity: ReadonlyMap<string, number>;
  /** What the other bookings ask, and when. */
  bookings: readonly StockBooking[];
  lines: readonly StockLine[];
  /**
   * `literal` checks the rule as written, a flow per instant over every
   * demand, with no folding and no instant dropped. For tests that compare
   * it with the default.
   */
  check?: "folded" | "literal";
}): StockLineAllocation[] => {
  const keys = [...input.capacity.keys()];
  const indexOf = new Map(keys.map((key, index) => [key, index]));
  const capacity = Int32Array.from(keys, (key) => Math.max(0, input.capacity.get(key) ?? 0));
  /** The combinations at these keys that hold a unit, once each, in their order. */
  const usable = (combinationKeys: readonly string[]) => [
    ...new Set(
      combinationKeys.flatMap((key) => {
        const index = indexOf.get(key);
        return index !== undefined && (capacity[index] ?? 0) > 0 ? [index] : [];
      }),
    ),
  ];

  const bookings = input.bookings.flatMap((booking) => {
    const combinations = usable(booking.demand.combinationKeys).sort((a, b) => a - b);
    // A booking no unit can serve lacks it whatever the request takes.
    return combinations.length > 0 && booking.demand.quantity > 0
      ? [{ ...booking, demand: { combinations, quantity: booking.demand.quantity } }]
      : [];
  });
  const lines = input.lines.map((line) => {
    const candidates = usable(line.candidates);
    const held = (line.held ?? []).slice(0, line.quantity);
    return {
      line,
      candidates,
      held,
      // A held unit that does not fit is not replaced by another one.
      free: line.quantity - held.length,
      single: line.single,
    };
  });
  // The combinations a spread line of the request may leave open.
  const requestCombinations = [
    ...new Set(
      lines.flatMap((entry) =>
        entry.single || entry.candidates.length < 2 ? [] : entry.candidates,
      ),
    ),
  ];
  const check = input.check ?? "folded";
  const fits = fitTest(
    instantsOf(bookings, capacity, check === "literal"),
    capacity,
    requestCombinations,
    check,
  );

  const granted: Demand[] = [];
  const fitsWith = (...more: Demand[]) => fits([...granted, ...more]);
  const servedHeld = lines.map(() => 0);
  for (const [index, entry] of lines.entries()) {
    for (const key of entry.held) {
      const combination = indexOf.get(key);
      if (combination === undefined) continue;
      const unit = { combinations: [combination], quantity: 1 };
      if (fitsWith(unit)) {
        granted.push(unit);
        servedHeld[index] = (servedHeld[index] ?? 0) + 1;
      }
    }
  }

  return lines.map((entry, index): StockLineAllocation => {
    const { line, candidates, free } = entry;
    const held = servedHeld[index] ?? 0;
    if (!entry.single) {
      const asked = (quantity: number) => ({ combinations: candidates, quantity });
      const served = largestWhere(free, (quantity) => fitsWith(asked(quantity)));
      granted.push(asked(served));
      return { served: held + served, combinationKey: null };
    }

    const on = (combination: number, quantity: number) => ({
      combinations: [combination],
      quantity,
    });
    // The spread lines after this one, whole: a single line leaves them their place.
    const later = lines
      .slice(index + 1)
      .flatMap((next) =>
        next.single ? [] : [{ combinations: next.candidates, quantity: next.free }],
      );
    const placed =
      candidates.find((combination) => fitsWith(on(combination, free), ...later)) ??
      candidates.find((combination) => fitsWith(on(combination, free)));
    let combination = placed;
    let served = free;
    if (combination === undefined) {
      // Short: the most one candidate gives, the first of them on a tie.
      served = -1;
      for (const candidate of candidates) {
        const most = largestWhere(free - 1, (quantity) => fitsWith(on(candidate, quantity)));
        if (most > served) {
          served = most;
          combination = candidate;
        }
      }
      served = Math.max(0, served);
    }
    if (combination !== undefined) granted.push(on(combination, served));
    return {
      served: held + served,
      combinationKey:
        combination !== undefined ? (keys[combination] ?? null) : (line.candidates[0] ?? null),
    };
  });
};
