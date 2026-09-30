import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CustomerFieldDefinition } from "@louez/types";
import { resolveCustomerProfileSettings, resolveStoreCustomerFormLayout } from "@louez/validations";

import type { CustomerFormCustomer } from "./customer-form.types";
import {
  getCompanyNumberLabelKey,
  getCustomerFormDefaults,
  isCustomerRecordItemFilled,
  listCustomerRecordItems,
  toCustomerRecordInput,
} from "./util.customer-form";

const licence: CustomerFieldDefinition = {
  id: "licence0000000000000x",
  key: "licence",
  label: "Permis",
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
};

const customer: CustomerFormCustomer = {
  id: "customer000000000000x",
  customerType: "business",
  email: "lea@example.test",
  firstName: "Léa",
  lastName: "Martin",
  companyName: "Glisse SARL",
  companyNumber: "123456789",
  vatNumber: null,
  phone: null,
  address: null,
  city: "Vannes",
  postalCode: null,
  country: "FR",
  birthDate: null,
  acquisitionSource: "other",
  acquisitionSourceDetail: "Salon",
  socialLinks: { instagram: "  " },
  notes: "VIP",
};

const items = resolveStoreCustomerFormLayout({
  settings: {
    customerProfile: resolveCustomerProfileSettings({ socialLinks: "hidden" }),
    customerFormLayout: { email: { position: 3, width: "full" } },
  },
  scope: "customer",
  definitions: [licence],
  customerType: "business",
});

describe("getCustomerFormDefaults", () => {
  test("a new customer starts blank, with what the search already typed", () => {
    const values = getCustomerFormDefaults(undefined, {}, { firstName: "Tom", phone: "0612" });
    assert.equal(values.customerType, "individual");
    assert.equal(values.firstName, "Tom");
    assert.equal(values.phone, "0612");
    assert.equal(values.email, "");
    assert.deepEqual(values.socialLinks, {});
  });

  test("an existing customer's values win, blanks as empty strings", () => {
    const values = getCustomerFormDefaults(
      customer,
      { [licence.id]: "B-42" },
      { firstName: "Tom" },
    );
    assert.equal(values.firstName, "Léa");
    assert.equal(values.phone, "");
    assert.equal(values.acquisitionSource, "other");
    assert.deepEqual(values.customFields, { [licence.id]: "B-42" });
    // A blank link is not a link.
    assert.deepEqual(values.socialLinks, {});
  });
});

describe("the record's Informations", () => {
  const recordItems = listCustomerRecordItems(items);

  test("everything but the record's title (names, company name), in layout order", () => {
    // The stored layout put e-mail at 3, after the licence (position 1).
    assert.deepEqual(
      recordItems.map((item) => item.key),
      [
        licence.id,
        "email",
        "phone",
        "address",
        "companyNumber",
        "vatNumber",
        "birthDate",
        "acquisitionSource",
      ],
    );
  });

  test("only what is filled shows on the card", () => {
    const filled = recordItems
      .filter((item) => isCustomerRecordItemFilled(item, customer, { [licence.id]: " " }))
      .map((item) => item.key);
    assert.deepEqual(filled, ["email", "address", "companyNumber", "acquisitionSource"]);
  });

  test("the Sheet sends only what it shows: never the names, the notes or a hidden field", () => {
    const values = getCustomerFormDefaults(customer, { [licence.id]: "B-42", other: "x" });
    const input = toCustomerRecordInput({ ...values, city: "Auray" }, recordItems);

    assert.deepEqual(input, {
      email: "lea@example.test",
      phone: "",
      address: "",
      city: "Auray",
      postalCode: "",
      country: "FR",
      companyNumber: "123456789",
      vatNumber: "",
      birthDate: "",
      acquisitionSource: "other",
      acquisitionSourceDetail: "Salon",
      customFields: { [licence.id]: "B-42" },
    });
  });
});

test("the company number is named after the customer's country", () => {
  assert.equal(getCompanyNumberLabelKey("FR"), "companyNumberSiren");
  assert.equal(getCompanyNumberLabelKey("BE"), "companyNumberBce");
  assert.equal(getCompanyNumberLabelKey(null), "companyNumber");
});
