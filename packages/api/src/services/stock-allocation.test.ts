import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import type { BookingAttributeAxis } from "@louez/types";

import type {
  StockBooking,
  StockCombination,
  StockDemand,
  StockLine,
  StockLineAllocation,
} from "./stock-allocation";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so hand them over through require.
const require = createRequire(import.meta.url);
const variantUtils: Record<string, unknown> = require("@louez/utils");
mock.module("@louez/utils", { namedExports: variantUtils });

const { allocateStock, combinationsServing, maxServed } = await import("./stock-allocation");

// --- Instances ------------------------------------------------------------------

/** The other bookings as the demands held together at each instant. */
type Instance = {
  capacity: Map<string, number>;
  instants: StockDemand[][];
  lines: StockLine[];
};

/** Each instant becomes a step of time of its own. */
const bookingsOf = (instants: readonly StockDemand[][]): StockBooking[] =>
  instants.flatMap((demands, at) => demands.map((demand) => ({ start: at, end: at + 1, demand })));

const allocate = (instance: Instance, check?: "folded" | "literal") =>
  allocateStock({
    capacity: instance.capacity,
    bookings: bookingsOf(instance.instants),
    lines: instance.lines,
    check,
  });

const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

/** mulberry32: a small seeded generator, so a failure names its seed. */
const randomFrom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const KEYS = ["a", "b", "c", "d"];

const generatorOf = (seed: number) => {
  const random = randomFrom(seed);
  const upTo = (max: number) => Math.floor(random() * (max + 1));
  const shuffled = <T>(items: readonly T[]) =>
    items
      .map((item) => ({ item, order: random() }))
      .sort((a, b) => a.order - b.order)
      .map(({ item }) => item);
  const someOf = (items: readonly string[], atLeast: number) =>
    shuffled(items).slice(0, Math.max(atLeast, 1 + upTo(items.length - 1)));
  return { random, upTo, shuffled, someOf };
};

/**
 * Two to four combinations, eight units at most, some combinations empty;
 * up to three instants of other bookings, often over the stock; up to five
 * lines, single and spread, some holding units. Candidate sets are drawn
 * freely, so they overlap without nesting as often as they nest.
 */
const instanceOf = (
  seed: number,
  shape: { openOthers: boolean; instants: number; spreadLines: boolean },
): Instance => {
  const { random, upTo, someOf } = generatorOf(seed);
  const keys = KEYS.slice(0, 2 + upTo(2));
  const capacity = new Map(keys.map((key) => [key, 0]));
  for (let unit = upTo(8); unit > 0; unit -= 1) {
    const key = keys[upTo(keys.length - 1)] ?? "a";
    capacity.set(key, (capacity.get(key) ?? 0) + 1);
  }
  // A demand may name a combination that has no unit at all.
  const namable = [...keys, "none"];
  const instants = Array.from({ length: upTo(shape.instants) }, () =>
    Array.from({ length: upTo(3) }, () => ({
      combinationKeys: shape.openOthers ? someOf(namable, 1) : someOf(namable, 1).slice(0, 1),
      quantity: 1 + upTo(1),
    })),
  );
  const lines = Array.from({ length: 1 + upTo(4) }, (): StockLine => {
    const single = !shape.spreadLines || random() < 0.4;
    const quantity = 1 + upTo(1);
    return {
      quantity,
      single,
      candidates: random() < 0.1 ? [] : someOf(namable, 1),
      held: single || random() < 0.6 ? [] : someOf(keys, 1).slice(0, 1 + upTo(quantity - 1)),
    };
  });
  return { capacity, instants, lines };
};

// --- The rule, read by brute force ------------------------------------------------

/**
 * The most units a set of demands can get, by trying every assignment of
 * every unit asked to a combination it accepts, or to none.
 */
