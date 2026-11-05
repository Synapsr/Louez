import type { CustomerFieldFormat } from "@louez/types";

const digitsOnly = (value: string) => value.replace(/\D/g, "");
const compactUpper = (value: string) => value.replace(/[\s.\-/]/g, "").toUpperCase();

/** The stored form of an identifier: digits for numeric schemes, compact upper case otherwise. */
export function normalizeIdentityValue(format: CustomerFieldFormat, value: string): string {
  switch (format) {
    case "br_cpf_cnpj":
    case "pt_nif":
      return digitsOnly(value);
    case "es_dni_nie":
    case "it_codice_fiscale":
      return compactUpper(value);
  }
}

const isRepeatedDigit = (digits: string) => /^(\d)\1+$/.test(digits);

const weightedSum = (digits: string, weights: number[]) =>
  weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0);

const isValidCpf = (digits: string) => {
  if (isRepeatedDigit(digits)) return false;
  const checkDigit = (length: number) => {
    const weights = Array.from({ length }, (_, index) => length + 1 - index);
    const rest = (weightedSum(digits, weights) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
};

const isValidCnpj = (digits: string) => {
  if (isRepeatedDigit(digits)) return false;
  const checkDigit = (weights: number[]) => {
    const rest = weightedSum(digits, weights) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return (
    checkDigit(first) === Number(digits[12]) && checkDigit([6, ...first]) === Number(digits[13])
  );
};

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

const isValidDniNie = (value: string) => {
  const match = /^([XYZ]|\d)(\d{7})([A-Z])$/.exec(value);
  if (!match) return false;
  const [, head, body, letter] = match;
  const number = Number(`${"XYZ".includes(head) ? "XYZ".indexOf(head) : head}${body}`);
  return DNI_LETTERS[number % 23] === letter;
};

const CF_ODD_VALUES: Record<string, number> = Object.fromEntries(
  [
    1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
  ].flatMap((value, index) => {
    const letter = String.fromCharCode(65 + index);
    return index < 10
      ? [
          [letter, value],
          [String(index), value],
        ]
      : [[letter, value]];
  }),
);

const cfEvenValue = (char: string) => (/\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65);

/** Natural persons carry 16 characters with a control letter; companies reuse their 11-digit VAT number. */
const isValidCodiceFiscale = (value: string) => {
  if (/^\d{11}$/.test(value)) {
    const sum = [...value].reduce((total, char, index) => {
      const digit = Number(char);
      if (index % 2 === 0) return total + digit;
      const doubled = digit * 2;
      return total + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);
    return sum % 10 === 0;
  }
  if (!/^[A-Z0-9]{15}[A-Z]$/.test(value)) return false;
  const sum = Array.from(value.slice(0, 15)).reduce(
    (total, char, index) => total + (index % 2 === 0 ? CF_ODD_VALUES[char] : cfEvenValue(char)),
    0,
  );
  return String.fromCharCode(65 + (sum % 26)) === value[15];
};

const isValidPtNif = (digits: string) => {
  if (!/^\d{9}$/.test(digits)) return false;
  const rest = weightedSum(digits, [9, 8, 7, 6, 5, 4, 3, 2]) % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(digits[8]);
};

/**
 * Whether a value passes its scheme's control digits. Callers warn on a
 * failure and never block: imported data is rarely clean, and a number the
 * merchant copied from a document is still worth keeping.
 */
export function isValidIdentityValue(format: CustomerFieldFormat, value: string): boolean {
  const normalized = normalizeIdentityValue(format, value);
  switch (format) {
    case "br_cpf_cnpj":
      if (normalized.length === 11) return isValidCpf(normalized);
      if (normalized.length === 14) return isValidCnpj(normalized);
      return false;
    case "es_dni_nie":
      return isValidDniNie(normalized);
    case "it_codice_fiscale":
      return isValidCodiceFiscale(normalized);
    case "pt_nif":
      return isValidPtNif(normalized);
  }
}

/** Human-readable form of a stored identifier. */
export function formatIdentityValue(format: CustomerFieldFormat, value: string): string {
  if (format !== "br_cpf_cnpj") return value;
  if (/^\d{11}$/.test(value)) return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (/^\d{14}$/.test(value)) {
    return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value;
}
