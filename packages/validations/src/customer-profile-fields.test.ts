import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerProfileFieldSettings, ResolvedCustomerProfileSettings } from "@louez/types";

import {
  DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS,
  customerProfileFieldUpdateInputSchema,
  listAskedProfileFields,
  mergeCustomerProfileFieldSettings,
  planCustomerProfileValuesSave,
  profileFieldAppliesToProduct,
  resolveCheckoutProfileFields,
  resolveCustomerProfileSettings,
  validateCustomerProfileValues,
} from "./customer-profile-fields";

const BIKES = "bikes-category-000001";
const fatBike = { id: "fat-bike-00000000001", categoryIds: [BIKES] };
const helmet = { id: "helmet-0000000000001", categoryIds: ["accessories-000000001"] };

const settings = (
  overrides: Partial<
    Record<keyof ResolvedCustomerProfileSettings, Partial<CustomerProfileFieldSettings>>
  >,
): ResolvedCustomerProfileSettings => ({
  birthDate: { ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS, ...overrides.birthDate },
  acquisitionSource: { ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS, ...overrides.acquisitionSource },
  socialLinks: { ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS, ...overrides.socialLinks },
});

describe("resolveCustomerProfileSettings", () => {
  test("nothing stored: shown as optional, never asked, for all bookings", () => {
    for (const stored of [undefined, null, "hidden", [], 42]) {
      assert.deepEqual(resolveCustomerProfileSettings(stored), settings({}));
    }
  });

  test("reads the early bare visibility strings", () => {
    const resolved = resolveCustomerProfileSettings({
      birthDate: "required",
      acquisitionSource: "hidden",
      socialLinks: "optional",
    });
    assert.equal(resolved.birthDate.visibility, "required");
    assert.equal(resolved.birthDate.collectMode, "never");
    assert.equal(resolved.acquisitionSource.visibility, "hidden");
    assert.equal(resolved.socialLinks.visibility, "optional");
  });

  test("reads the settings objects, falling back per property on anything unreadable", () => {
    const resolved = resolveCustomerProfileSettings({
      birthDate: {
        visibility: "optional",
        collectMode: "required",
        targetMode: "products",
        targets: [{ type: "category", id: BIKES }, { type: "brand", id: "x" }, "junk"],
        customerEditable: true,
      },
      acquisitionSource: { visibility: "sometimes", collectMode: 3, customerEditable: "yes" },
    });
    assert.deepEqual(resolved.birthDate, {
      visibility: "optional",
      collectMode: "required",
      targetMode: "products",
      targets: [{ type: "category", id: BIKES }],
      customerEditable: true,
    });
    assert.deepEqual(resolved.acquisitionSource, DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS);
  });

  test("a hidden field is never asked, nor editable by the customer", () => {
    const resolved = resolveCustomerProfileSettings({
      birthDate: { visibility: "hidden", collectMode: "required", customerEditable: true },
    });
    assert.equal(resolved.birthDate.collectMode, "never");
    assert.equal(resolved.birthDate.customerEditable, false);
  });

  test("social links are never required, by the team or online", () => {
    const legacy = resolveCustomerProfileSettings({ socialLinks: "required" });
    assert.equal(legacy.socialLinks.visibility, "optional");
    const stored = resolveCustomerProfileSettings({
      socialLinks: { visibility: "required", collectMode: "required" },
    });
    assert.equal(stored.socialLinks.visibility, "optional");
    assert.equal(stored.socialLinks.collectMode, "optional");
  });

  test("the customer only edits a field the checkout asks", () => {
    const resolved = resolveCustomerProfileSettings({
      birthDate: { collectMode: "never", customerEditable: true },
    });
    assert.equal(resolved.birthDate.customerEditable, false);
  });
});