const mostServedByAssignment = (
  demands: readonly StockDemand[],
  capacity: ReadonlyMap<string, number>,
): number => {
  const keys = [...capacity.keys()];
  const limits = keys.map((key) => Math.max(0, capacity.get(key) ?? 0));
  const radix = limits.reduce<number[]>(
    (radices, _limit, index) => [
      ...radices,
      index === 0 ? 1 : (radices[index - 1] ?? 1) * ((limits[index - 1] ?? 0) + 1),
    ],
    [],
  );
  const states = limits.reduce((product, limit) => product * (limit + 1), 1);
  const unitsAsked = demands.flatMap((demand) =>
    Array.from({ length: demand.quantity }, () =>
      keys.flatMap((key, index) => (demand.combinationKeys.includes(key) ? [index] : [])),
    ),
  );
  // best[state]: the most served so far with `state` units taken per combination.
  let best = new Int16Array(states).fill(-1);
  best[0] = 0;
  for (const accepted of unitsAsked) {
    const next = Int16Array.from(best);
    for (let state = 0; state < states; state += 1) {
      const served = best[state] ?? -1;
      if (served < 0) continue;
      for (const index of accepted) {
        const taken = Math.floor(state / (radix[index] ?? 1)) % ((limits[index] ?? 0) + 1);
        if (taken >= (limits[index] ?? 0)) continue;
        const after = state + (radix[index] ?? 1);
        if ((next[after] ?? -1) < served + 1) next[after] = served + 1;
      }
    }
    best = next;
  }
  return Math.max(...best);
};

/** What each line gets, and where a single line is placed, by the words of the rule. */
const allocateByRule = (instance: Instance): StockLineAllocation[] => {
  const { capacity, lines } = instance;
  const instants = instance.instants.length > 0 ? instance.instants : [[]];
  const alone = instants.map((demands) => mostServedByAssignment(demands, capacity));
  const known = new Map<string, boolean>();
  /** Fits: at every instant, others and request get what others get alone, plus the request. */
  const fits = (request: readonly StockDemand[]) => {
    const key = JSON.stringify(request.filter((demand) => demand.quantity > 0));
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const asked = sum(request.map((demand) => demand.quantity));
    const answer = instants.every(
      (demands, index) =>
        mostServedByAssignment([...demands, ...request], capacity) === (alone[index] ?? 0) + asked,
    );
    known.set(key, answer);
    return answer;
  };
  const largestFitting = (most: number, demandOf: (quantity: number) => StockDemand) => {
    for (let quantity = most; quantity > 0; quantity -= 1) {
      if (fits([...granted, demandOf(quantity)])) return quantity;
    }
    return 0;
  };

  const granted: StockDemand[] = [];
  const heldOf = (line: StockLine) => (line.held ?? []).slice(0, line.quantity);
  const servedHeld = lines.map((line) => {
    let served = 0;
    for (const key of heldOf(line)) {
      const unit = { combinationKeys: [key], quantity: 1 };
      if (fits([...granted, unit])) {
        granted.push(unit);
        served += 1;
      }
    }
    return served;
  });

  return lines.map((line, index) => {
    const free = line.quantity - heldOf(line).length;
    const held = servedHeld[index] ?? 0;
    if (!line.single) {
      const served = largestFitting(free, (quantity) => ({
        combinationKeys: line.candidates,
        quantity,
      }));
      granted.push({ combinationKeys: line.candidates, quantity: served });
      return { served: held + served, combinationKey: null };
    }
    // A combination with no unit is no candidate.
    const candidates = [...new Set(line.candidates)].filter((key) => (capacity.get(key) ?? 0) > 0);
    const on = (key: string, quantity: number) => ({ combinationKeys: [key], quantity });
    const later = lines
      .slice(index + 1)
      .flatMap((next) =>
        next.single
          ? []
          : [{ combinationKeys: next.candidates, quantity: next.quantity - heldOf(next).length }],
      );
    let placed =
      candidates.find((key) => fits([...granted, on(key, free), ...later])) ??
      candidates.find((key) => fits([...granted, on(key, free)]));
    let served = free;
    if (placed === undefined) {
      served = -1;
      for (const key of candidates) {
        const most = largestFitting(free - 1, (quantity) => on(key, quantity));
        if (most > served) {
          served = most;
          placed = key;
        }
      }
      served = Math.max(0, served);
    }
    if (placed !== undefined) granted.push(on(placed, served));
    return { served: held + served, combinationKey: placed ?? line.candidates[0] ?? null };
  });
};

