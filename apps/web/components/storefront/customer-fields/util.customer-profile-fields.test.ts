import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
  getCustomerProfileFormIssues,
  hasEveryProfileValueOnFile,
  readCustomerProfileFieldIssues,
  toCustomerProfileFormValues,
  toCustomerProfileValuesInput,
  toProfileFieldName,
} from "./util.customer-profile-fields";

const everyField = [
  { key: "birthDate" as const, collectMode: "required" as const },
  { key: "acquisitionSource" as const, collectMode: "optional" as const },
  { key: "socialLinks" as const, collectMode: "optional" as const },
];

describe("toCustomerProfileFormValues", () => {
  it("reads the record's columns; blank for what is not on file", () => {
    assert.deepEqual(
      toCustomerProfileFormValues({
        birthDate: "1990-05-17",
        acquisitionSource: "partner",
        acquisitionSourceDetail: "Office de tourisme",
        socialLinks: { instagram: "lea", website: null, x: " " },
      }),
      {
        birthDate: "1990-05-17",
        acquisitionSource: { source: "partner", detail: "Office de tourisme" },
        socialLinks: { instagram: "lea" },
      },
    );
    assert.deepEqual(toCustomerProfileFormValues(null), EMPTY_CUSTOMER_PROFILE_FORM_VALUES);
  });
});

describe("toCustomerProfileValuesInput", () => {
  const values = {
    birthDate: " 1990-05-17 ",
    acquisitionSource: { source: "walk_in", detail: "typed before switching" },
    socialLinks: { instagram: " @lea ", website: "" },
  };

  it("sends only the listed fields, blanks trimmed away", () => {
    assert.deepEqual(toCustomerProfileValuesInput(values, [{ key: "socialLinks" }]), {
      socialLinks: { instagram: "@lea" },
    });
  });

  it("leaves a detail behind a source that takes none, keeps it behind 'Autre'", () => {
    assert.deepEqual(toCustomerProfileValuesInput(values, everyField), {
      birthDate: "1990-05-17",
      acquisitionSource: "walk_in",
      socialLinks: { instagram: "@lea" },
    });
    const other = { ...values, acquisitionSource: { source: "other", detail: " Salon " } };
    assert.deepEqual(toCustomerProfileValuesInput(other, [{ key: "acquisitionSource" }]), {
      acquisitionSource: "other",
      acquisitionSourceDetail: "Salon",
    });
  });
});

describe("getCustomerProfileFormIssues / hasEveryProfileValueOnFile", () => {
  it("runs the server's rules on the form values", () => {
    assert.deepEqual(getCustomerProfileFormIssues(EMPTY_CUSTOMER_PROFILE_FORM_VALUES, everyField), [
      { field: "birthDate", code: "required" },
    ]);
    assert.deepEqual(getCustomerProfileFormIssues(EMPTY_CUSTOMER_PROFILE_FORM_VALUES, []), []);
  });

  it("folds only when every listed field holds a valid value", () => {
    const saved = {
      birthDate: "1990-05-17",
      acquisitionSource: { source: "ads", detail: "" },
      socialLinks: { website: "louez.io" },
    };
    assert.equal(hasEveryProfileValueOnFile(everyField, saved), true);
    assert.equal(hasEveryProfileValueOnFile(everyField, { ...saved, socialLinks: {} }), false);
    assert.equal(
      hasEveryProfileValueOnFile(everyField, { ...saved, birthDate: "2999-01-01" }),
      false,
    );
  });
});

describe("readCustomerProfileFieldIssues", () => {
  it("reads `data.profileIssues` of an updateMyValues refusal, nothing otherwise", () => {
    const refusal = {
      data: { issues: [], profileIssues: [{ field: "birthDate", code: "required" }] },
    };
    assert.deepEqual(readCustomerProfileFieldIssues(refusal), [
      { field: "birthDate", code: "required" },
    ]);
    assert.deepEqual(readCustomerProfileFieldIssues(new Error("boom")), []);
  });

  it("names the form field of a native field", () => {
    assert.equal(toProfileFieldName("socialLinks"), "profileFields.socialLinks");
  });
});
