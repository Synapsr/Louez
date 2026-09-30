import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatIdentityValue,
  isValidIdentityValue,
  normalizeIdentityValue,
} from "./identity-formats";

describe("br_cpf_cnpj", () => {
  test("CPF and CNPJ control digits, whatever the punctuation", () => {
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "529.982.247-25"), true);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "52998224725"), true);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "529.982.247-26"), false);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "111.111.111-11"), false);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "11.222.333/0001-81"), true);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "11.222.333/0001-82"), false);
    assert.equal(isValidIdentityValue("br_cpf_cnpj", "1234"), false);
  });

  test("stored as digits, shown with its usual punctuation", () => {
    assert.equal(normalizeIdentityValue("br_cpf_cnpj", "529.982.247-25"), "52998224725");
    assert.equal(formatIdentityValue("br_cpf_cnpj", "52998224725"), "529.982.247-25");
    assert.equal(formatIdentityValue("br_cpf_cnpj", "11222333000181"), "11.222.333/0001-81");
    assert.equal(formatIdentityValue("br_cpf_cnpj", "123"), "123");
  });
});

describe("es_dni_nie", () => {
  test("DNI and NIE control letters", () => {
    assert.equal(isValidIdentityValue("es_dni_nie", "12345678Z"), true);
    assert.equal(isValidIdentityValue("es_dni_nie", "12345678-z"), true);
    assert.equal(isValidIdentityValue("es_dni_nie", "12345678A"), false);
    assert.equal(isValidIdentityValue("es_dni_nie", "X1234567L"), true);
    assert.equal(isValidIdentityValue("es_dni_nie", "X1234567T"), false);
    assert.equal(normalizeIdentityValue("es_dni_nie", " x-1234567 l "), "X1234567L");
  });
});

describe("it_codice_fiscale", () => {
  test("16-character person code and 11-digit company code", () => {
    assert.equal(isValidIdentityValue("it_codice_fiscale", "RSSMRA85T10A562S"), true);
    assert.equal(isValidIdentityValue("it_codice_fiscale", "rssmra85t10a562s"), true);
    assert.equal(isValidIdentityValue("it_codice_fiscale", "RSSMRA85T10A562X"), false);
    assert.equal(isValidIdentityValue("it_codice_fiscale", "12345678903"), true);
    assert.equal(isValidIdentityValue("it_codice_fiscale", "12345678901"), false);
  });
});

describe("pt_nif", () => {
  test("control digit", () => {
    assert.equal(isValidIdentityValue("pt_nif", "123456789"), true);
    assert.equal(isValidIdentityValue("pt_nif", "123 456 789"), true);
    assert.equal(isValidIdentityValue("pt_nif", "123456780"), false);
    assert.equal(isValidIdentityValue("pt_nif", "12345"), false);
  });
});