const SEEDS = Array.from({ length: 2_000 }, (_, index) => index + 1);

describe("allocateStock against the rule read by brute force", () => {
  test("each line gets what the rule gives it, on the combination the rule names", () => {
    for (const seed of SEEDS) {
      const instance = instanceOf(seed, { openOthers: true, instants: 5, spreadLines: true });
      assert.deepEqual(allocate(instance), allocateByRule(instance), `seed ${seed}`);
    }
  });

  test("the folded check answers as the rule written as a flow per instant", () => {
    for (const seed of SEEDS) {
      const instance = instanceOf(seed, { openOthers: true, instants: 5, spreadLines: true });
      assert.deepEqual(allocate(instance), allocate(instance, "literal"), `seed ${seed}`);
    }
  });

  test("with no open demand, the room left per combination answers as the flows do", () => {
    for (const seed of SEEDS) {
      // Others asked exact combinations or held units; the cart's lines are single.
      const instance = instanceOf(-seed, { openOthers: false, instants: 5, spreadLines: false });
      assert.deepEqual(allocate(instance), allocate(instance, "literal"), `seed -${seed}`);
    }
  });

  test("the answer does not depend on the order of the stock or of the other bookings", () => {
    for (const seed of SEEDS) {
      const instance = instanceOf(seed, { openOthers: true, instants: 5, spreadLines: true });
      const { shuffled } = generatorOf(seed * 7919);
      const bookings = bookingsOf(instance.instants);
      const reordered = allocateStock({
        capacity: new Map(shuffled([...instance.capacity])),
        bookings: shuffled(bookings).map((booking) => ({
          ...booking,
          demand: { ...booking.demand, combinationKeys: shuffled(booking.demand.combinationKeys) },
        })),
        lines: instance.lines,
      });
      assert.deepEqual(reordered, allocate(instance), `seed ${seed}`);
    }
  });

  test("the flow serves as many units as the best assignment", () => {
    for (const seed of SEEDS) {
      const { capacity, instants } = instanceOf(seed, {
        openOthers: true,
        instants: 3,
        spreadLines: true,
      });
      for (const demands of instants) {
        assert.equal(
          maxServed(demands, (key) => capacity.get(key) ?? 0),
          mostServedByAssignment(demands, capacity),
          `seed ${seed}`,
        );
      }
    }
  });
});

// --- Physical units ---------------------------------------------------------------

/**
 * Where the rule must agree with real units: one instant, others that each
 * name one combination, and lines that are spread or name one combination.
 * Every unit is a bit; a request fits when some set of units, one per unit
 * asked, leaves the others as many units as they had.
 */
const servedByPhysicalUnits = (instance: Instance): number[] => {
  const units = [...instance.capacity].flatMap(([key, count]) =>
    Array.from({ length: count }, () => key),
  );
  const full = (1 << units.length) - 1;
  const bitCount = (mask: number) => {
    let count = 0;
    for (let rest = mask; rest > 0; rest >>>= 1) count += rest & 1;
    return count;
  };
  const others = instance.instants[0] ?? [];
  /** The most units the others get from the free ones, each unit to one booking. */
  const othersServed = (free: number) => {
    let reachable = new Set([0]);
    for (const demand of others) {
      for (let unit = 0; unit < demand.quantity; unit += 1) {
        const next = new Set(reachable);
        for (const used of reachable) {
          for (const [bit, key] of units.entries()) {
            if (free & (1 << bit) && !(used & (1 << bit)) && demand.combinationKeys.includes(key)) {
              next.add(used | (1 << bit));
            }
          }
        }
        reachable = next;
      }
    }
    return Math.max(...[...reachable].map(bitCount));
  };
  const before = othersServed(full);
  const leavesOthers = Array.from(
    { length: full + 1 },
    (_, taken) => othersServed(full ^ taken) === before,
  );

  const lines = instance.lines;
  const held: string[] = [];
  const free = lines.map(() => 0);
  const possible = () => {
    let taken = 0;
    for (const key of held) {
      const bit = units.findIndex((unit, index) => unit === key && !(taken & (1 << index)));
      if (bit < 0) return false;
      taken |= 1 << bit;
    }
    let reach = new Set([taken]);
    for (const [index, line] of lines.entries()) {
      const next = new Set<number>();
      for (let mask = 0; mask <= full; mask += 1) {
        if (bitCount(mask) !== free[index]) continue;
        const keys = units.filter((_, bit) => mask & (1 << bit));
        if (keys.some((key) => !line.candidates.includes(key))) continue;
        for (const used of reach) if (!(used & mask)) next.add(used | mask);
      }
      reach = next;
    }
    return [...reach].some((used) => leavesOthers[used]);
  };
  const heldCount = lines.map((line) => {
    let count = 0;
    for (const key of (line.held ?? []).slice(0, line.quantity)) {
      held.push(key);
      if (possible()) count += 1;
      else held.pop();
    }
    return count;
  });
  for (const [index, line] of lines.entries()) {
    const most = line.quantity - (line.held ?? []).slice(0, line.quantity).length;
    for (free[index] = most; (free[index] ?? 0) > 0; free[index] = (free[index] ?? 0) - 1) {
      if (possible()) break;
    }
  }
  return free.map((count, index) => count + (heldCount[index] ?? 0));
};