describe("updateProfileField input and merge", () => {
  const current = { ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS, collectMode: "required" as const };

  test("refuses what a native field cannot be", () => {
    const refused = [
      { field: "socialLinks", visibility: "required" },
      { field: "socialLinks", collectMode: "required" },
      { field: "birthDate", visibility: "hidden", collectMode: "optional" },
      { field: "birthDate", collectMode: "never", customerEditable: true },
      { field: "nickname", visibility: "optional" },
    ];
    for (const input of refused) {
      assert.equal(customerProfileFieldUpdateInputSchema.safeParse(input).success, false);
    }
    assert.equal(
      customerProfileFieldUpdateInputSchema.safeParse({
        field: "socialLinks",
        collectMode: "optional",
      }).success,
      true,
    );
  });

  test("hiding a field stops asking it and takes the customer's edit right", () => {
    const merged = mergeCustomerProfileFieldSettings(
      "birthDate",
      { ...current, customerEditable: true },
      { visibility: "hidden" },
    );
    assert.deepEqual(merged, {
      ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS,
      visibility: "hidden",
      collectMode: "never",
    });
  });

  test("asking online a field that stays hidden is incoherent", () => {
    const hidden = { ...DEFAULT_CUSTOMER_PROFILE_FIELD_SETTINGS, visibility: "hidden" as const };
    assert.equal(
      mergeCustomerProfileFieldSettings("birthDate", hidden, { collectMode: "optional" }),
      null,
    );
    assert.equal(
      mergeCustomerProfileFieldSettings("birthDate", hidden, { customerEditable: true }),
      null,
    );
  });

  test("only the keys sent change; targets replace the list", () => {
    const merged = mergeCustomerProfileFieldSettings("birthDate", current, {
      targetMode: "products",
      targets: [{ type: "category", id: BIKES }],
    });
    assert.deepEqual(merged, {
      ...current,
      targetMode: "products",
      targets: [{ type: "category", id: BIKES }],
    });
  });

  test("`never` takes the edit right with it, like a custom field", () => {
    const merged = mergeCustomerProfileFieldSettings(
      "acquisitionSource",
      { ...current, customerEditable: true },
      { collectMode: "never" },
    );
    assert.equal(merged?.customerEditable, false);
  });
});

describe("which native fields the checkout asks", () => {
  const configured = settings({
    birthDate: {
      collectMode: "required",
      targetMode: "products",
      targets: [{ type: "category", id: BIKES }],
    },
    acquisitionSource: { collectMode: "optional" },
    socialLinks: { visibility: "hidden" },
  });

  test("a field targeted on a category concerns its products only", () => {
    assert.equal(profileFieldAppliesToProduct(configured.birthDate, fatBike), true);
    assert.equal(profileFieldAppliesToProduct(configured.birthDate, helmet), false);
    assert.equal(profileFieldAppliesToProduct(configured.acquisitionSource, helmet), true);
    assert.equal(profileFieldAppliesToProduct(configured.socialLinks, helmet), false);
  });

  test("a cart with a bike is asked the birth date, a cart without is not", () => {
    assert.deepEqual(resolveCheckoutProfileFields(configured, [fatBike, helmet]), [
      { key: "birthDate", collectMode: "required" },
      { key: "acquisitionSource", collectMode: "optional" },
    ]);
    assert.deepEqual(resolveCheckoutProfileFields(configured, [helmet]), [
      { key: "acquisitionSource", collectMode: "optional" },
    ]);
  });

  test("`products` without a target asks nothing; nothing asked by default", () => {
    const untargeted = settings({ birthDate: { collectMode: "optional", targetMode: "products" } });
    assert.deepEqual(resolveCheckoutProfileFields(untargeted, [fatBike]), []);
    assert.deepEqual(resolveCheckoutProfileFields(settings({}), [fatBike]), []);
  });

  test("listAskedProfileFields ignores the cart and carries the edit right", () => {
    assert.deepEqual(listAskedProfileFields(configured), [
      { key: "birthDate", collectMode: "required", customerEditable: false },
      { key: "acquisitionSource", collectMode: "optional", customerEditable: false },
    ]);
  });
});

