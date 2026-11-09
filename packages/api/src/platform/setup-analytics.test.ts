import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// What an agent's setup action may say about a write: field names, and the
// facts of SETUP_FACT_KEYS, never a value a person typed, whatever it sends.

/** Every value a person could type, in every field a setup procedure takes. */
const TYPED = {
  name: "Jeanne Dupont Surf",
  slug: "jeanne-dupont",
  email: "jeanne.dupont@example.test",
  phone: "+33 6 12 34 56 78",
  address: "1 quai de la Douane, 29200 Brest",
  description: "Appelez Jeanne au 06 12 34 56 78",
  cgv: "Conditions de Jeanne Dupont",
  legalName: "Jeanne Dupont SARL",
  siren: "123456789",
  label: "Taille de Jeanne",
};

describe("setup analytics facts", () => {
  let analytics: typeof import("./setup-analytics");

  before(async () => {
    analytics = await import("./setup-analytics");
  });

  const action = (path: string[], input: unknown, output: unknown = {}) =>
    analytics.agentSetupActionEffect({
      credential: { kind: "oauth", clientName: "Claude" },
      transport: "mcp",
      path,
      input,
      output,
      store: { id: "store_1", ownerUserId: "owner_1" },
      confirmed: false,
      now: new Date("2026-11-09T10:00:00.000Z"),
    });

  const PROCEDURES: Array<[string[], unknown, unknown?]> = [
    [["dashboard", "stores", "create"], { ...TYPED, country: "FR", currency: "EUR" }],
    [["dashboard", "settings", "updateStoreInfo"], { ...TYPED, latitude: 48.3, longitude: -4.4 }],
    [
      ["dashboard", "settings", "updateCompany"],
      {
        country: "FR",
        currency: "EUR",
        billingAddress: { sameAsStore: false, address: TYPED.address, city: "Brest" },
      },
    ],
    [["dashboard", "settings", "updateLegal"], { cgv: TYPED.cgv, legalNotice: TYPED.cgv }],
    [
      ["dashboard", "settings", "updateReservationRules"],
      { reservationMode: "payment", onlinePaymentDepositPercentage: 30 },
    ],
    [
      ["dashboard", "settings", "updateBusinessHours"],
      {
        enabled: true,
        schedule: { monday: { isOpen: true, ranges: [] }, sunday: { isOpen: false, ranges: [] } },
        closurePeriods: [{ name: TYPED.name, startDate: "2026-12-24", endDate: "2026-12-26" }],
      },
    ],
    [["dashboard", "settings", "updateDelivery"], { enabled: true, mode: "optional" }],
    [["dashboard", "settings", "upsertLegalProfile"], { ...TYPED }],
    [
      ["dashboard", "onlineStore", "updateAppearance"],
      {
        mode: "dark",
        logoUrl: "https://cdn.test/logo.png",
        heroImages: ["https://cdn.test/a.png"],
      },
    ],
    [["dashboard", "onlineStore", "createImageUpload"], { kind: "hero", contentType: "image/png" }],
    [
      ["dashboard", "products", "create"],
      {
        ...TYPED,
        price: "30",
        deposit: "0",
        rateTiers: [{ duration: 3, unit: "day", price: "75" }],
        units: [{ identifier: TYPED.phone }],
        bookingAttributeAxes: [{ key: "size", label: TYPED.label }],
      },
    ],
    [
      ["dashboard", "products", "ensureVariantDefinition"],
      { label: TYPED.label, values: [{}, {}] },
    ],
    [["dashboard", "categories", "create"], { name: TYPED.name, description: TYPED.description }],
    [
      ["dashboard", "stores", "completeOnboarding"],
      { reservationMode: "request" },
      { launched: true, bookingMode: { intended: "request", effective: "request" } },
    ],
    // A key a person typed, from a record input: left out of the field names.
    [["dashboard", "settings", "updateStoreInfo"], { [TYPED.email]: true, "Jeanne Dupont": 1 }],
  ];

  test("no fact holds a value a person typed, and every fact is a known one", () => {
    const known = new Set<string>(analytics.SETUP_FACT_KEYS);
    for (const [path, input, output] of PROCEDURES) {
      const effect = action(path, input, output);
      assert.ok(effect, path.join("."));
      assert.equal(effect.type, "store.agentSetupAction");
      if (effect.type !== "store.agentSetupAction") continue;
      const { payload } = effect;
      for (const key of Object.keys(payload.facts)) {
        assert.ok(known.has(key), `${path.join(".")}: unknown fact ${key}`);
      }
      for (const name of [...payload.fieldsSet, ...payload.fieldsCleared]) {
        assert.match(name, /^[A-Za-z][A-Za-z0-9_]*$/, `${path.join(".")}: field ${name}`);
      }
      const values = [
        ...Object.values(payload.facts),
        ...payload.fieldsSet,
        ...payload.fieldsCleared,
        payload.procedure,
        payload.agentClient,
      ];
      for (const value of values) {
        if (typeof value !== "string") continue;
        assert.ok(!analytics.looksPersonal(value), `${path.join(".")}: ${value}`);
        for (const typed of Object.values(TYPED)) {
          assert.ok(!value.includes(typed), `${path.join(".")}: holds "${typed}"`);
        }
      }
    }
  });

  test("the facts of each procedure", () => {
    const facts = (path: string[], input: unknown, output?: unknown) => {
      const effect = action(path, input, output);
      return effect?.type === "store.agentSetupAction" ? effect.payload.facts : null;
    };
    assert.deepEqual(facts(...PROCEDURES[2]), {
      country: "FR",
      currency: "EUR",
      billing_address_same_as_store: false,
    });
    assert.deepEqual(facts(...PROCEDURES[5]), {
      business_hours_enabled: true,
      days_changed_count: 2,
      open_days_count: 1,
      closure_count: 1,
    });
    assert.deepEqual(facts(...PROCEDURES[8]), {
      theme_mode: "dark",
      has_logo: true,
      hero_image_count: 1,
    });
    assert.deepEqual(facts(...PROCEDURES[10]), {
      has_price: true,
      has_deposit: false,
      pricing_tier_count: 1,
      unit_count: 1,
      variant_axis_count: 1,
    });
    assert.deepEqual(facts(...PROCEDURES[11]), { variant_value_count: 2 });
  });

  test("what sends nothing: a session, a go-live that launched nothing, a non-setup procedure", () => {
    const base = {
      transport: "rpc" as const,
      path: ["dashboard", "settings", "updateStoreInfo"],
      input: {},
      output: {},
      store: { id: "store_1", ownerUserId: "owner_1" },
      confirmed: false,
    };
    assert.equal(
      analytics.agentSetupActionEffect({
        ...base,
        credential: { kind: "session", clientName: null },
      }),
      null,
    );
    const agent = { kind: "api_key" as const, clientName: "Mon n8n" };
    assert.equal(
      analytics.agentSetupActionEffect({
        ...base,
        credential: agent,
        path: ["dashboard", "stores", "completeOnboarding"],
        output: { launched: false },
      }),
      null,
    );
    assert.equal(
      analytics.agentSetupActionEffect({
        ...base,
        credential: agent,
        path: ["dashboard", "inbox", "acknowledge"],
      }),
      null,
    );
  });

  /** Names an OAuth client may declare, or a user type for a key: they may hold anything. */
  const HOSTILE_NAMES: Array<[string, string]> = [
    ["Jeanne Dupont", "other"],
    ["Jeanne Dupont, 1 quai de la Douane, 29200 Brest", "other"],
    ["agent of jeanne.dupont@example.test", "other"],
    ["Rappelez Jeanne au 06 12 34 56 78", "other"],
    ["Claude de Jeanne Dupont (jeanne.dupont@example.test)", "claude"],
    ["ChatGPT — Jeanne Dupont, +33 6 12 34 56 78", "chatgpt"],
    ["Clé n8n de Jeanne Dupont", "n8n"],
    ["Le Chat (Mistral) de Jeanne", "le_chat"],
  ];

  test("an agent is only ever a fixed value: never the client's or the key's own name", () => {
    assert.equal(analytics.agentClientOf("Claude"), "claude");
    assert.equal(analytics.agentClientOf(null), "other");
    for (const kind of ["oauth", "api_key"] as const) {
      for (const [name, client] of HOSTILE_NAMES) {
        assert.equal(analytics.agentClientOf(name), client, name);
        assert.deepEqual(analytics.setupActorOf({ kind, clientName: name }), {
          credentialKind: kind,
          agentClient: client,
        });
        const effect = analytics.agentSetupActionEffect({
          credential: { kind, clientName: name },
          transport: "mcp",
          path: ["dashboard", "settings", "updateStoreInfo"],
          input: { description: "x" },
          output: {},
          store: { id: "store_1", ownerUserId: "owner_1" },
          confirmed: false,
        });
        const json = JSON.stringify(effect);
        for (const part of ["Jeanne", "Dupont", "Douane", "example.test", "06 12", "+33"]) {
          assert.ok(!json.includes(part), `${name}: the event holds "${part}"`);
        }
      }
    }
  });

  test("an e-mail or a phone number looks personal; codes and counts do not", () => {
    for (const value of ["a@b.co", "+33612345678", "06 12 34 56 78", "(555) 123-4567"]) {
      assert.ok(analytics.looksPersonal(value), value);
    }
    for (const value of ["FR", "EUR", "request", "settings.updateStoreInfo", "claude", "123"]) {
      assert.ok(!analytics.looksPersonal(value), value);
    }
  });
});