describe("allocateStock against physical units", () => {
  test("where nothing is placed afresh, the rule gives what real units give", () => {
    for (const seed of SEEDS.slice(0, 600)) {
      const instance = instanceOf(seed + 50_000, {
        openOthers: false,
        instants: 1,
        spreadLines: true,
      });
      // A single line names one combination: no choice is left to revisit.
      const lines = instance.lines.map((line) =>
        line.single ? { ...line, candidates: line.candidates.slice(0, 1) } : line,
      );
      const physical = { ...instance, instants: instance.instants.slice(0, 1), lines };
      assert.deepEqual(
        allocate(physical).map((allocation) => allocation.served),
        servedByPhysicalUnits(physical),
        `seed ${seed + 50_000}`,
      );
    }
  });
});

// --- Named cases ---------------------------------------------------------------

const axes: BookingAttributeAxis[] = [
  { key: "size", label: "Size", position: 0 },
  { key: "color", label: "Color", position: 1 },
];
const combination = (size: string, color: string): StockCombination => ({
  combinationKey: `size:${size}|color:${color}`,
  selectedAttributes: { size, color },
});
const M_RED = combination("M", "red");
const M_BLUE = combination("M", "blue");
const L_RED = combination("L", "red");
const combinations = [L_RED, M_BLUE, M_RED];
const oneOfEach = new Map(combinations.map(({ combinationKey }) => [combinationKey, 1]));

const serving = (choice: Parameters<typeof combinationsServing>[2]) =>
  combinationsServing(axes, combinations, choice);
const exact = (target: StockCombination, quantity = 1): StockLine => ({
  quantity,
  candidates: [target.combinationKey],
  single: true,
});
const open = (candidates: string[], quantity: number): StockLine => ({
  quantity,
  candidates,
  single: false,
});
const servedOf = (instance: Instance) => allocate(instance).map((allocation) => allocation.served);

