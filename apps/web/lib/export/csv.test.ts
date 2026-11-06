import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { generateCsv, neutralizeFormula } from "./csv";

describe("neutralizeFormula", () => {
  test("a cell a spreadsheet would evaluate becomes plain text", () => {
    assert.equal(
      neutralizeFormula('=HYPERLINK("https://evil.test")'),
      '\'=HYPERLINK("https://evil.test")',
    );
    assert.equal(neutralizeFormula("+1+cmd|' /C calc'!A0"), "'+1+cmd|' /C calc'!A0");
    assert.equal(neutralizeFormula("-2+3"), "'-2+3");
    assert.equal(neutralizeFormula("@SUM(A1:A9)"), "'@SUM(A1:A9)");
    assert.equal(neutralizeFormula("\t=1+1"), "'\t=1+1");
  });

  test("negative amounts stay numbers", () => {
    assert.equal(neutralizeFormula("-12.50"), "-12.50");
    assert.equal(neutralizeFormula("-5"), "-5");
  });

  test("a phone number keeps its plus sign as text", () => {
    assert.equal(neutralizeFormula("+33612345678"), "'+33612345678");
    assert.equal(neutralizeFormula("+44 835 110503"), "'+44 835 110503");
  });

  test("ordinary text is untouched", () => {
    assert.equal(neutralizeFormula("Thomas"), "Thomas");
    assert.equal(neutralizeFormula("a=b"), "a=b");
    assert.equal(neutralizeFormula(""), "");
  });
});

describe("generateCsv", () => {
  test("neutralises headers and cells, then applies RFC 4180 quoting", () => {
    const csv = generateCsv(
      ["Name", "=Label"],
      [
        ["=1+1,2", 'say "hi"'],
        ["-5", "plain"],
      ],
    );

    assert.equal(csv, '\uFEFFName,\'=Label\r\n"\'=1+1,2","say ""hi"""\r\n-5,plain');
  });
});
