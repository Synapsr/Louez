import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";

import { DEFAULT_ONLINE_SETTINGS } from "./util.customer-field-online";
import {
  buildDraftValues,
  diffOnlineSettings,
  findAdoptedFields,
  patchDefinition,
  revertPatch,
  toDraftPreview,
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

describe("drafts", () => {
  test("a new field takes its type's width: half, a long text the whole row", () => {
    const online = DEFAULT_ONLINE_SETTINGS;
    assert.equal(buildDraftValues({ type: "text", scope: "customer", online }).width, "half");
    assert.equal(buildDraftValues({ type: "textarea", scope: "item", online }).width, "full");
  });

  test("starts blank, off, with the online settings given", () => {
    const values = buildDraftValues({
      type: "number",
      scope: "item",
      online: { ...DEFAULT_ONLINE_SETTINGS, collectMode: "optional" },
    });
    assert.equal(values.label, "");
    assert.equal(values.isRequired, false);
    assert.equal(values.collectMode, "optional");
    assert.equal(values.scope, "item");
  });

  test("its row shows a placeholder until it is named", () => {
    const values = buildDraftValues({
      type: "number",
      scope: "item",
      online: DEFAULT_ONLINE_SETTINGS,
    });
    assert.equal(toDraftPreview(values, "Nouveau champ").label, "Nouveau champ");
    assert.deepEqual(toDraftPreview({ ...values, label: " Taille ", unit: " cm " }, "x"), {
      label: "Taille",
      type: "number",
      unit: "cm",
      helpText: null,
    });
  });
});

describe("findAdoptedFields", () => {
  test("only the template's new fields, not the ones the store already had", () => {
    const before = [field("height", { templateKey: "bikes" }), field("cpf")];
    const after = [
      ...before,
      field("weight", { templateKey: "ski" }),
      field("level", { templateKey: "ski" }),
      field("other"),
    ];
    assert.deepEqual(
      findAdoptedFields(before, after, "ski").map((entry) => entry.id),
      ["weight", "level"],
    );
    assert.deepEqual(findAdoptedFields(after, after, "ski"), []);
  });
});