describe("allocateStock, named cases", () => {
  test("another booking that chose only a size is counted on the sizes it needs", () => {
    // Two M are promised to a booking that left the colour open: no M is left.
    const others = [
      { combinationKeys: serving({ selectedAttributes: { size: "M" } }), quantity: 2 },
    ];

    assert.deepEqual(others[0]?.combinationKeys, [M_BLUE.combinationKey, M_RED.combinationKey]);
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [others], lines: [exact(M_RED)] }),
      [0],
    );
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [others], lines: [exact(L_RED)] }),
      [1],
    );
  });

  test("choices that overlap without nesting are served together", () => {
    const medium = serving({ selectedAttributes: { size: "M" } });
    const red = serving({ selectedAttributes: { color: "red" } });

    // "M" then "red ×2": the first line has to leave the M/red to the second.
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [], lines: [open(medium, 1), open(red, 2)] }),
      [1, 2],
    );

    // The same two choices, booked by others: one unit is left, and only one fits it.
    const others = [
      { combinationKeys: medium, quantity: 1 },
      { combinationKeys: red, quantity: 1 },
    ];
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [others], lines: [open(red, 2)] }),
      [1],
    );
    assert.deepEqual(
      servedOf({
        capacity: oneOfEach,
        instants: [[...others, { combinationKeys: red, quantity: 1 }]],
        lines: [exact(M_BLUE)],
      }),
      [0],
    );
  });

  test("a unit another booking holds counts on that unit's combination", () => {
    const others = [{ combinationKeys: [M_RED.combinationKey], quantity: 1 }];
    const medium = serving({ selectedAttributes: { size: "M" } });

    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [others], lines: [open(medium, 2)] }),
      [1],
    );
  });

  test("a unit the line holds stays on its combination, and is not replaced when it does not fit", () => {
    const holdingMediumRed = { ...open(serving({}), 2), held: [M_RED.combinationKey] };

    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [], lines: [holdingMediumRed] }),
      [2],
    );
    // Another booking owns M/red: the held unit is short, and one unit floats.
    assert.deepEqual(
      servedOf({
        capacity: oneOfEach,
        instants: [[{ combinationKeys: [M_RED.combinationKey], quantity: 1 }]],
        lines: [holdingMediumRed],
      }),
      [1],
    );
  });

  test("a unit held by a later line is not taken by an earlier one", () => {
    const anyUnit = serving({});
    assert.deepEqual(
      servedOf({
        capacity: new Map([[M_RED.combinationKey, 1]]),
        instants: [],
        lines: [open(anyUnit, 1), { ...open(anyUnit, 1), held: [M_RED.combinationKey] }],
      }),
      [0, 1],
    );
  });

  test("a value chosen on an axis the product dropped no longer narrows the line", () => {
    const sizeOnly = [axes[0]].flatMap((axis) => (axis ? [axis] : []));
    const bySize: StockCombination[] = [
      { combinationKey: "size:L", selectedAttributes: { size: "L" } },
      { combinationKey: "size:M", selectedAttributes: { size: "M" } },
    ];
    // Booked as "M, red" with no exact combination, before the colour axis went.
    const booked = { combinationKey: null, selectedAttributes: { size: "M", color: "red" } };

    assert.deepEqual(combinationsServing(sizeOnly, bySize, booked), ["size:M"]);
    // Booked with no size at all on the default key: any unit serves it.
    assert.deepEqual(combinationsServing(sizeOnly, bySize, { combinationKey: "__default" }), [
      "size:L",
      "size:M",
    ]);
    // Without axes the default key is the product's one combination.
    assert.deepEqual(
      combinationsServing([], [{ combinationKey: "__default", selectedAttributes: {} }], {
        combinationKey: "__default",
      }),
      ["__default"],
    );
  });

  test("a combination with no unit serves nobody, and its bookings ask nothing of the others", () => {
    const none = combination("S", "red");
    assert.deepEqual(serving(none), []);

    // A line on it gets nothing, in either form.
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [], lines: [exact(none), open([], 2)] }),
      [0, 0],
    );
    // Another booking on it lacks its unit whatever the request takes.
    const others = [{ combinationKeys: [none.combinationKey], quantity: 2 }];
    assert.deepEqual(
      servedOf({ capacity: oneOfEach, instants: [others], lines: [open(serving({}), 3)] }),
      [3],
    );
  });

  test("bookings the store placed over its stock take what there is, and no more", () => {
    // Two bookings for the one M/red: the L/red is still free, the M/red is not.
    const others = [{ combinationKeys: [M_RED.combinationKey], quantity: 2 }];
    const capacity = new Map([
      [M_RED.combinationKey, 1],
      [L_RED.combinationKey, 1],
    ]);

    assert.deepEqual(servedOf({ capacity, instants: [others], lines: [exact(L_RED)] }), [1]);
    assert.deepEqual(servedOf({ capacity, instants: [others], lines: [exact(M_RED)] }), [0]);
    // An open booking over the stock leaves nothing: any unit serves it.
    const anyUnit = [{ combinationKeys: [...capacity.keys()], quantity: 3 }];
    assert.deepEqual(servedOf({ capacity, instants: [anyUnit], lines: [exact(L_RED)] }), [0]);
  });

  test("a single line takes its first candidate that leaves room for the spread lines after it", () => {
    const medium = [M_BLUE.combinationKey, M_RED.combinationKey];
    const choosing = { quantity: 1, candidates: medium, single: true };
    const placedOf = (lines: StockLine[]) =>
      allocateStock({ capacity: oneOfEach, bookings: [], lines }).map((allocation) => [
        allocation.served,
        allocation.combinationKey,
      ]);

    // A later spread line that only M/blue serves: the first line leaves it.
    assert.deepEqual(placedOf([choosing, open([M_BLUE.combinationKey], 1)]), [
      [1, M_RED.combinationKey],
      [1, null],
    ]);
    // Alone, it resolves to the first candidate, as it always did.
    assert.deepEqual(placedOf([choosing]), [[1, M_BLUE.combinationKey]]);
    // A later single line is not looked ahead to: the first placement stays,
    // and the second line is short. Only rearranging the first would fit it.
    assert.deepEqual(placedOf([choosing, exact(M_BLUE)]), [
      [1, M_BLUE.combinationKey],
      [0, M_BLUE.combinationKey],
    ]);
  });

  test("a single line short of stock takes the most one combination has, and names it", () => {
    const capacity = new Map([
      [M_BLUE.combinationKey, 1],
      [M_RED.combinationKey, 2],
    ]);
    const [short] = allocateStock({
      capacity,
      bookings: [],
      lines: [{ quantity: 3, candidates: [...capacity.keys()], single: true }],
    });
    assert.deepEqual(short, { served: 2, combinationKey: M_RED.combinationKey });

    const [none] = allocateStock({
      capacity: new Map([[M_BLUE.combinationKey, 0]]),
      bookings: [],
      lines: [{ quantity: 1, candidates: [M_BLUE.combinationKey], single: true }],
    });
    assert.deepEqual(none, { served: 0, combinationKey: M_BLUE.combinationKey });
  });

  test("open choices are placed afresh at each instant, the request's spread lines too", () => {
    const capacity = new Map([
      ["M", 1],
      ["L", 1],
    ]);
    // The M is out on Monday and the L on Tuesday: a spread line gets the L,
    // then the M. The rule counts quantities, not the same unit throughout.
    const instants = [
      [{ combinationKeys: ["M"], quantity: 1 }],
      [{ combinationKeys: ["L"], quantity: 1 }],
    ];
    assert.deepEqual(servedOf({ capacity, instants, lines: [open(["M", "L"], 1)] }), [1]);
    // A single line keeps one combination: neither is free on both days.
    assert.deepEqual(
      servedOf({ capacity, instants, lines: [{ ...open(["M", "L"], 1), single: true }] }),
      [0],
    );

    // Two bookings of any size, each on its own day: one unit is left each day.
    const anySize = [{ combinationKeys: ["M", "L"], quantity: 1 }];
    assert.deepEqual(
      servedOf({ capacity, instants: [anySize, anySize], lines: [open(["M", "L"], 2)] }),
      [1],
    );
  });

  test("a booking that ends when another starts does not meet it", () => {
    const capacity = new Map([["a", 2]]);
    const demand = { combinationKeys: ["a"], quantity: 1 };
    const line = { quantity: 1, candidates: ["a"], single: true };
    const served = (bookings: StockBooking[]) =>
      allocateStock({ capacity, bookings, lines: [line] }).map((allocation) => allocation.served);

    assert.deepEqual(
      served([
        { start: 0, end: 2, demand },
        { start: 2, end: 4, demand },
      ]),
      [1],
    );
    assert.deepEqual(
      served([
        { start: 0, end: 3, demand },
        { start: 2, end: 4, demand },
      ]),
      [0],
    );
    // A span of no length holds nothing.
    assert.deepEqual(
      served([
        { start: 3, end: 3, demand: { ...demand, quantity: 2 } },
        { start: 5, end: 4, demand: { ...demand, quantity: 2 } },
      ]),
      [1],
    );
  });
});

