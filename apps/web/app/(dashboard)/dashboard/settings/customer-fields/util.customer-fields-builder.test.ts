import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

import {
  applyReorder,
  applySectionRename,
  defaultSectionFor,
  diffOnlineSettings,
  findCreatedField,
  listAskableFields,
  listScopeSections,
  moveFieldPayload,
  moveSectionPayload,
  nextSectionName,
  patchDefinition,
  reorderSectionPayload,
  revertPatch,
  toFieldChange,
  toSettingsValues,
} from "./util.customer-fields-builder";

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

// The demo store: two customer sections, one per-unit section, one hidden field.
const fields = [
  field("cpf", { section: "Identité", position: 1 }),
  field("size", { section: "Vélo", position: 2, scope: "item", type: "number" }),
  field("saddle", { section: "Vélo", position: 3, scope: "item", type: "number" }),
  field("idNumber", { section: "Identité", position: 4 }),
  field("contact", { section: "Secours", position: 5 }),
  field("old", { section: "Identité", position: 6, isActive: false }),
];

describe("listScopeSections", () => {
  test("splits the scopes and keeps hidden fields in their place", () => {
    assert.deepEqual(
      listScopeSections(fields, "customer").map((section) => [
        section.name,
        section.fields.map((entry) => entry.id),
      ]),
      [
        ["Identité", ["cpf", "idNumber", "old"]],
        ["Secours", ["contact"]],
      ],
    );
    assert.deepEqual(
      listScopeSections(fields, "item").map((section) => section.name),
      ["Vélo"],
    );
  });

  test("appends the sections created on the page, until one holds a saved field", () => {
    const local = [
      { key: "a", scope: "customer" as const, name: "Permis" },
      { key: "b", scope: "customer" as const, name: "Secours" },
      { key: "c", scope: "item" as const, name: "Ski" },
    ];
    const sections = listScopeSections(fields, "customer", local);
    assert.deepEqual(
      sections.map((section) => [section.name, section.localKey]),
      [
        ["Identité", null],
        ["Secours", null],
        ["Permis", "a"],
      ],
    );
  });
});

describe("reorder payloads", () => {
  test("a drop inside a section keeps the other scope after the customer record", () => {
    const [cpf, , , idNumber, , old] = fields;
    assert.deepEqual(reorderSectionPayload(fields, "customer", "Identité", [idNumber, old, cpf]), [
      { id: "idNumber", section: "Identité" },
      { id: "old", section: "Identité" },
      { id: "cpf", section: "Identité" },
      { id: "contact", section: "Secours" },
      { id: "size", section: "Vélo" },
      { id: "saddle", section: "Vélo" },
    ]);
  });

  test("moving a field only looks at its own scope's sections", () => {
    assert.deepEqual(moveFieldPayload(fields, { id: "cpf", scope: "customer" }, "Secours"), [
      { id: "idNumber", section: "Identité" },
      { id: "old", section: "Identité" },
      { id: "contact", section: "Secours" },
      { id: "cpf", section: "Secours" },
      { id: "size", section: "Vélo" },
      { id: "saddle", section: "Vélo" },
    ]);
  });

  test("a section moves one step, and stays put past the ends", () => {
    assert.deepEqual(
      moveSectionPayload(fields, "customer", "Secours", -1).map((entry) => entry.id),
      ["contact", "cpf", "idNumber", "old", "size", "saddle"],
    );
    assert.deepEqual(
      moveSectionPayload(fields, "customer", "Identité", -1).map((entry) => entry.id),
      ["cpf", "idNumber", "old", "contact", "size", "saddle"],
    );
  });

  test("applyReorder places every listed field and leaves the others", () => {
    const next = applyReorder(fields, [
      { id: "contact", section: "Identité" },
      { id: "cpf", section: "Identité" },
    ]);
    assert.deepEqual(
      next
        .filter((entry) => ["contact", "cpf", "old"].includes(entry.id))
        .map((entry) => [entry.id, entry.section, entry.position]),
      [
        ["cpf", "Identité", 2],
        ["contact", "Identité", 1],
        ["old", "Identité", 6],
      ],
    );
  });

  test("a renamed section carries its hidden fields along", () => {
    const renamed = applySectionRename(fields, "Identité", "Pièces");
    assert.deepEqual(
      renamed.filter((entry) => entry.section === "Pièces").map((entry) => entry.id),
      ["cpf", "idNumber", "old"],
    );
  });
});

