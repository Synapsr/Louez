import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CUSTOMER_FORM_BUILT_IN_KEYS,
  type CustomerFieldDefinition,
  type CustomerFormLayout,
} from "@louez/types";

import {
  customerFormLayoutUpdateInputSchema,
  lastStoredCustomerFormLayoutPosition,
  moveCustomerFormLayoutItem,
  planCustomerFormLayoutUpdate,
  resolveCustomerFormLayout,
  resolveStoreCustomerFormLayout,
  selectCustomerFormItems,
  setCustomerFormLayoutItemWidth,
  toCustomerExtraLayout,
  toCustomerFormLayoutUpdateItems,
  type CustomerFormLayoutItem,
} from "./customer-form-layout";
import { resolveCustomerProfileSettings } from "./customer-profile-fields";

let sequence = 0;

const definition = (overrides: Partial<CustomerFieldDefinition> = {}): CustomerFieldDefinition => {
  sequence += 1;
  return {
    id: `field${String(sequence).padStart(16, "0")}`,
    key: `field_${sequence}`,
    label: `Field ${sequence}`,
    type: "text",
    format: null,
    options: null,
    unit: null,
    helpText: null,
    section: "",
    position: sequence,
    width: "half",
    appliesTo: "all",
    isRequired: false,
    isSensitive: false,
    showOnContract: false,
    isSearchable: false,
    showInList: false,
    templateKey: null,
    isActive: true,
    scope: "customer",
    collectMode: "never",
    targetMode: "all",
    customerEditable: false,
    targets: [],
    ...overrides,
  };
};

const DEFAULT_PROFILE = resolveCustomerProfileSettings(undefined);

const keysOf = (items: readonly CustomerFormLayoutItem[]) => items.map((item) => item.key);

const resolveCustomer = (params: {
  definitions?: CustomerFieldDefinition[];
  layout?: unknown;
  profile?: unknown;
  customerType?: "individual" | "business";
  includeHidden?: boolean;
}) =>
  resolveCustomerFormLayout({
    scope: "customer",
    definitions: params.definitions ?? [],
    layout: params.layout,
    profileSettings: params.profile
      ? resolveCustomerProfileSettings(params.profile)
      : DEFAULT_PROFILE,
    customerType: params.customerType,
    includeHidden: params.includeHidden,
  });

describe("resolveCustomerFormLayout: defaults", () => {
  test("nothing stored: Louez fields in today's order, then custom fields by position", () => {
    const passport = definition({ position: 7, label: "Passeport" });
    const idNumber = definition({ position: 2, label: "Numéro" });
    const notes = definition({ position: 9, type: "textarea", width: "full" });
    const items = resolveCustomer({ definitions: [passport, idNumber, notes] });

    assert.deepEqual(keysOf(items), [
      ...CUSTOMER_FORM_BUILT_IN_KEYS,
      idNumber.id,
      passport.id,
      notes.id,
    ]);
    assert.deepEqual(
      items.map((item) => item.width),
      [
        "half", // firstName
        "half", // lastName
        "half", // email
        "half", // phone
        "full", // address
        "full", // companyName
        "half", // companyNumber
        "half", // vatNumber
        "half", // birthDate
        "half", // acquisitionSource
        "full", // socialLinks
        "half",
        "half",
        "full",
      ],
    );
  });

  test("the item kinds and flags say what the builder may do with each field", () => {
    const custom = definition();
    const items = resolveCustomer({ definitions: [custom] });
    const byKey = new Map(items.map((item) => [item.key, item]));

    assert.equal(byKey.get("firstName")?.locked, true);
    assert.equal(byKey.get("address")?.fixedWidth, true);
    assert.equal(byKey.get("socialLinks")?.fixedWidth, true);
    assert.equal(byKey.get("socialLinks")?.locked, false);
    assert.equal(byKey.get("birthDate")?.locked, false);
    assert.equal(byKey.get("companyName")?.appliesTo, "business");
    const customItem = byKey.get(custom.id);
    assert.equal(customItem?.kind, "custom");
    assert.equal(customItem?.kind === "custom" && customItem.definition, custom);
  });

  test("required: names, e-mail, the company name, required profile and custom fields", () => {
    const required = definition({ isRequired: true });
    const optional = definition();
    const items = resolveCustomer({
      definitions: [required, optional],
      profile: { birthDate: { visibility: "required" }, acquisitionSource: "optional" },
    });
    const requiredKeys = items.filter((item) => item.required).map((item) => item.key);

    assert.deepEqual(requiredKeys, [
      "firstName",
      "lastName",
      "email",
      "companyName",
      "birthDate",
      required.id,
    ]);
  });

  test("an unreadable stored layout reads as nothing stored", () => {
    for (const layout of ["half", [], { firstName: "top" }, { lastName: { position: "2" } }]) {
      assert.deepEqual(keysOf(resolveCustomer({ layout })), [...CUSTOMER_FORM_BUILT_IN_KEYS]);
    }
  });
});

