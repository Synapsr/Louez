import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  detectDateOrder,
  getCustomerImportIdentityKey,
  parseCountryCell,
  parseDateCell,
  suggestCustomerImportMapping,
  transformCustomerImportRow,
} from "./customer-import";

const cpf = {
  id: "c".repeat(21),
  key: "br_cpf_cnpj",
  label: "CPF / CNPJ",
  type: "text" as const,
  format: "br_cpf_cnpj" as const,
  options: null,
  isActive: true,
};
const level = {
  id: "l".repeat(21),
  key: "ski_level",
  label: "Niveau",
  type: "select" as const,
  format: null,
  options: ["Débutant", "Expert"],
  isActive: true,
};

describe("suggestCustomerImportMapping", () => {
  test("recognises column names across languages, accents and punctuation", () => {
    assert.deepEqual(
      suggestCustomerImportMapping(
        [
          "Prénom",
          "NOM",
          "E-mail",
          "Téléphone",
          "Code postal",
          "Date de naissance",
          "CPF/CNPJ",
          "Divers",
        ],
        [cpf],
      ),
      {
        Prénom: "field:firstName",
        NOM: "field:lastName",
        "E-mail": "field:email",
        Téléphone: "field:phone",
        "Code postal": "field:postalCode",
        "Date de naissance": "field:birthDate",
        "CPF/CNPJ": `custom:${cpf.id}`,
        Divers: null,
      },
    );
  });

  test("a target goes to one column only", () => {
    assert.deepEqual(suggestCustomerImportMapping(["Tel", "Mobile"], []), {
      Tel: "field:phone",
      Mobile: null,
    });
  });
});

describe("dates and countries", () => {
  test("the order of a date column is read from its values", () => {
    assert.equal(detectDateOrder(["03/04/1990", "25/12/1985"]), "dmy");
    assert.equal(detectDateOrder(["03/04/1990", "12/25/1985"]), "mdy");
    assert.equal(detectDateOrder(["03/04/1990"]), "dmy");
    assert.equal(parseDateCell("14/03/1991", "dmy"), "1991-03-14");
    assert.equal(parseDateCell("3.4.1990", "mdy"), "1990-03-04");
    assert.equal(parseDateCell("1991-03-14T00:00:00Z", "dmy"), "1991-03-14");
    assert.equal(parseDateCell("mars 1991", "dmy"), null);
  });

  test("a country is read from its code or its name in the platform's languages", () => {
    assert.equal(parseCountryCell("fr"), "FR");
    assert.equal(parseCountryCell("France"), "FR");
    assert.equal(parseCountryCell("Belgique"), "BE");
    assert.equal(parseCountryCell("Brasil"), "BR");
    assert.equal(parseCountryCell("Deutschland"), "DE");
    assert.equal(parseCountryCell("Atlantide"), null);
  });
});

describe("transformCustomerImportRow", () => {
  const context = {
    mapping: {
      Client: "field:fullName",
      Mail: "field:email",
      Tel: "field:phone",
      Pays: "field:country",
      Naissance: "field:birthDate",
      Société: "field:companyName",
      CPF: `custom:${cpf.id}`,
      Niveau: `custom:${level.id}`,
      Ignorée: null,
    },
    definitions: [cpf, level],
    defaultCountry: "FR",
    dateOrder: "dmy" as const,
  };

  test("a full row becomes a customer, every value in its stored form", () => {
    const result = transformCustomerImportRow(
      {
        Client: "Thomas  Le Goff",
        Mail: " Thomas@Example.FR ",
        Tel: "06 12 34 56 78",
        Pays: "France",
        Naissance: "14/03/1991",
        Société: "",
        CPF: "529.982.247-25",
        Niveau: "expert",
        Ignorée: "x",
      },
      context,
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.input, {
      externalId: null,
      customerType: "individual",
      email: "thomas@example.fr",
      firstName: "Thomas",
      lastName: "Le Goff",
      phone: "+33612345678",
      companyName: null,
      companyNumber: null,
      vatNumber: null,
      address: null,
      postalCode: null,
      city: null,
      country: "FR",
      birthDate: "1991-03-14",
      notes: null,
      customFields: { [cpf.id]: "52998224725", [level.id]: "Expert" },
    });
  });

  test("only a missing name, or no way at all to reach the customer, blocks a row", () => {
    const blocked = transformCustomerImportRow({ Client: "Madonna", Mail: "" }, context);
    assert.equal(blocked.input, null);
    assert.deepEqual(
      blocked.errors.map((error) => error.code),
      ["nameRequired", "contactRequired"],
    );
    const phoneOnly = transformCustomerImportRow({ Client: "Anne Le Floch", Tel: "06 12 34 56 78" }, context);
    assert.deepEqual(phoneOnly.errors, []);
    assert.equal(phoneOnly.input?.email, null);
    assert.equal(phoneOnly.input?.phone, "+33612345678");
    const unreadablePhone = transformCustomerImportRow({ Client: "Anne Le Floch", Tel: "12" }, context);
    assert.deepEqual(
      unreadablePhone.errors.map((error) => error.code),
      ["contactRequired"],
    );
    assert.deepEqual(
      transformCustomerImportRow({ Client: "A B", Mail: "not-an-email" }, context).errors,
      [{ field: null, code: "emailInvalid" }],
    );
  });

  test("an unreadable phone, country, date or custom value is dropped with a warning", () => {
    const result = transformCustomerImportRow(
      {
        Client: "A B",
        Mail: "a@b.fr",
        Tel: "12",
        Pays: "Atlantide",
        Naissance: "bientôt",
        Niveau: "Champion",
        Société: "ACME",
      },
      context,
    );
    assert.deepEqual(result.warnings.map((warning) => warning.code).sort(), [
      "birthDateInvalid",
      "countryUnknown",
      "customFieldInvalid",
      "phoneInvalid",
    ]);
    assert.equal(result.input?.phone, null);
    assert.equal(result.input?.customerType, "business");
    assert.deepEqual(result.input?.customFields, {});
  });
});

describe("getCustomerImportIdentityKey", () => {
  test("e-mail first, then phone with the last name, nothing without either", () => {
    assert.equal(
      getCustomerImportIdentityKey({ email: "a@b.fr", phone: "+33612345678", lastName: "Martin" }),
      "email:a@b.fr",
    );
    assert.equal(
      getCustomerImportIdentityKey({ email: null, phone: "+33612345678", lastName: " Le Floch " }),
      "phone:+33612345678|le floch",
    );
    assert.equal(getCustomerImportIdentityKey({ email: null, phone: null, lastName: "X" }), null);
  });
});
