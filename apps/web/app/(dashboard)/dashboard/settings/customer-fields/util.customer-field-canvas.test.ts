import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  CustomerFieldDefinition,
  CustomerProfileFieldSettings,
  ResolvedCustomerProfileSettings,
} from "@louez/types";

import {
  customFieldFlags,
  isSameCanvasField,
  listAskableProfileFields,
  profileFieldAllowsRequired,
  profileFieldFlags,
  toCanvasFieldKey,
} from "./util.customer-field-canvas";

const field = (overrides: Partial<CustomerFieldDefinition> = {}): CustomerFieldDefinition => ({
  id: "licence",
  key: "licence",
  label: "Permis",
  type: "text",
  format: null,
  options: null,
  unit: null,
  helpText: null,
  section: "Identité",
  position: 1,
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

const profile = (
  overrides: Partial<CustomerProfileFieldSettings> = {},
): CustomerProfileFieldSettings => ({
  visibility: "optional",
  collectMode: "never",
  targetMode: "all",
  targets: [],
  customerEditable: false,
  ...overrides,
});

describe("canvas field refs", () => {
  test("a store field and a Louez field never share a key", () => {
    assert.equal(toCanvasFieldKey({ kind: "field", id: "birthDate" }), "field:birthDate");
    assert.equal(toCanvasFieldKey({ kind: "profile", key: "birthDate" }), "profile:birthDate");
    assert.equal(toCanvasFieldKey({ kind: "draft" }), "draft");
  });

  test("a selection matches the field it points at, whatever else it carries", () => {
    const selection = { kind: "profile" as const, key: "socialLinks" as const, request: 3 };
    assert.equal(isSameCanvasField(selection, { kind: "profile", key: "socialLinks" }), true);
    assert.equal(isSameCanvasField(selection, { kind: "profile", key: "birthDate" }), false);
    assert.equal(isSameCanvasField({ kind: "draft" }, { kind: "field", id: "draft" }), false);
    assert.equal(isSameCanvasField(null, { kind: "field", id: "licence" }), false);
  });

  test("only social links cannot be required", () => {
    assert.equal(profileFieldAllowsRequired("birthDate"), true);
    assert.equal(profileFieldAllowsRequired("acquisitionSource"), true);
    assert.equal(profileFieldAllowsRequired("socialLinks"), false);
  });
});

describe("customFieldFlags", () => {
  test("says what changes how the field behaves", () => {
    const flags = customFieldFlags(
      field({
        isRequired: true,
        isSensitive: true,
        appliesTo: "business",
        collectMode: "optional",
        targetMode: "products",
      }),
    );
    assert.deepEqual(flags, {
      louez: false,
      hidden: false,
      required: true,
      sensitive: true,
      collectMode: "optional",
      appliesTo: "business",
      targeting: { kind: "empty" },
    });
  });

  test("a per-unit field is never required by the team nor limited to a buyer type", () => {
    const flags = customFieldFlags(
      field({ scope: "item", isRequired: true, appliesTo: "business" }),
    );
    assert.equal(flags.required, false);
    assert.equal(flags.appliesTo, "all");
  });

  test("a hidden field only says it is hidden", () => {
    const flags = customFieldFlags(
      field({ isActive: false, isRequired: true, isSensitive: true, collectMode: "required" }),
    );
    assert.deepEqual(flags, {
      louez: false,
      hidden: true,
      required: false,
      sensitive: false,
      collectMode: "never",
      appliesTo: "all",
      targeting: { kind: "irrelevant" },
    });
  });
});

describe("profileFieldFlags", () => {
  test("reads the visibility and the online settings like a store field's", () => {
    const flags = profileFieldFlags(
      profile({
        visibility: "required",
        collectMode: "optional",
        targetMode: "products",
        targets: [{ type: "category", id: "bikes" }],
      }),
    );
    assert.equal(flags.louez, true);
    assert.equal(flags.required, true);
    assert.equal(flags.collectMode, "optional");
    assert.deepEqual(flags.targeting, {
      kind: "targets",
      targets: [{ type: "category", id: "bikes" }],
    });
  });

  test("never asked, its targets are irrelevant", () => {
    assert.deepEqual(profileFieldFlags(profile({ targetMode: "products" })).targeting, {
      kind: "irrelevant",
    });
  });

  test("hidden, it stays a Louez field and says it is hidden", () => {
    const flags = profileFieldFlags(profile({ visibility: "hidden" }));
    assert.equal(flags.louez, true);
    assert.equal(flags.hidden, true);
    assert.equal(flags.required, false);
  });
});

describe("listAskableProfileFields", () => {
  const settings: ResolvedCustomerProfileSettings = {
    birthDate: profile({ collectMode: "required" }),
    acquisitionSource: profile(),
    socialLinks: profile({ visibility: "hidden" }),
  };

  test("offers the shown fields the checkout does not ask", () => {
    assert.deepEqual(listAskableProfileFields(settings), ["acquisitionSource"]);
  });

  test("keeps the ones just asked in place", () => {
    assert.deepEqual(listAskableProfileFields(settings, new Set(["birthDate"])), [
      "birthDate",
      "acquisitionSource",
    ]);
  });
});
