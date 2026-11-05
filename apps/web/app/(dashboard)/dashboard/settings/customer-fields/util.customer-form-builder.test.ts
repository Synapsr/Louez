import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";
import { resolveCustomerFormLayout, resolveCustomerProfileSettings } from "@louez/validations";

import {
  customerFormItemFlags,
  joinCustomerFormItems,
  moveShownItem,
  profileFieldAllowsRequired,
  selectBuilderItems,
  toPreviewCheckoutInput,
} from "./util.customer-form-builder";

const field = (
  id: string,
  overrides: Partial<CustomerFieldDefinition> = {},
): CustomerFieldDefinition => ({
  id,
  key: id,
  label: id,
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "",
  position: 1,
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
});

const profileSettings = resolveCustomerProfileSettings(undefined);

const definitions = [
  field("cpf", { position: 20 }),
  field("idNumber", { position: 21, collectMode: "optional" }),
  field("accounting", { position: 22, appliesTo: "business" }),
  field("size", { position: 1, scope: "item" }),
];

// What `layout({ scope: "customer" })` answers when nothing is stored.
const layout = resolveCustomerFormLayout({
  scope: "customer",
  definitions,
  layout: undefined,
  profileSettings,
  includeHidden: true,
});

const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);

describe("joinCustomerFormItems", () => {
  test("keeps the layout's order and widths", () => {
    const items = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions,
      profileSettings,
    });
    assert.deepEqual(keys(items), keys(layout));
  });

  test("reads the fields as they are now: a hidden or required change shows at once", () => {
    const items = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions: definitions.map((definition) =>
        definition.id === "cpf" ? { ...definition, isActive: false, isRequired: true } : definition,
      ),
      profileSettings: {
        ...profileSettings,
        birthDate: { ...profileSettings.birthDate, visibility: "required" },
        socialLinks: { ...profileSettings.socialLinks, visibility: "hidden" },
      },
    });
    const byKey = new Map(items.map((item) => [item.key, item]));
    assert.equal(byKey.get("cpf")?.hidden, true);
    assert.equal(byKey.get("cpf")?.required, true);
    assert.equal(byKey.get("birthDate")?.required, true);
    assert.equal(byKey.get("socialLinks")?.hidden, true);
    // The locked fields keep what the layout says.
    assert.equal(byKey.get("firstName")?.required, true);
  });

  test("appends a field created since, and leaves out one deleted since", () => {
    const items = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions: [
        ...definitions.filter((definition) => definition.id !== "idNumber"),
        field("licence", { position: 99, width: "full" }),
      ],
      profileSettings,
    });
    assert.equal(items.at(-1)?.key, "licence");
    assert.equal(items.at(-1)?.width, "full");
    assert.equal(
      items.some((item) => item.key === "idNumber"),
      false,
    );
  });

  test("the item tab holds only per-item fields", () => {
    const items = joinCustomerFormItems({
      scope: "item",
      layout: [],
      definitions,
      profileSettings,
    });
    assert.deepEqual(keys(items), ["size"]);
  });
});

describe("selectBuilderItems", () => {
  const items = joinCustomerFormItems({ scope: "customer", layout, definitions, profileSettings });

  test("an individual customer's form has no company fields", () => {
    const shown = keys(
      selectBuilderItems(items, { scope: "customer", customerType: "individual" }),
    );
    assert.equal(shown.includes("companyName"), false);
    assert.equal(shown.includes("accounting"), false);
    assert.equal(shown.includes("firstName"), true);
  });

  test("a business shows them in place", () => {
    const shown = keys(selectBuilderItems(items, { scope: "customer", customerType: "business" }));
    assert.equal(shown.indexOf("companyName") > shown.indexOf("address"), true);
    assert.equal(shown.includes("accounting"), true);
  });

  test("hidden items stay, greyed in place", () => {
    const hidden = items.map((item) => (item.key === "cpf" ? { ...item, hidden: true } : item));
    const shown = keys(
      selectBuilderItems(hidden, { scope: "customer", customerType: "individual" }),
    );
    assert.equal(shown.includes("cpf"), true);
  });
});