describe("validateCustomerProfileValues (checkout)", () => {
  const fields = [
    { key: "birthDate" as const, collectMode: "required" as const },
    { key: "acquisitionSource" as const, collectMode: "required" as const },
    { key: "socialLinks" as const, collectMode: "optional" as const },
  ];

  test("required birth date and source left empty are refused", () => {
    const { issues } = validateCustomerProfileValues({
      fields,
      values: { birthDate: "", acquisitionSource: " " },
    });
    assert.deepEqual(issues, [
      { field: "birthDate", code: "required" },
      { field: "acquisitionSource", code: "required" },
    ]);
  });

  test("an impossible or future birth date is refused", () => {
    for (const birthDate of ["1990-02-30", "31/12/1990", "2999-01-01", "1850-01-01"]) {
      const { issues } = validateCustomerProfileValues({
        fields: [fields[0]],
        values: { birthDate },
      });
      assert.deepEqual(issues, [{ field: "birthDate", code: "invalidDate" }], birthDate);
    }
  });

  test("an unknown source is refused", () => {
    const { issues } = validateCustomerProfileValues({
      fields: [fields[1]],
      values: { acquisitionSource: "billboard" },
    });
    assert.deepEqual(issues, [{ field: "acquisitionSource", code: "invalidOption" }]);
  });

  test("'Autre' keeps its detail; another source drops a detail typed before", () => {
    const other = validateCustomerProfileValues({
      fields: [fields[1]],
      values: { acquisitionSource: "other", acquisitionSourceDetail: "  Salon nautique " },
    });
    assert.deepEqual(other.values, {
      acquisitionSource: "other",
      acquisitionSourceDetail: "Salon nautique",
    });
    const walkIn = validateCustomerProfileValues({
      fields: [fields[1]],
      values: { acquisitionSource: "walk_in", acquisitionSourceDetail: "Salon nautique" },
    });
    assert.deepEqual(walkIn.values, {
      acquisitionSource: "walk_in",
      acquisitionSourceDetail: null,
    });
    const blankDetail = validateCustomerProfileValues({
      fields: [fields[1]],
      values: { acquisitionSource: "other", acquisitionSourceDetail: " " },
    });
    assert.deepEqual(blankDetail.values, {
      acquisitionSource: "other",
      acquisitionSourceDetail: null,
    });
  });

  test("valid values are normalised; values of fields not asked are dropped", () => {
    const { values, issues } = validateCustomerProfileValues({
      fields: [fields[0], fields[2]],
      values: {
        birthDate: "1990-05-17",
        acquisitionSource: "ads",
        socialLinks: { instagram: "https://www.instagram.com/lea.surf/", website: "", x: "@lea" },
      },
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(values, {
      birthDate: "1990-05-17",
      socialLinks: { instagram: "lea.surf", x: "lea" },
    });
  });

  test("a link that cannot be stored is refused; no link at all clears", () => {
    assert.deepEqual(
      validateCustomerProfileValues({
        fields: [fields[2]],
        values: { socialLinks: { whatsapp: "call me" } },
      }).issues,
      [{ field: "socialLinks", code: "invalidPhone" }],
    );
    assert.deepEqual(
      validateCustomerProfileValues({ fields: [fields[2]], values: { socialLinks: {} } }).values,
      { socialLinks: null },
    );
  });

  test("a required field left out is satisfied by a value on file, refused otherwise", () => {
    const onFile = { birthDate: "1988-03-02", acquisitionSource: null, socialLinks: null };
    const { issues } = validateCustomerProfileValues({ fields, values: {}, onFile });
    assert.deepEqual(issues, [{ field: "acquisitionSource", code: "required" }]);
  });

  test("partial (account): a field left out is not checked nor written", () => {
    const { values, issues } = validateCustomerProfileValues({
      fields,
      values: { socialLinks: { website: "louez.io" } },
      partial: true,
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(values, { socialLinks: { website: "https://louez.io" } });
  });
});

describe("planCustomerProfileValuesSave", () => {
  const current = {
    birthDate: "1980-01-01",
    acquisitionSource: null,
    acquisitionSourceDetail: null,
    socialLinks: { instagram: "on.file" },
  };
  const submitted = {
    birthDate: "1999-09-09",
    acquisitionSource: "other" as const,
    acquisitionSourceDetail: "Salon",
    socialLinks: { instagram: "typed", website: "https://louez.io" },
  };

  test("overwrite (signed in): what is sent replaces what is on file, null clears", () => {
    assert.deepEqual(
      planCustomerProfileValuesSave({ current, values: submitted, mode: "overwrite" }),
      submitted,
    );
    assert.deepEqual(
      planCustomerProfileValuesSave({
        current,
        values: { birthDate: null, socialLinks: null },
        mode: "overwrite",
      }),
      { birthDate: null, socialLinks: null },
    );
  });

  test("fillEmpty (not signed in): only fills what is missing, links merged network by network", () => {
    assert.deepEqual(
      planCustomerProfileValuesSave({ current, values: submitted, mode: "fillEmpty" }),
      {
        acquisitionSource: "other",
        acquisitionSourceDetail: "Salon",
        socialLinks: { instagram: "on.file", website: "https://louez.io" },
      },
    );
  });

  test("fillEmpty never clears", () => {
    assert.deepEqual(
      planCustomerProfileValuesSave({
        current,
        values: {
          birthDate: null,
          acquisitionSource: null,
          acquisitionSourceDetail: null,
          socialLinks: null,
        },
        mode: "fillEmpty",
      }),
      {},
    );
  });

  test("a new customer (nothing on file) takes every value", () => {
    const empty = {
      birthDate: null,
      acquisitionSource: null,
      acquisitionSourceDetail: null,
      socialLinks: null,
    };
    assert.deepEqual(
      planCustomerProfileValuesSave({ current: empty, values: submitted, mode: "fillEmpty" }),
      submitted,
    );
  });
});
