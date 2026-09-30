import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_ONLINE_SETTINGS,
  buildTargetItems,
  commonOnlineSettings,
  defaultScopeForSection,
  describeTargeting,
  newFieldDefaults,
  patchOnlineSettings,
  selectTargetItems,
  showsTargetChoice,
  summarizeTargets,
  toCustomerFieldPayload,
} from "./util.customer-field-online";

const options = {
  categories: [
    { id: "cat-bikes", name: "Vélos & VAE" },
    { id: "cat-water", name: "Nautisme" },
  ],
  products: [
    {
      id: "p-vespa",
      name: "Vespa 125",
      status: "active" as const,
      image: "https://img/vespa.jpg",
      categoryIds: [],
    },
    {
      id: "p-vtt",
      name: "VTT électrique",
      status: "active" as const,
      image: null,
      categoryIds: ["cat-bikes"],
    },
    {
      id: "p-old",
      name: "Vieux tandem",
      status: "archived" as const,
      image: null,
      categoryIds: ["cat-bikes"],
    },
    {
      id: "p-draft",
      name: "Kayak",
      status: "draft" as const,
      image: null,
      categoryIds: ["cat-water"],
    },
  ],
};

describe("patchOnlineSettings", () => {
  test("turning the question off takes the customer's edit right with it", () => {
    const asked = {
      ...DEFAULT_ONLINE_SETTINGS,
      collectMode: "optional" as const,
      customerEditable: true,
    };
    assert.deepEqual(patchOnlineSettings(asked, { collectMode: "never" }), {
      ...asked,
      collectMode: "never",
      customerEditable: false,
    });
    assert.equal(patchOnlineSettings(asked, { collectMode: "required" }).customerEditable, true);
  });

  test("a field never asked cannot become editable", () => {
    assert.equal(
      patchOnlineSettings(DEFAULT_ONLINE_SETTINGS, { customerEditable: true }).customerEditable,
      false,
    );
  });
});

describe("showsTargetChoice / describeTargeting", () => {
  test("a customer field only cares about products while the checkout asks it", () => {
    assert.equal(showsTargetChoice({ carriesItems: false, collectMode: "never" }), false);
    assert.equal(showsTargetChoice({ carriesItems: false, collectMode: "optional" }), true);
    assert.deepEqual(
      describeTargeting({
        scope: "customer",
        collectMode: "never",
        targetMode: "products",
        targets: [],
      }),
      { kind: "irrelevant" },
    );
  });

  test("an item field always carries its targets, even for the team alone", () => {
    assert.equal(showsTargetChoice({ carriesItems: true, collectMode: "never" }), true);
    assert.deepEqual(
      describeTargeting({
        scope: "item",
        collectMode: "never",
        targetMode: "products",
        targets: [],
      }),
      { kind: "empty" },
    );
    assert.deepEqual(
      describeTargeting({ scope: "item", collectMode: "never", targetMode: "all", targets: [] }),
      { kind: "all" },
    );
    const targets = [{ type: "category" as const, id: "cat-bikes" }];
    assert.deepEqual(
      describeTargeting({
        scope: "item",
        collectMode: "required",
        targetMode: "products",
        targets,
      }),
      { kind: "targets", targets },
    );
  });
});

describe("commonOnlineSettings", () => {
  const bikes = {
    collectMode: "optional" as const,
    targetMode: "products" as const,
    targets: [
      { type: "category" as const, id: "cat-bikes" },
      { type: "product" as const, id: "p-vespa" },
    ],
    customerEditable: true,
  };

  test("fields agreeing on everything, targets in any order, are not mixed", () => {
    const reordered = { ...bikes, targets: [...bikes.targets].reverse() };
    assert.deepEqual(commonOnlineSettings([bikes, reordered]), { settings: bikes, mixed: false });
  });

  test("one differing field makes the section mixed, starting from the first field", () => {
    const result = commonOnlineSettings([bikes, { ...bikes, collectMode: "required" }]);
    assert.equal(result.mixed, true);
    assert.deepEqual(result.settings, bikes);
  });

  test("an empty section starts from the defaults", () => {
    assert.deepEqual(commonOnlineSettings([]), { settings: DEFAULT_ONLINE_SETTINGS, mixed: false });
  });
});