describe("resolveCustomerFormLayout: stored order", () => {
  test("a custom field sits between Louez fields when its position says so", () => {
    const idNumber = definition({ position: 1 });
    const licence = definition({ position: 20 });
    const layout: CustomerFormLayout = {
      firstName: { position: 0, width: "full" },
      lastName: { position: 2, width: "half" },
      email: { position: 3, width: "half" },
      phone: { position: 4, width: "half" },
      address: { position: 5, width: "full" },
      companyName: { position: 6, width: "full" },
      companyNumber: { position: 7, width: "half" },
      vatNumber: { position: 8, width: "half" },
      birthDate: { position: 9, width: "half" },
      acquisitionSource: { position: 10, width: "half" },
      socialLinks: { position: 11, width: "full" },
    };
    const items = resolveCustomer({ definitions: [licence, idNumber], layout });

    assert.deepEqual(keysOf(items).slice(0, 4), ["firstName", idNumber.id, "lastName", "email"]);
    assert.equal(items.at(-1)?.key, licence.id);
    assert.equal(items[0]?.width, "full");
  });

  test("on a tie the Louez field comes first", () => {
    const custom = definition({ position: 10 });
    const layout = Object.fromEntries(
      CUSTOMER_FORM_BUILT_IN_KEYS.map((key, index) => [
        key,
        { position: index * 10, width: "half" },
      ]),
    );
    const items = resolveCustomer({ definitions: [custom], layout });
    assert.deepEqual(keysOf(items).slice(0, 4), ["firstName", "lastName", custom.id, "email"]);
  });

  test("a Louez field missing from the stored layout follows its default predecessor", () => {
    const early = definition({ position: 1 });
    const items = resolveCustomer({
      definitions: [early],
      // Only e-mail was stored, moved to the end; everything else takes its default place.
      layout: { email: { position: 50, width: "full" } },
    });

    assert.deepEqual(keysOf(items), [
      "firstName",
      "lastName",
      early.id,
      "email",
      "phone",
      "address",
      "companyName",
      "companyNumber",
      "vatNumber",
      "birthDate",
      "acquisitionSource",
      "socialLinks",
    ]);
  });

  test("the address block and social links stay full width whatever is stored", () => {
    const items = resolveCustomer({
      layout: {
        address: { position: 4, width: "half" },
        socialLinks: { position: 10, width: "half" },
        phone: { position: 3, width: "full" },
        email: { position: 2, width: "wide" },
      },
    });
    const widthOf = (key: string) => items.find((item) => item.key === key)?.width;

    assert.equal(widthOf("address"), "full");
    assert.equal(widthOf("socialLinks"), "full");
    assert.equal(widthOf("phone"), "full");
    // An unreadable width falls back to the default one.
    assert.equal(widthOf("email"), "half");
  });
});