// --- First fit, and its limit ------------------------------------------------------

describe("allocateStock places single lines first fit, never revisiting one", () => {
  /**
   * The review's instance: eight combinations, the first four of seven units
   * and the others of five, one unit of each out every day of a month; a cart
   * of four lines of 4 then four of 6, each free to take any combination.
   * Rearranged, the 6s on the sevens and the 4s on the fives, it fits. First
   * fit in line order puts the 4s on the sevens, and the first 6 finds no
   * combination with six left: the cart is refused, at its fifth line.
   */
  const keys = Array.from({ length: 8 }, (_, index) => `c${index}`);
  const capacity = new Map(keys.map((key, index) => [key, index < 4 ? 7 : 5]));
  const bookings = Array.from({ length: 30 }, (_, day) =>
    keys.map((key) => ({
      start: day,
      end: day + 1,
      demand: { combinationKeys: [key], quantity: 1 },
    })),
  ).flat();
  const lines = [4, 4, 4, 4, 6, 6, 6, 6].map((quantity) => ({
    quantity,
    candidates: keys,
    single: true,
  }));
  const expected = [
    { served: 4, combinationKey: "c0" },
    { served: 4, combinationKey: "c1" },
    { served: 4, combinationKey: "c2" },
    { served: 4, combinationKey: "c3" },
    // Short from here on: each takes the most a combination has left.
    { served: 4, combinationKey: "c4" },
    { served: 4, combinationKey: "c5" },
    { served: 4, combinationKey: "c6" },
    { served: 4, combinationKey: "c7" },
  ];

  test("the 4s take the sevens and the first 6 is short", () => {
    assert.deepEqual(allocateStock({ capacity, bookings, lines }), expected);
  });

  test("the answer is the same on every run", () => {
    for (let run = 0; run < 1_000; run += 1) {
      assert.deepEqual(allocateStock({ capacity, bookings, lines }), expected, `run ${run}`);
    }
  });

  test("lines that fit in their order are all served", () => {
    const reordered = [...lines].sort((a, b) => b.quantity - a.quantity);
    assert.deepEqual(
      allocateStock({ capacity, bookings, lines: reordered }).map(
        (allocation) => allocation.served,
      ),
      [6, 6, 6, 6, 4, 4, 4, 4],
    );
  });
});

