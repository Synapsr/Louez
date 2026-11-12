import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

import type { BookingAttributeAxis } from "@louez/types";

import type { StockCombination, StockDemand, StockLine } from "./stock-allocation";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so hand them over through require.
const require = createRequire(import.meta.url);
const variantUtils: Record<string, unknown> = require("@louez/utils");
mock.module("@louez/utils", { namedExports: variantUtils });

const { STOCK_SEARCH_BUDGET, allocateStock, combinationsServing, demandInstants, maxServed } =
  await import("./stock-allocation");

// --- A brute-force reading of the rule, to compare with ----------------------

type Instance = {
  capacity: Map<string, number>;
  instants: StockDemand[][];
  lines: StockLine[];
};

const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

/** Every subset of a list. */
const subsetsOf = <T>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>((subsets, item) => [...subsets, ...subsets.map((s) => [...s, item])], [[]]);

/**
 * The most units a set of demands can get, by the cut that bounds it: for a
 * set of combinations, its capacity plus every demand that accepts a
 * combination of the stock outside it. No flow is computed.
 */
const mostServed = (demands: readonly StockDemand[], capacity: ReadonlyMap<string, number>) =>
  Math.min(
    ...subsetsOf([...capacity.keys()]).map(
      (inside) =>
        sum(inside.map((key) => Math.max(0, capacity.get(key) ?? 0))) +
        sum(
          demands
            .filter((demand) =>
              demand.combinationKeys.some((key) => capacity.has(key) && !inside.includes(key)),
            )
            .map((demand) => demand.quantity),
        ),
    ),
  );

/** Every way to split a quantity over the candidates, in their order. */
const splitsOf = (candidates: readonly string[], quantity: number): Array<Map<string, number>> => {
  const [first, ...rest] = candidates;
  if (first === undefined) return quantity === 0 ? [new Map()] : [];
  const splits: Array<Map<string, number>> = [];
  for (let taken = quantity; taken >= 0; taken -= 1) {
    for (const split of splitsOf(rest, quantity - taken)) {
      splits.push(taken > 0 ? new Map([[first, taken], ...split]) : split);
    }
  }
  return splits;
};

/** Whether the request, taken where `usage` says, leaves the other bookings what they had. */
const leavesOthersServed = (instance: Instance, usage: ReadonlyMap<string, number>): boolean => {
  const left = new Map(
    [...instance.capacity].map(([key, units]) => [key, units - (usage.get(key) ?? 0)]),
  );
  if ([...left.values()].some((units) => units < 0)) return false;
  if ([...usage.keys()].some((key) => !instance.capacity.has(key) && (usage.get(key) ?? 0) > 0)) {
    return false;
  }
  const instants = instance.instants.length > 0 ? instance.instants : [[]];
  return instants.every(
    (demands) => mostServed(demands, left) === mostServed(demands, instance.capacity),
  );
};

type Grant = { held: string[]; free: number };

/** Whether some arrangement gives every line what it is granted. */
const canArrange = (instance: Instance, grants: readonly Grant[]): boolean => {
  const choicesPerLine = instance.lines.map((line, index) => {
    const free = grants[index]?.free ?? 0;
    if (free === 0) return [new Map<string, number>()];
    return line.single
      ? line.candidates.map((key) => new Map([[key, free]]))
      : splitsOf(line.candidates, free);
  });
  const search = (index: number, usage: Map<string, number>): boolean => {
    const choices = choicesPerLine[index];
    if (!choices) return leavesOthersServed(instance, usage);
    return choices.some((choice) => {
      const next = new Map(usage);
      for (const [key, quantity] of choice) next.set(key, (next.get(key) ?? 0) + quantity);
      return search(index + 1, next);
    });
  };
  const held = new Map<string, number>();
  for (const grant of grants) {
    for (const key of grant.held) held.set(key, (held.get(key) ?? 0) + 1);
  }
  return search(0, held);
};

/** What each line gets by the rule's own words: held units first, then the lines in order. */
const servedByRule = (instance: Instance): number[] => {
  const grants: Grant[] = instance.lines.map(() => ({ held: [], free: 0 }));
  const heldOf = (line: StockLine) => (line.held ?? []).slice(0, line.quantity);
  for (const [index, line] of instance.lines.entries()) {
    const grant = grants[index];
    if (!grant) continue;
    for (const key of heldOf(line)) {
      grant.held.push(key);
      if (!canArrange(instance, grants)) grant.held.pop();
    }
  }
  for (const [index, line] of instance.lines.entries()) {
    const grant = grants[index];
    if (!grant) continue;
    for (let free = line.quantity - heldOf(line).length; free >= 0; free -= 1) {
      grant.free = free;
      if (canArrange(instance, grants)) break;
    }
  }
  return grants.map((grant) => grant.held.length + grant.free);
};

