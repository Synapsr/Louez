import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const {
  buildAiReadiness,
  countPerBucket,
  crawlDayOf,
  toAiBookings,
  toAiTrafficByAssistant,
  toCrawlsByAssistant,
  toVisitsByAssistant,
} = await import("./ai-visibility");

const OPEN_MONDAY = {
  enabled: true,
  schedule: {
    0: { isOpen: false, ranges: [] },
    1: { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "18:00" }] },
    2: { isOpen: false, ranges: [] },
    3: { isOpen: false, ranges: [] },
    4: { isOpen: false, ranges: [] },
    5: { isOpen: false, ranges: [] },
    6: { isOpen: false, ranges: [] },
  },
  closurePeriods: [],
};

const complete = {
  description: "<p>Location de vélos électriques et de kayaks sur le port de Vannes.</p>",
  tagline: null,
  address: "12 quai Tabarly, 56000 Vannes",
  businessHours: OPEN_MONDAY,
  products: { total: 3, complete: 3 },
};

const readyOf = (facts: Parameters<typeof buildAiReadiness>[0]) =>
  Object.fromEntries(buildAiReadiness(facts).map((item) => [item.key, item.ready]));

test("a complete store is ready on every item, in the dashboard's order", () => {
  const items = buildAiReadiness(complete);
  assert.deepEqual(
    items.map((item) => item.key),
    ["description", "address", "businessHours", "products"],
  );
  assert.ok(items.every((item) => item.ready));
  assert.deepEqual(items.find((item) => item.key === "products")?.count, { ready: 3, total: 3 });
  assert.equal(items.find((item) => item.key === "address")?.count, null);
});

test("a description of a few words, or markup alone, is not enough", () => {
  assert.equal(readyOf({ ...complete, description: "<p>Bienvenue !</p>" }).description, false);
  assert.equal(
    readyOf({ ...complete, description: "<p><br></p>", tagline: null }).description,
    false,
  );
  // The tagline counts with the description.
  assert.equal(
    readyOf({
      ...complete,
      description: null,
      tagline: "Vélos et kayaks à louer à la journée sur le port de Vannes",
    }).description,
    true,
  );
});

test("hours switched off, or every day closed, are no hours to repeat", () => {
  assert.equal(readyOf({ ...complete, businessHours: undefined }).businessHours, false);
  assert.equal(
    readyOf({ ...complete, businessHours: { ...OPEN_MONDAY, enabled: false } }).businessHours,
    false,
  );
  const closed = {
    ...OPEN_MONDAY,
    schedule: { ...OPEN_MONDAY.schedule, 1: { isOpen: false, ranges: [] } },
  };
  assert.equal(readyOf({ ...complete, businessHours: closed }).businessHours, false);
});

test("products are ready when every active one has a photo and a price, and there is one", () => {
  assert.equal(readyOf({ ...complete, products: { total: 3, complete: 2 } }).products, false);
  assert.equal(readyOf({ ...complete, products: { total: 0, complete: 0 } }).products, false);
  assert.equal(readyOf({ ...complete, address: "  " }).address, false);
});

test("visits are per assistant, the most first, unknown values dropped", () => {
  assert.deepEqual(
    toVisitsByAssistant([
      { assistant: "claude", visits: "2" },
      { assistant: "chatgpt", visits: 5 },
      { assistant: "bing", visits: 9 },
      { assistant: null, visits: 3 },
      { assistant: "gemini", visits: 0 },
    ]),
    {
      total: 7,
      byAssistant: [
        { assistant: "chatgpt", visits: 5 },
        { assistant: "claude", visits: 2 },
      ],
    },
  );
});

test("crawler reads fold into their assistant; llms.txt reads are counted apart", () => {
  assert.deepEqual(
    toCrawlsByAssistant([
      { crawler: "gptbot", resource: "page", hits: "4" },
      { crawler: "chatgpt_user", resource: "llms_txt", hits: 2 },
      { crawler: "claudebot", resource: "page", hits: 3 },
      { crawler: "ccbot", resource: "page", hits: 1 },
      { crawler: "retired_bot", resource: "page", hits: 50 },
    ]),
    {
      total: 10,
      llmsTxt: 2,
      byAssistant: [
        { assistant: "chatgpt", hits: 6 },
        { assistant: "claude", hits: 3 },
        { assistant: "other", hits: 1 },
      ],
    },
  );
});

test("a crawl counts on its UTC day", () => {
  assert.equal(crawlDayOf(new Date("2026-11-18T23:30:00-02:00")), "2026-11-19");
});

const session = (sessionId: string, assistant: "chatgpt" | "perplexity" | "claude") => ({
  sessionId,
  assistant,
  firstAt: new Date("2026-11-17T10:00:00Z"),
});

test("a booking takes the assistant of its visit, counts once, and needs a visit from an assistant", () => {
  const at = new Date("2026-11-17T11:00:00Z");
  assert.deepEqual(
    toAiBookings(
      [
        { sessionId: "s1", reservationId: "r1", at },
        // The same reservation reported twice (a reload of the confirmation).
        { sessionId: "s1", reservationId: "r1", at },
        { sessionId: "s2", reservationId: "r2", at },
        // A session no assistant sent.
        { sessionId: "s9", reservationId: "r9", at },
      ],
      [session("s1", "chatgpt"), session("s2", "perplexity")],
    ),
    [
      { reservationId: "r1", assistant: "chatgpt", at },
      { reservationId: "r2", assistant: "perplexity", at },
    ],
  );
});

test("dates fall in their bucket, start included and end excluded", () => {
  const buckets = [
    { start: new Date("2026-11-16T00:00:00Z"), end: new Date("2026-11-17T00:00:00Z") },
    { start: new Date("2026-11-17T00:00:00Z"), end: new Date("2026-11-18T00:00:00Z") },
  ];
  assert.deepEqual(
    countPerBucket(
      [
        new Date("2026-11-16T00:00:00Z"),
        new Date("2026-11-16T23:59:59Z"),
        new Date("2026-11-17T00:00:00Z"),
        new Date("2026-11-18T00:00:00Z"),
      ],
      buckets,
    ),
    [2, 1],
  );
});

test("per assistant: visits, bookings and crawler reads together, the most visits first", () => {
  const at = new Date("2026-11-17T11:00:00Z");
  assert.deepEqual(
    toAiTrafficByAssistant({
      sessions: [session("s1", "chatgpt"), session("s2", "chatgpt"), session("s3", "perplexity")],
      bookings: [{ reservationId: "r1", assistant: "perplexity", at }],
      crawls: [
        { crawler: "claudebot", hits: "5" },
        { crawler: "gptbot", hits: 2 },
        { crawler: "retired_bot", hits: 9 },
      ],
    }),
    [
      { assistant: "chatgpt", visits: 2, bookings: 0, hits: 2 },
      { assistant: "perplexity", visits: 1, bookings: 1, hits: 0 },
      { assistant: "claude", visits: 0, bookings: 0, hits: 5 },
    ],
  );
});