describe("moveShownItem", () => {
  const items = joinCustomerFormItems({ scope: "customer", layout, definitions, profileSettings });
  const shown = selectBuilderItems(items, { scope: "customer", customerType: "individual" });

  test("a field dropped between first name and e-mail lands there", () => {
    const from = shown.findIndex((item) => item.key === "cpf");
    const to = shown.findIndex((item) => item.key === "lastName");
    const next = moveShownItem(items, shown, from, to);
    assert.deepEqual(keys(next ?? []).slice(0, 4), ["firstName", "cpf", "lastName", "email"]);
  });

  test("the other customer type's fields keep their place", () => {
    const from = shown.findIndex((item) => item.key === "cpf");
    const to = shown.findIndex((item) => item.key === "address");
    const next = keys(moveShownItem(items, shown, from, to) ?? []);
    // Company fields came right after the address and still do.
    assert.equal(next.indexOf("companyName"), next.indexOf("address") + 1);
    assert.equal(next.length, items.length);
  });

  test("nothing moved, nothing to save", () => {
    assert.equal(moveShownItem(items, shown, 2, 2), null);
    assert.equal(moveShownItem(items, shown, 0, 999), null);
  });
});

describe("customerFormItemFlags", () => {
  const items = joinCustomerFormItems({ scope: "customer", layout, definitions, profileSettings });
  const item = (key: string) => {
    const found = items.find((entry) => entry.key === key);
    assert.ok(found);
    return found;
  };

  test("the locked fields have none: their lock says it all", () => {
    assert.equal(customerFormItemFlags(item("firstName"), profileSettings), null);
    assert.equal(customerFormItemFlags(item("companyName"), profileSettings), null);
  });

  test("a Louez profile field reads like one of the store's", () => {
    const flags = customerFormItemFlags(item("birthDate"), {
      ...profileSettings,
      birthDate: {
        ...profileSettings.birthDate,
        visibility: "required",
        collectMode: "optional",
        targetMode: "products",
        targets: [],
      },
    });
    assert.deepEqual(flags, {
      hidden: false,
      required: true,
      sensitive: false,
      collectMode: "optional",
      noTarget: true,
    });
  });

  test("a hidden field only says it is hidden", () => {
    const hidden = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions: definitions.map((definition) =>
        definition.id === "idNumber" ? { ...definition, isActive: false } : definition,
      ),
      profileSettings,
    }).find((entry) => entry.key === "idNumber");
    assert.ok(hidden);
    assert.deepEqual(customerFormItemFlags(hidden, profileSettings), {
      hidden: true,
      required: false,
      sensitive: false,
      collectMode: "never",
      noTarget: false,
    });
  });

  test("a store field asked online says so", () => {
    assert.equal(customerFormItemFlags(item("idNumber"), profileSettings)?.collectMode, "optional");
  });
});

test("only social links cannot be required", () => {
  assert.equal(profileFieldAllowsRequired("birthDate"), true);
  assert.equal(profileFieldAllowsRequired("socialLinks"), false);
});

describe("toPreviewCheckoutInput", () => {
  test("gives the list's order and widths to the resolver", () => {
    const items = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions,
      profileSettings,
    });
    const moved = moveShownItem(
      items,
      items,
      items.findIndex((entry) => entry.key === "idNumber"),
      0,
    );
    assert.ok(moved);
    const widened = moved.map((entry) =>
      entry.key === "idNumber" ? { ...entry, width: "full" as const } : entry,
    );
    const input = toPreviewCheckoutInput(widened);
    const resolved = resolveCustomerFormLayout({
      scope: "customer",
      definitions: input.definitions,
      layout: input.layout,
      profileSettings,
      includeHidden: true,
    });
    assert.equal(resolved[0]?.key, "idNumber");
    assert.equal(resolved[0]?.width, "full");
    assert.deepEqual(keys(resolved), keys(widened));
  });

  test("leaves the hidden store fields out", () => {
    const items = joinCustomerFormItems({
      scope: "customer",
      layout,
      definitions: definitions.map((definition) =>
        definition.id === "cpf" ? { ...definition, isActive: false } : definition,
      ),
      profileSettings,
    });
    const ids = toPreviewCheckoutInput(items).definitions.map((definition) => definition.id);
    assert.equal(ids.includes("cpf"), false);
  });
});