describe("resolveCustomerFormLayout: filtering", () => {
  const individualOnly = definition({ appliesTo: "individual" });
  const businessOnly = definition({ appliesTo: "business" });
  const everyone = definition();
  const definitions = [individualOnly, businessOnly, everyone];

  test("an individual customer sees neither the company fields nor business-only ones", () => {
    const keys = keysOf(resolveCustomer({ definitions, customerType: "individual" }));
    for (const key of ["companyName", "companyNumber", "vatNumber", businessOnly.id]) {
      assert.equal(keys.includes(key), false, key);
    }
    assert.equal(keys.includes(individualOnly.id), true);
    assert.equal(keys.includes(everyone.id), true);
  });

  test("a business customer sees the company fields, not individual-only ones", () => {
    const keys = keysOf(resolveCustomer({ definitions, customerType: "business" }));
    assert.equal(keys.includes("companyName"), true);
    assert.equal(keys.includes(businessOnly.id), true);
    assert.equal(keys.includes(individualOnly.id), false);
  });

  test("without a customer type every item is there, flagged", () => {
    const items = resolveCustomer({ definitions });
    assert.equal(items.length, CUSTOMER_FORM_BUILT_IN_KEYS.length + 3);
    assert.equal(items.find((item) => item.key === businessOnly.id)?.appliesTo, "business");
  });

  test("hidden fields are left out of forms, kept in place for the settings page", () => {
    const archived = definition({ isActive: false, position: 0 });
    const profile = { birthDate: { visibility: "hidden" } };

    const form = keysOf(resolveCustomer({ definitions: [archived], profile }));
    assert.equal(form.includes("birthDate"), false);
    assert.equal(form.includes(archived.id), false);

    const builder = resolveCustomer({ definitions: [archived], profile, includeHidden: true });
    assert.deepEqual(
      builder.filter((item) => item.hidden).map((item) => item.key),
      ["birthDate", archived.id],
    );
    // A hidden item keeps its place.
    assert.equal(
      builder.findIndex((item) => item.key === "birthDate"),
      8,
    );
  });

  test("selectCustomerFormItems narrows an already resolved list the same way", () => {
    const all = resolveCustomer({ definitions, includeHidden: true });
    assert.deepEqual(
      keysOf(selectCustomerFormItems(all, { customerType: "individual" })),
      keysOf(resolveCustomer({ definitions, customerType: "individual" })),
    );
  });

  test("item scope: its own fields only, by position, never required, no Louez field", () => {
    const size = definition({ scope: "item", position: 3 });
    const height = definition({ scope: "item", position: 1, isRequired: true });
    const hidden = definition({ scope: "item", position: 2, isActive: false });
    const customer = definition();

    const items = resolveCustomerFormLayout({
      scope: "item",
      definitions: [size, customer, hidden, height],
    });
    assert.deepEqual(keysOf(items), [height.id, size.id]);
    assert.equal(
      items.every((item) => item.kind === "custom" && !item.required),
      true,
    );
    assert.deepEqual(
      keysOf(
        resolveCustomerFormLayout({
          scope: "item",
          definitions: [size, hidden, height],
          includeHidden: true,
        }),
      ),
      [height.id, hidden.id, size.id],
    );
  });
});

