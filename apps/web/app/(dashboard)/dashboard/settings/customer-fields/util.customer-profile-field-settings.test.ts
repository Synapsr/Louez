import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerProfileFieldSettings, ResolvedCustomerProfileSettings } from "@louez/types";

import {
  applyProfileFieldPatch,
  revertProfileFieldPatch,
  toProfileVisibility,
} from "./util.customer-profile-field-settings";

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

const settings: ResolvedCustomerProfileSettings = {
  birthDate: profile({ collectMode: "optional", customerEditable: true }),
  acquisitionSource: profile({ visibility: "required" }),
  socialLinks: profile(),
};

describe("toProfileVisibility", () => {
  test("the two record switches map to the stored visibility", () => {
    assert.equal(toProfileVisibility({ shown: false }), "hidden");
    assert.equal(toProfileVisibility({ shown: true }), "optional");
    assert.equal(toProfileVisibility({ required: true }), "required");
    assert.equal(toProfileVisibility({ required: false }), "optional");
  });
});

describe("applyProfileFieldPatch", () => {
  test("hiding a field stops asking it, and only touches that field", () => {
    const next = applyProfileFieldPatch(settings, "birthDate", { visibility: "hidden" });
    assert.deepEqual(next.birthDate, {
      visibility: "hidden",
      collectMode: "never",
      targetMode: "all",
      targets: [],
      customerEditable: false,
    });
    assert.equal(next.acquisitionSource, settings.acquisitionSource);
    assert.equal(next.socialLinks, settings.socialLinks);
  });

  test("« Non » takes the customer's edit right with it", () => {
    const next = applyProfileFieldPatch(settings, "birthDate", { collectMode: "never" });
    assert.equal(next.birthDate.customerEditable, false);
  });

  test("a patch the server would refuse changes nothing", () => {
    const hidden = applyProfileFieldPatch(settings, "birthDate", { visibility: "hidden" });
    assert.equal(applyProfileFieldPatch(hidden, "birthDate", { collectMode: "optional" }), hidden);
  });
});

describe("revertProfileFieldPatch", () => {
  test("puts back what the refused patch changed, with the edit right it moved", () => {
    const optimistic = applyProfileFieldPatch(settings, "birthDate", { visibility: "hidden" });
    const reverted = revertProfileFieldPatch(optimistic, "birthDate", settings.birthDate, {
      visibility: "hidden",
    });
    assert.deepEqual(reverted.birthDate, settings.birthDate);
  });

  test("leaves a later change to another setting alone", () => {
    const later = applyProfileFieldPatch(settings, "birthDate", {
      targetMode: "products",
      targets: [{ type: "product", id: "bike" }],
    });
    const reverted = revertProfileFieldPatch(later, "birthDate", settings.birthDate, {
      collectMode: "required",
    });
    assert.equal(reverted.birthDate.targetMode, "products");
    assert.deepEqual(reverted.birthDate.targets, [{ type: "product", id: "bike" }]);
    assert.equal(reverted.birthDate.collectMode, "optional");
  });
});