// --- Seeded instances ---------------------------------------------------------

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

const instanceOf = (seed: number): Instance => {
  const random = randomFrom(seed);
  const upTo = (max: number) => Math.floor(random() * (max + 1));
  const shuffled = <T>(items: readonly T[]) =>
    items
      .map((item) => ({ item, order: random() }))
      .sort((a, b) => a.order - b.order)
      .map(({ item }) => item);
  const someOf = (items: readonly string[], atLeast: number) =>
    shuffled(items).slice(0, Math.max(atLeast, 1 + upTo(items.length - 1)));

  // Two to four combinations, six units at most, some combinations empty.
  const keys = KEYS.slice(0, 2 + upTo(2));
  const capacity = new Map(keys.map((key) => [key, 0]));
  for (let unit = upTo(6); unit > 0; unit -= 1) {
    const key = keys[upTo(keys.length - 1)] ?? "a";
    capacity.set(key, (capacity.get(key) ?? 0) + 1);
  }
  // A demand may name a combination that has no unit at all.
  const namable = [...keys, "none"];

  const instants = Array.from({ length: upTo(3) }, () =>
    Array.from({ length: upTo(3) }, () => ({
      combinationKeys: someOf(namable, 1),
      quantity: 1 + upTo(2),
    })),
  );
  const lines = Array.from({ length: 1 + upTo(2) }, (): StockLine => {
    const single = random() < 0.4;
    const quantity = 1 + upTo(2);
    return {
      quantity,
      single,
      candidates: random() < 0.1 ? [] : someOf(namable, 1),
      held: single || random() < 0.6 ? [] : someOf(keys, 1).slice(0, 1 + upTo(quantity - 1)),
    };
  });
  return { capacity, instants, lines };
};

/**
 * One unit per combination and a different one taken at each instant: the
 * instances where a line's first choice suits every instant taken alone and
 * still has to be given up.
 */
const tightInstanceOf = (seed: number): Instance => {
  const random = randomFrom(seed);
  const upTo = (max: number) => Math.floor(random() * (max + 1));
  const someOf = (atLeast: number) =>
    KEYS.map((key) => ({ key, order: random() }))
      .sort((a, b) => a.order - b.order)
      .map(({ key }) => key)
      .slice(0, atLeast + upTo(KEYS.length - atLeast));

  return {
    capacity: new Map(KEYS.map((key) => [key, 1])),
    instants: Array.from({ length: 2 + upTo(1) }, () =>
      Array.from({ length: 1 + upTo(1) }, () => ({
        combinationKeys: someOf(1).slice(0, 1),
        quantity: 1,
      })),
    ),
    lines: Array.from({ length: 2 + upTo(1) }, () => ({
      quantity: 1,
      candidates: someOf(2),
      single: random() < 0.3,
    })),
  };
};

const INSTANCES = [
  ...Array.from({ length: 1_500 }, (_, index) => ({
    seed: index + 1,
    instance: instanceOf(index + 1),
  })),
  ...Array.from({ length: 1_500 }, (_, index) => ({
    seed: -(index + 1),
    instance: tightInstanceOf(index + 1),
  })),
];