describe("planCustomerFormLayoutUpdate", () => {
  const first = definition({ position: 1 });
  const second = definition({ position: 2, type: "textarea", width: "full" });
  const current = resolveCustomer({ definitions: [first, second], includeHidden: true });

  test("positions follow the order sent; Louez fields go to settings, custom ones to definitions", () => {
    const items = moveCustomerFormLayoutItem(
      toCustomerFormLayoutUpdateItems(current),
      second.id,
      "lastName",
    );
    const plan = planCustomerFormLayoutUpdate({
      current,
      items: items.map((item) =>
        item.key === second.id ? { ...item, width: "half" as const } : item,
      ),
    });

    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.builtIns.firstName, { position: 0, width: "half" });
    assert.deepEqual(plan.builtIns.lastName, { position: 2, width: "half" });
    assert.deepEqual(plan.definitions, [
      { id: second.id, position: 1, width: "half" },
      { id: first.id, position: 12, width: "half" },
    ]);
    assert.equal(Object.keys(plan.builtIns).length, CUSTOMER_FORM_BUILT_IN_KEYS.length);
  });

  test("what is planned resolves back to the order sent", () => {
    const sent = moveCustomerFormLayoutItem(
      toCustomerFormLayoutUpdateItems(current),
      first.id,
      "email",
    );
    const plan = planCustomerFormLayoutUpdate({ current, items: sent });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;

    const positions = new Map(plan.definitions.map((entry) => [entry.id, entry]));
    const saved = [first, second].map((field) => ({
      ...field,
      position: positions.get(field.id)?.position ?? field.position,
      width: positions.get(field.id)?.width ?? field.width,
    }));
    assert.deepEqual(
      keysOf(resolveCustomer({ definitions: saved, layout: plan.builtIns })),
      sent.map((item) => item.key),
    );
  });

  test("the address block and social links are saved full width", () => {
    const plan = planCustomerFormLayoutUpdate({
      current,
      items: current.map((item) => ({ key: item.key, width: "half" as const })),
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.builtIns.address?.width, "full");
    assert.equal(plan.builtIns.socialLinks?.width, "full");
    assert.equal(plan.builtIns.companyName?.width, "half");
  });

  test("an unknown key, a duplicate or a missing Louez field is refused", () => {
    const items = toCustomerFormLayoutUpdateItems(current);
    assert.deepEqual(
      planCustomerFormLayoutUpdate({
        current,
        items: [...items, { key: "someoneElsesField000", width: "half" }],
      }),
      { ok: false, error: "unknownKey" },
    );
    assert.deepEqual(planCustomerFormLayoutUpdate({ current, items: [...items, items[0]] }), {
      ok: false,
      error: "duplicateKey",
    });
    assert.deepEqual(
      planCustomerFormLayoutUpdate({
        current,
        items: items.filter((item) => item.key !== "vatNumber"),
      }),
      { ok: false, error: "missingBuiltIn" },
    );
  });

  test("a custom field created meanwhile keeps its place after the others", () => {
    const plan = planCustomerFormLayoutUpdate({
      current,
      items: toCustomerFormLayoutUpdateItems(current).filter((item) => item.key !== second.id),
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.definitions.at(-1), { id: second.id, position: 12, width: "full" });
  });

  test("item scope writes no Louez field", () => {
    const size = definition({ scope: "item", position: 5 });
    const height = definition({ scope: "item", position: 9 });
    const items = resolveCustomerFormLayout({
      scope: "item",
      definitions: [size, height],
      includeHidden: true,
    });
    const plan = planCustomerFormLayoutUpdate({
      current: items,
      items: [
        { key: height.id, width: "full" },
        { key: size.id, width: "half" },
      ],
    });
    assert.deepEqual(plan, {
      ok: true,
      builtIns: {},
      definitions: [
        { id: height.id, position: 0, width: "full" },
        { id: size.id, position: 1, width: "half" },
      ],
    });
  });

  test("the input schema refuses a key sent twice", () => {
    const parsed = customerFormLayoutUpdateInputSchema.safeParse({
      scope: "customer",
      items: [
        { key: "firstName", width: "half" },
        { key: "firstName", width: "full" },
      ],
    });
    assert.equal(parsed.success, false);
    assert.equal(
      customerFormLayoutUpdateInputSchema.safeParse({
        scope: "item",
        items: [{ key: "firstName", width: "third" }],
      }).success,
      false,
    );
  });
});

describe("builder helpers", () => {
  test("moving an item keeps items not shown in their place among the others", () => {
    const items = [{ key: "a" }, { key: "hidden" }, { key: "b" }, { key: "c" }];
    assert.deepEqual(
      moveCustomerFormLayoutItem(items, "c", "a").map((item) => item.key),
      ["c", "a", "hidden", "b"],
    );
    assert.deepEqual(
      moveCustomerFormLayoutItem(items, "a", "c").map((item) => item.key),
      ["hidden", "b", "c", "a"],
    );
    assert.deepEqual(moveCustomerFormLayoutItem(items, "a", "missing"), items);
  });

  test("a fixed-width item stays full", () => {
    const items = [
      { key: "address", width: "full" as const, fixedWidth: true },
      { key: "phone", width: "half" as const, fixedWidth: false },
    ];
    assert.deepEqual(setCustomerFormLayoutItemWidth(items, "address", "half"), items);
    assert.equal(setCustomerFormLayoutItemWidth(items, "phone", "full")[1]?.width, "full");
  });
});

describe("toCustomerExtraLayout", () => {
  test("the storefront's extra block: asked Louez and custom fields, interleaved as laid out", () => {
    const asked = definition({ position: 1 });
    const teamOnly = definition({ position: 2 });
    const items = resolveCustomer({
      definitions: [asked, teamOnly],
      layout: {
        socialLinks: { position: 0, width: "full" },
        birthDate: { position: 3, width: "full" },
      },
    });

    assert.deepEqual(
      toCustomerExtraLayout(items, {
        profileFields: [{ key: "birthDate" }, { key: "socialLinks" }],
        customerFields: [asked],
      }),
      [
        { kind: "builtin", key: "socialLinks", width: "full" },
        { kind: "custom", key: asked.id, width: "half" },
        { kind: "builtin", key: "birthDate", width: "full" },
      ],
    );
  });
});

describe("store helpers", () => {
  test("a store's settings resolve like the parts they hold", () => {
    const custom = definition({ position: 0 });
    const settings = {
      customerProfile: { birthDate: "hidden" },
      customerFormLayout: { firstName: { position: 1, width: "full" } },
    };
    assert.deepEqual(
      resolveStoreCustomerFormLayout({ settings, scope: "customer", definitions: [custom] }),
      resolveCustomer({
        definitions: [custom],
        layout: settings.customerFormLayout,
        profile: settings.customerProfile,
      }),
    );
    assert.deepEqual(
      keysOf(
        resolveStoreCustomerFormLayout({ settings: null, scope: "customer", definitions: [] }),
      ),
      [...CUSTOMER_FORM_BUILT_IN_KEYS],
    );
  });

  test("a new field goes after the last Louez field the stored layout placed", () => {
    assert.equal(lastStoredCustomerFormLayoutPosition(undefined), null);
    assert.equal(
      lastStoredCustomerFormLayoutPosition({
        email: { position: 4, width: "half" },
        socialLinks: { position: 17, width: "full" },
        phone: { position: "12" },
      }),
      17,
    );
  });
});