// --- Cost ------------------------------------------------------------------------

describe("allocateStock cost", () => {
  /**
   * 200 units in 20 combinations of ten; 3,000 bookings of one unit, each
   * starting one step after the last and lasting 140 steps; a cart of one
   * unit of each combination. `open` of them leave a choice open.
   */
  const fixture = (open: number) => {
    const keys = Array.from({ length: 20 }, (_, index) => `c${index}`);
    const every = Math.floor(3_000 / Math.max(1, open));
    return {
      capacity: new Map(keys.map((key) => [key, 10])),
      bookings: Array.from({ length: 3_000 }, (_, index) => ({
        start: index,
        end: index + 140,
        demand: {
          combinationKeys:
            open > 0 && index % every === every / 2
              ? keys.filter((_, key) => key % 2 === index % 2 || key < 3)
              : [keys[index % 20] ?? "c0"],
          quantity: 1,
        },
      })),
      lines: keys.map((key) => ({ quantity: 1, candidates: [key], single: true })),
    };
  };
  const fastestOf = (input: ReturnType<typeof fixture>) => {
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      const allocations = allocateStock(input);
      fastest = Math.min(fastest, performance.now() - started);
      assert.ok(allocations.every((allocation) => allocation.served === 1));
    }
    return fastest;
  };

  test("3,000 exact bookings: under 50 ms", () => {
    const input = fixture(0);
    assert.ok(input.bookings.every((booking) => booking.demand.combinationKeys.length === 1));
    const elapsed = fastestOf(input);
    assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`);
  });

  test("the same with 30 open choices: under 300 ms", () => {
    const input = fixture(30);
    assert.equal(
      input.bookings.filter((booking) => booking.demand.combinationKeys.length > 1).length,
      30,
    );
    const elapsed = fastestOf(input);
    assert.ok(elapsed < 300, `${elapsed.toFixed(1)} ms`);
  });
});