test("defaultScopeForSection: per unit only when every field of the section is", () => {
  assert.equal(defaultScopeForSection([]), "customer");
  assert.equal(defaultScopeForSection([{ scope: "item" }, { scope: "item" }]), "item");
  assert.equal(defaultScopeForSection([{ scope: "item" }, { scope: "customer" }]), "customer");
});

describe("newFieldDefaults", () => {
  const skiTargets = [{ type: "category" as const, id: "cat-ski" }];
  const skiField = {
    scope: "item" as const,
    collectMode: "optional" as const,
    targetMode: "products" as const,
    targets: skiTargets,
    customerEditable: false,
  };

  test("a field joins a unanimous section with its scope and online settings", () => {
    assert.deepEqual(newFieldDefaults([skiField, skiField]), {
      scope: "item",
      collectMode: "optional",
      targetMode: "products",
      targets: skiTargets,
      customerEditable: false,
    });
  });

  test("a section that disagrees gives the defaults, never one field's settings", () => {
    assert.deepEqual(newFieldDefaults([skiField, { ...skiField, collectMode: "required" }]), {
      scope: "item",
      ...DEFAULT_ONLINE_SETTINGS,
    });
    assert.deepEqual(newFieldDefaults([]), { scope: "customer", ...DEFAULT_ONLINE_SETTINGS });
  });
});

describe("summarizeTargets", () => {
  test("categories first, then products, the rest counted", () => {
    assert.deepEqual(
      summarizeTargets(
        [
          { type: "product", id: "p-vespa" },
          { type: "category", id: "cat-bikes" },
          { type: "product", id: "p-vtt" },
        ],
        options,
      ),
      { names: ["Vélos & VAE", "Vespa 125"], more: 1 },
    );
  });

  test("targets that no longer exist are left out", () => {
    assert.deepEqual(summarizeTargets([{ type: "product", id: "gone" }], options), {
      names: [],
      more: 0,
    });
  });
});

describe("buildTargetItems", () => {
  test("categories count their live products; archived products only while picked", () => {
    const items = buildTargetItems(options, []);
    assert.deepEqual(
      items.categories.map((item) => [item.label, item.productCount]),
      [
        ["Vélos & VAE", 1],
        ["Nautisme", 1],
      ],
    );
    assert.deepEqual(
      items.products.map((item) => item.label),
      ["Vespa 125", "VTT électrique", "Kayak"],
    );
    assert.ok(
      buildTargetItems(options, [{ type: "product", id: "p-old" }]).products.some(
        (item) => item.value === "product:p-old",
      ),
    );
  });

  test("selectTargetItems keeps the picked order and ignores unknown targets", () => {
    const items = buildTargetItems(options, []);
    const selected = selectTargetItems(
      [...items.categories, ...items.products],
      [
        { type: "product", id: "p-vespa" },
        { type: "product", id: "gone" },
        { type: "category", id: "cat-water" },
      ],
    );
    assert.deepEqual(
      selected.map((item) => item.value),
      ["product:p-vespa", "category:cat-water"],
    );
  });
});

describe("toCustomerFieldPayload", () => {
  const base = {
    label: "Taille",
    type: "number" as const,
    scope: "customer" as const,
    options: ["ignored"],
    unit: "cm",
    helpText: "",
    section: "Mensurations",
    appliesTo: "business" as const,
    isRequired: true,
    isSensitive: false,
    showOnContract: true,
    isSearchable: true,
    showInList: true,
    ...DEFAULT_ONLINE_SETTINGS,
  };

  test("an item field drops the customer-record switches", () => {
    const payload = toCustomerFieldPayload({ ...base, scope: "item" });
    assert.equal(payload.appliesTo, "all");
    assert.equal(payload.isRequired, false);
    assert.equal(payload.isSearchable, false);
    assert.equal(payload.showInList, false);
    assert.equal(payload.showOnContract, true);
  });

  test("a customer field keeps them; blanks become null, options only for lists", () => {
    const payload = toCustomerFieldPayload(base);
    assert.equal(payload.appliesTo, "business");
    assert.equal(payload.isRequired, true);
    assert.equal(payload.options, null);
    assert.equal(payload.helpText, null);
    assert.equal(payload.unit, "cm");
  });

  test("a field never asked is never editable by the customer", () => {
    assert.equal(
      toCustomerFieldPayload({ ...base, customerEditable: true }).customerEditable,
      false,
    );
    assert.equal(
      toCustomerFieldPayload({ ...base, collectMode: "optional", customerEditable: true })
        .customerEditable,
      true,
    );
  });
});