describe("patchDefinition / revertPatch", () => {
  test("stores empty texts as null and only touches the keys sent", () => {
    const patched = patchDefinition(field("a", { helpText: "Aide", unit: "cm" }), {
      helpText: "",
      isSensitive: true,
    });
    assert.equal(patched.helpText, null);
    assert.equal(patched.unit, "cm");
    assert.equal(patched.isSensitive, true);
    assert.equal(patched.label, "a");
  });

  test("a field no longer asked stops being editable by the customer", () => {
    const asked = field("a", { collectMode: "optional", customerEditable: true });
    const patched = patchDefinition(asked, { collectMode: "never" });
    assert.equal(patched.collectMode, "never");
    assert.equal(patched.customerEditable, false);
    // Putting it back restores both.
    const reverted = patchDefinition(patched, revertPatch(asked, { collectMode: "never" }));
    assert.equal(reverted.collectMode, "optional");
    assert.equal(reverted.customerEditable, true);
  });

  test("a revert leaves a later change to another setting alone", () => {
    const before = field("a", { isSensitive: false, showOnContract: false });
    const afterBoth = patchDefinition(before, { isSensitive: true, showOnContract: true });
    const reverted = patchDefinition(afterBoth, revertPatch(before, { isSensitive: true }));
    assert.equal(reverted.isSensitive, false);
    assert.equal(reverted.showOnContract, true);
  });
});

describe("diffOnlineSettings", () => {
  const current = toSettingsValues(field("a"));

  test("sends only what changed", () => {
    assert.deepEqual(diffOnlineSettings(current, { ...current, collectMode: "optional" }), {
      collectMode: "optional",
    });
    assert.deepEqual(diffOnlineSettings(current, current), {});
  });

  test("a new target list is sent whole", () => {
    const targets = [{ type: "category" as const, id: "cat" }];
    assert.deepEqual(diffOnlineSettings(current, { ...current, targets }), { targets });
  });
});

describe("toFieldChange", () => {
  const saved = field("a", { label: "Taille", unit: "cm", type: "number" });

  test("a label is trimmed, kept when blank, and not resent unchanged", () => {
    assert.deepEqual(toFieldChange(saved, "label", { label: "  Hauteur " }), {
      kind: "save",
      patch: { label: "Hauteur" },
    });
    assert.deepEqual(toFieldChange(saved, "label", { label: "   " }), {
      kind: "reject",
      reason: "labelRequired",
    });
    assert.deepEqual(toFieldChange(saved, "label", { label: "Taille" }), { kind: "none" });
  });

  test("a list keeps at least one choice", () => {
    assert.deepEqual(toFieldChange(saved, "options", { options: [] }), {
      kind: "reject",
      reason: "optionsRequired",
    });
  });

  test("texts compare with what is stored, null reading as empty", () => {
    assert.deepEqual(toFieldChange(saved, "unit", { unit: "cm " }), { kind: "none" });
    assert.deepEqual(toFieldChange(saved, "helpText", { helpText: "" }), { kind: "none" });
    assert.deepEqual(toFieldChange(saved, "helpText", { helpText: "En cm" }), {
      kind: "save",
      patch: { helpText: "En cm" },
    });
  });

  test("online settings go out as the difference", () => {
    assert.deepEqual(toFieldChange(saved, "online", { collectMode: "required" }), {
      kind: "save",
      patch: { collectMode: "required" },
    });
    assert.deepEqual(toFieldChange(saved, "online", { collectMode: "never" }), { kind: "none" });
  });

  test("« Afficher sur la fiche » goes out as `isActive`", () => {
    assert.deepEqual(toFieldChange(field("cpf"), "isActive", { isActive: false }), {
      kind: "save",
      patch: { isActive: false },
    });
  });

  test("switches go out as they are", () => {
    assert.deepEqual(toFieldChange(saved, "isSensitive", { isSensitive: true }), {
      kind: "save",
      patch: { isSensitive: true },
    });
  });
});

describe("toSettingsValues", () => {
  test("unset texts read as empty strings", () => {
    const values = toSettingsValues(field("a"));
    assert.equal(values.helpText, "");
    assert.equal(values.unit, "");
    assert.deepEqual(values.options, []);
  });
});

describe("section names", () => {
  test("a new section never takes an existing name", () => {
    assert.equal(nextSectionName("Nouvelle section", ["Identité"]), "Nouvelle section");
    assert.equal(
      nextSectionName("Nouvelle section", ["Nouvelle section", "Nouvelle section 2"]),
      "Nouvelle section 3",
    );
  });

  test("a field added from the header goes to the last section of its scope", () => {
    assert.equal(
      defaultSectionFor([{ name: "Identité" }, { name: "Secours" }], "Infos"),
      "Secours",
    );
    assert.equal(defaultSectionFor([], "Infos"), "Infos");
  });
});

describe("findCreatedField", () => {
  test("finds the one new id", () => {
    assert.equal(findCreatedField(fields, [...fields, field("new")])?.id, "new");
    assert.equal(findCreatedField(fields, fields), null);
  });
});

describe("listAskableFields", () => {
  test("lists what the checkout does not ask, per scope, keeping those just asked", () => {
    const withAsked = fields.map((entry) =>
      entry.id === "idNumber" ? { ...entry, collectMode: "optional" as const } : entry,
    );
    const askable = listAskableFields(withAsked);
    assert.deepEqual(
      askable.customer.map((entry) => entry.id),
      ["cpf", "contact"],
    );
    assert.deepEqual(
      askable.item.map((entry) => entry.id),
      ["size", "saddle"],
    );
    assert.deepEqual(
      listAskableFields(withAsked, new Set(["idNumber"])).customer.map((entry) => entry.id),
      ["cpf", "idNumber", "contact"],
    );
  });
});
