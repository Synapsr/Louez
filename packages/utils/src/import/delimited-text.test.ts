import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { detectDelimiter, parseDelimitedText } from "./delimited-text";

describe("detectDelimiter", () => {
  test("recognises commas, French semicolons and a spreadsheet paste", () => {
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
    assert.equal(detectDelimiter("Nom;Prénom;E-mail\nDupont;Jean;j@x.fr"), ";");
    assert.equal(detectDelimiter("Nom\tPrénom\nDupont\tJean"), "\t");
  });

  test("a comma inside an address does not beat the real separator", () => {
    assert.equal(
      detectDelimiter('Nom;Adresse\nDupont;"3, rue de la Paix"\nMartin;"8, quai Vauban"'),
      ";",
    );
  });
});

describe("parseDelimitedText", () => {
  test("quotes, doubled quotes, line breaks in a cell, BOM and CRLF", () => {
    const table = parseDelimitedText(
      '﻿Nom,Note\r\n"Dupont, Jean","Dit ""JJ""\nvient le matin"\r\nMartin,\r\n',
    );
    assert.deepEqual(table.headers, ["Nom", "Note"]);
    assert.deepEqual(table.rows, [
      { Nom: "Dupont, Jean", Note: 'Dit "JJ"\nvient le matin' },
      { Nom: "Martin", Note: "" },
    ]);
  });

  test("blank lines are dropped, short rows padded, cells trimmed", () => {
    const table = parseDelimitedText("a;b;c\n\n 1 ; 2 \n;;\n");
    assert.deepEqual(table.rows, [{ a: "1", b: "2", c: "" }]);
  });

  test("blank and repeated column names stay addressable", () => {
    assert.deepEqual(parseDelimitedText("Tel,,Tel\n1,2,3").headers, [
      "Tel",
      "Colonne 2",
      "Tel (2)",
    ]);
  });

  test("empty input gives an empty table", () => {
    assert.deepEqual(parseDelimitedText("   \n"), { delimiter: ",", headers: [], rows: [] });
  });
});