describe("allocateStock against the rule read by brute force", () => {
  test("each line is served the most that fits, and the request fits when the rule says so", () => {
    for (const { seed, instance } of INSTANCES) {
      const expected = servedByRule(instance);
      const allocations = allocateStock(instance);

      assert.deepEqual(
        allocations.map((allocation) => allocation.served),
        expected,
        `seed ${seed}`,
      );
      const whole = instance.lines.map((line) => ({
        held: (line.held ?? []).slice(0, line.quantity),
        free: line.quantity - (line.held ?? []).slice(0, line.quantity).length,
      }));
      assert.equal(
        allocations.every(
          (allocation, index) => allocation.served === instance.lines[index]?.quantity,
        ),
        canArrange(instance, whole),
        `seed ${seed}`,
      );
    }
  });

  test("the combinations taken are an arrangement the rule accepts", () => {
    for (const { seed, instance } of INSTANCES) {
      const allocations = allocateStock(instance);
      const usage = new Map<string, number>();

      for (const [index, allocation] of allocations.entries()) {
        const line = instance.lines[index];
        assert.ok(line);
        assert.equal(sum(allocation.byCombination.values()), allocation.served, `seed ${seed}`);
        const allowed = new Set([...line.candidates, ...(line.held ?? [])]);
        for (const [key, quantity] of allocation.byCombination) {
          assert.ok(allowed.has(key), `seed ${seed}: line ${index} on ${key}`);
          usage.set(key, (usage.get(key) ?? 0) + quantity);
        }
        if (line.single && (line.held ?? []).length === 0) {
          assert.ok(allocation.byCombination.size <= 1, `seed ${seed}: one combination`);
        }
      }
      assert.ok(leavesOthersServed(instance, usage), `seed ${seed}`);
    }
  });

  test("the answer does not depend on the order of the other bookings", () => {
    for (const { seed, instance } of INSTANCES) {
      const random = randomFrom(seed * 7919);
      const shuffled = <T>(items: readonly T[]) =>
        items
          .map((item) => ({ item, order: random() }))
          .sort((a, b) => a.order - b.order)
          .map(({ item }) => item);
      const reordered = {
        capacity: new Map(shuffled([...instance.capacity])),
        instants: shuffled(instance.instants).map((demands) =>
          shuffled(demands).map((demand) => ({
            ...demand,
            combinationKeys: shuffled(demand.combinationKeys),
          })),
        ),
        lines: instance.lines,
      };

      assert.deepEqual(allocateStock(reordered), allocateStock(instance), `seed ${seed}`);
      assert.deepEqual(allocateStock(instance), allocateStock(instance), `seed ${seed}`);
    }
  });

  test("the flow serves as many units as the tightest cut allows", () => {
    for (const { seed, instance } of INSTANCES) {
      const { capacity, instants } = instance;
      for (const demands of instants) {
        assert.equal(
          maxServed(demands, (key) => capacity.get(key) ?? 0),
          mostServed(demands, capacity),
          `seed ${seed}`,
        );
      }
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
const servedOf = (input: Parameters<typeof allocateStock>[0]) =>
  allocateStock(input).map((allocation) => allocation.served);

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

  test("choices that overlap without nesting are placed together", () => {
    const medium = serving({ selectedAttributes: { size: "M" } });
    const red = serving({ selectedAttributes: { color: "red" } });

    // "M" then "red ×2": taking M/red for the first line would strand the second.
    const allocations = allocateStock({
      capacity: oneOfEach,
      instants: [],
      lines: [open([M_RED.combinationKey, M_BLUE.combinationKey], 1), open(red, 2)],
    });
    assert.deepEqual(
      allocations.map((allocation) => [allocation.served, [...allocation.byCombination]]),
      [
        [1, [[M_BLUE.combinationKey, 1]]],
        [
          2,
          [
            [M_RED.combinationKey, 1],
            [L_RED.combinationKey, 1],
          ],
        ],
      ],
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
    const anyUnit = serving({});
    const holdingMediumRed = { ...open(anyUnit, 2), held: [M_RED.combinationKey] };

    // Free stock: the held M/red, then the first unit in the order of the candidates.
    assert.deepEqual(
      [
        ...(allocateStock({ capacity: oneOfEach, instants: [], lines: [holdingMediumRed] })[0]
          ?.byCombination ?? []),
      ],
      [
        [L_RED.combinationKey, 1],
        [M_RED.combinationKey, 1],
      ],
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
    const allocations = allocateStock({
      capacity: new Map([[M_RED.combinationKey, 1]]),
      instants: [],
      lines: [open(anyUnit, 1), { ...open(anyUnit, 1), held: [M_RED.combinationKey] }],
    });

    assert.deepEqual(
      allocations.map((allocation) => allocation.served),
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

  test("a single line takes its first candidate that leaves room for the lines after it", () => {
    const medium = [M_BLUE.combinationKey, M_RED.combinationKey];
    const allocations = allocateStock({
      capacity: oneOfEach,
      instants: [],
      lines: [{ quantity: 1, candidates: medium, single: true }, exact(M_BLUE)],
    });

    assert.deepEqual(
      allocations.map((allocation) => [...allocation.byCombination]),
      [[[M_RED.combinationKey, 1]], [[M_BLUE.combinationKey, 1]]],
    );
    // Alone, it resolves to the first candidate, as it always did.
    assert.deepEqual(
      [
        ...(allocateStock({
          capacity: oneOfEach,
          instants: [],
          lines: [{ quantity: 1, candidates: medium, single: true }],
        })[0]?.byCombination ?? []),
      ],
      [[M_BLUE.combinationKey, 1]],
    );
  });

  test("a single line short of stock takes the most one combination has, and names it", () => {
    const capacity = new Map([
      [M_BLUE.combinationKey, 1],
      [M_RED.combinationKey, 2],
    ]);
    const [short] = allocateStock({
      capacity,
      instants: [],
      lines: [{ quantity: 3, candidates: [...capacity.keys()], single: true }],
    });
    assert.deepEqual(
      [short?.served, [...(short?.byCombination ?? [])]],
      [2, [[M_RED.combinationKey, 2]]],
    );

    const [none] = allocateStock({
      capacity: new Map([[M_BLUE.combinationKey, 0]]),
      instants: [],
      lines: [{ quantity: 1, candidates: [M_BLUE.combinationKey], single: true }],
    });
    assert.deepEqual(
      [none?.served, [...(none?.byCombination ?? [])]],
      [0, [[M_BLUE.combinationKey, 0]]],
    );
  });

  test("the request keeps the same units over every instant of its window", () => {
    const capacity = new Map([
      ["M", 1],
      ["L", 1],
    ]);
    // The M is out on Monday and the L on Tuesday: no unit is free on both.
    const instants = [
      [{ combinationKeys: ["M"], quantity: 1 }],
      [{ combinationKeys: ["L"], quantity: 1 }],
    ];
    assert.deepEqual(servedOf({ capacity, instants, lines: [open(["M", "L"], 1)] }), [0]);

    // Two bookings of any size on different days share a unit: one is left.
    const anySize = [{ combinationKeys: ["M", "L"], quantity: 1 }];
    assert.deepEqual(
      servedOf({ capacity, instants: [anySize, anySize], lines: [open(["M", "L"], 2)] }),
      [1],
    );
  });

  test("a first choice that suits each instant alone is given up when no later one suits them all", () => {
    const capacity = new Map(KEYS.map((key) => [key, 1]));
    // "c" is out at one instant and "d" at the other. With the first line on
    // "a", the second has a place at each instant, but not the same one.
    const instants = [
      [{ combinationKeys: ["c"], quantity: 1 }],
      [{ combinationKeys: ["d"], quantity: 1 }],
    ];
    const allocations = allocateStock({
      capacity,
      instants,
      lines: [open(["a", "b"], 1), open(["c", "d", "a"], 1)],
    });

    assert.deepEqual(
      allocations.map((allocation) => [...allocation.byCombination]),
      [[["b", 1]], [["a", 1]]],
    );
  });

  test("a search that runs out of budget answers that the request does not fit", () => {
    // The second line needs both units of "a": the first has to leave it,
    // which the search only learns once it has tried.
    const capacity = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    const lines: StockLine[] = [
      { quantity: 1, candidates: ["a", "b"], single: true },
      { quantity: 2, candidates: ["a", "b"], single: true },
    ];

    assert.deepEqual(servedOf({ capacity, instants: [], lines }), [1, 2]);
    assert.deepEqual(servedOf({ capacity, instants: [], lines, searchBudget: 0 }), [1, 1]);
    assert.ok(STOCK_SEARCH_BUDGET > 0);
  });
});

describe("demandInstants", () => {
  const span = (start: number, end: number, demand: string) => ({ start, end, demand });

  test("keeps the sets of bookings held together, and only the largest of them", () => {
    assert.deepEqual(
      demandInstants([span(0, 4, "a"), span(2, 6, "b"), span(5, 8, "c"), span(9, 10, "d")]),
      [["a", "b"], ["b", "c"], ["d"]],
    );
  });

  test("a booking that ends when another starts does not meet it", () => {
    assert.deepEqual(demandInstants([span(0, 2, "a"), span(2, 4, "b")]), [["a"], ["b"]]);
  });

  test("a span of no length holds nothing", () => {
    assert.deepEqual(demandInstants([span(3, 3, "a"), span(5, 4, "b")]), []);
  });
});
