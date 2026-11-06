import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseMoneyCell,
  parsePricingModeCell,
  suggestProductImportMapping,
  transformProductImportRow,
} from "./product-import";

describe("suggestProductImportMapping", () => {
  test("recognises catalogue columns, one target per column", () => {
    assert.deepEqual(
      suggestProductImportMapping([
        "Réf.",
        "Désignation",
        "Catégorie",
        "Prix / jour",
        "Prix",
        "Caution",
        "Qté",
        "Couleur",
      ]),
      {
        "Réf.": "field:externalId",
        Désignation: "field:name",
        Catégorie: "field:category",
        "Prix / jour": "field:price",
        Prix: null,
        Caution: "field:deposit",
        Qté: "field:quantity",
        Couleur: null,
      },
    );
  });
});

describe("parseMoneyCell", () => {
  test("reads amounts whatever the spreadsheet's locale", () => {
    assert.equal(parseMoneyCell("1 250,50 €"), "1250.50");
    assert.equal(parseMoneyCell("1.250,50"), "1250.50");
    assert.equal(parseMoneyCell("1,250.50"), "1250.50");
    assert.equal(parseMoneyCell("12.5"), "12.50");
    assert.equal(parseMoneyCell("35"), "35.00");
    assert.equal(parseMoneyCell("1.250"), "1250.00");
    assert.equal(parseMoneyCell("R$ 89,90"), "89.90");
  });

  test("refuses what is not an amount", () => {
    assert.equal(parseMoneyCell("sur devis"), null);
    assert.equal(parseMoneyCell("-10"), null);
    assert.equal(parseMoneyCell(""), null);
  });
});

describe("parsePricingModeCell", () => {
  test("reads the period in the platform's languages", () => {
    assert.equal(parsePricingModeCell("Jour"), "day");
    assert.equal(parsePricingModeCell("par heure"), "hour");
    assert.equal(parsePricingModeCell("Semaine"), "week");
    assert.equal(parsePricingModeCell("week"), "week");
    assert.equal(parsePricingModeCell("mois"), null);
  });
});

describe("transformProductImportRow", () => {
  const mapping = {
    Ref: "field:externalId",
    Nom: "field:name",
    Famille: "field:category",
    Tarif: "field:price",
    Période: "field:pricingMode",
    Caution: "field:deposit",
    Stock: "field:quantity",
    Divers: null,
  };

  test("a full row becomes a product, every value in its stored form", () => {
    assert.deepEqual(
      transformProductImportRow(
        {
          Ref: "VTT-01",
          Nom: " VTT électrique ",
          Famille: "Vélos",
          Tarif: "45,00 €",
          Période: "jour",
          Caution: "500",
          Stock: "6",
          Divers: "x",
        },
        mapping,
      ),
      {
        input: {
          externalId: "VTT-01",
          name: "VTT électrique",
          description: null,
          category: "Vélos",
          price: "45.00",
          pricingMode: "day",
          deposit: "500.00",
          quantity: 6,
        },
        errors: [],
        warnings: [],
      },
    );
  });

  test("only a missing name or price blocks a row", () => {
    const blocked = transformProductImportRow({ Nom: "", Tarif: "" }, mapping);
    assert.equal(blocked.input, null);
    assert.deepEqual(
      blocked.errors.map((error) => error.code),
      ["productNameRequired", "priceRequired"],
    );
    assert.deepEqual(
      transformProductImportRow({ Nom: "Kayak", Tarif: "sur devis" }, mapping).errors,
      [{ field: null, code: "priceInvalid" }],
    );
  });

  test("an unreadable deposit, quantity or period falls back with a warning", () => {
    const result = transformProductImportRow(
      { Nom: "Kayak", Tarif: "30", Période: "mois", Caution: "voir contrat", Stock: "beaucoup" },
      mapping,
    );
    assert.deepEqual(result.warnings.map((warning) => warning.code).sort(), [
      "depositInvalid",
      "pricingModeUnknown",
      "quantityInvalid",
    ]);
    assert.deepEqual(
      [result.input?.pricingMode, result.input?.deposit, result.input?.quantity],
      ["day", null, null],
    );
  });
});
