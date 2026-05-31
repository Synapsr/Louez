import {
  AsYouType,
  type CountryCode,
  type MetadataJson,
  getCountries,
  getCountryCallingCode,
  parseIncompletePhoneNumber,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

const phoneMetadata: MetadataJson = metadata;
const DEFAULT_PHONE_COUNTRY: CountryCode = 'FR';
const PRIORITY_COUNTRIES: CountryCode[] = [
  'FR',
  'BE',
  'CH',
  'LU',
  'DE',
  'ES',
  'IT',
  'PT',
  'NL',
  'NO',
  'IS',
  'GB',
  'US',
  'CA',
  'PL',
  'AT',
  'IE',
  'MC',
];
const COUNTRY_DISPLAY_NAMES = new Intl.DisplayNames(['en'], {
  type: 'region',
});
const COUNTRY_FLAG_OFFSET = 127397;
const PHONE_COUNTRIES = getCountries(phoneMetadata);

export type PhoneCountryCode = CountryCode;

export interface CountryPhoneData {
  code: string;
  flag: string;
  name: string;
}

export interface CountryPhoneOption extends CountryPhoneData {
  iso: CountryCode;
}

export interface PhoneValidationResult {
  valid: boolean;
  normalized: string | null;
  error?: string;
  detectedCountry?: CountryCode;
  possibleCountries?: CountryCode[];
}

export interface ParsedPhoneInput {
  country: CountryCode;
  displayValue: string;
  nationalNumber: string;
  normalized: string | null;
}

function getCountryFlag(country: CountryCode): string {
  return Array.from(country)
    .map((letter) =>
      String.fromCodePoint(letter.charCodeAt(0) + COUNTRY_FLAG_OFFSET),
    )
    .join('');
}

function getCountryName(country: CountryCode): string {
  return COUNTRY_DISPLAY_NAMES.of(country) ?? country;
}

function buildCountryCodes(): Partial<Record<CountryCode, CountryPhoneData>> {
  const countryCodes: Partial<Record<CountryCode, CountryPhoneData>> = {};

  for (const country of PHONE_COUNTRIES) {
    countryCodes[country] = {
      code: getCountryCallingCode(country, phoneMetadata),
      flag: getCountryFlag(country),
      name: getCountryName(country),
    };
  }

  return countryCodes;
}

export const COUNTRY_CODES = buildCountryCodes();

export function getSupportedPhoneCountry(
  country: string | null | undefined,
): CountryCode | null {
  const normalizedCountry = country?.trim().toUpperCase();
  if (!normalizedCountry) return null;

  return (
    PHONE_COUNTRIES.find((supportedCountry) => {
      return supportedCountry === normalizedCountry;
    }) ?? null
  );
}

export function getDefaultPhoneCountry(
  country: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): CountryCode {
  return getSupportedPhoneCountry(country) ?? DEFAULT_PHONE_COUNTRY;
}

export function getCountryPhoneData(
  country: string | null | undefined,
): CountryPhoneData {
  const supportedCountry = getDefaultPhoneCountry(country);

  return {
    code: getCountryCallingCode(supportedCountry, phoneMetadata),
    flag: getCountryFlag(supportedCountry),
    name: getCountryName(supportedCountry),
  };
}

export function getCountriesSortedForDisplay(): CountryPhoneOption[] {
  return PHONE_COUNTRIES.map((country) => ({
    iso: country,
    ...getCountryPhoneData(country),
  })).sort((a, b) => {
    const aIndex = PRIORITY_COUNTRIES.indexOf(a.iso);
    const bIndex = PRIORITY_COUNTRIES.indexOf(b.iso);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.name.localeCompare(b.name);
  });
}

function parsePhoneNumberValue(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
) {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return undefined;

  const defaultCountry = getDefaultPhoneCountry(defaultCountryCode);

  return parsePhoneNumberFromString(
    trimmedPhone,
    defaultCountry,
    phoneMetadata,
  );
}

export function normalizePhoneNumber(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): string | null {
  const phoneNumber = parsePhoneNumberValue(phone, defaultCountryCode);

  if (!phoneNumber?.isPossible()) {
    return null;
  }

  return phoneNumber.number;
}

export function parsePhoneInput(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): ParsedPhoneInput {
  const defaultCountry = getDefaultPhoneCountry(defaultCountryCode);
  const formatter = new AsYouType(defaultCountry, phoneMetadata);
  const displayValue = formatter.input(phone);
  const phoneNumber = parsePhoneNumberValue(phone, defaultCountry);

  if (phoneNumber) {
    return {
      country: phoneNumber.country ?? formatter.getCountry() ?? defaultCountry,
      displayValue: phoneNumber.isPossible()
        ? phoneNumber.formatNational()
        : displayValue,
      nationalNumber: phoneNumber.nationalNumber,
      normalized: phoneNumber.isPossible() ? phoneNumber.number : null,
    };
  }

  return {
    country: formatter.getCountry() ?? defaultCountry,
    displayValue,
    nationalNumber:
      formatter.getNumber()?.nationalNumber ??
      parseIncompletePhoneNumber(phone),
    normalized: null,
  };
}

export function formatPhoneInput(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): string {
  const formatter = new AsYouType(
    getDefaultPhoneCountry(defaultCountryCode),
    phoneMetadata,
  );

  return formatter.input(phone);
}

export function getPhoneInputCountry(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): CountryCode {
  return parsePhoneInput(phone, defaultCountryCode).country;
}

export function getPhoneNationalNumber(phone: string): string {
  return parseIncompletePhoneNumber(phone);
}

export function validateAndNormalizePhone(
  phone: string,
  defaultCountryCode: string | null | undefined = DEFAULT_PHONE_COUNTRY,
): PhoneValidationResult {
  if (!phone || typeof phone !== 'string') {
    return {
      valid: false,
      normalized: null,
      error: 'Phone number is required',
    };
  }

  const phoneNumber = parsePhoneNumberValue(phone, defaultCountryCode);

  if (!phoneNumber) {
    return {
      valid: false,
      normalized: null,
      error: 'Invalid phone number format',
    };
  }

  if (!phoneNumber.isPossible()) {
    return {
      valid: false,
      normalized: null,
      error: 'Invalid phone number length',
      detectedCountry: phoneNumber.country,
      possibleCountries: phoneNumber.getPossibleCountries(),
    };
  }

  return {
    valid: true,
    normalized: phoneNumber.number,
    detectedCountry: phoneNumber.country,
    possibleCountries: phoneNumber.getPossibleCountries(),
  };
}

export function isValidPhoneFormat(phone: string): boolean {
  return validateAndNormalizePhone(phone).valid;
}

export function formatPhoneForDisplay(phone: string): string {
  const phoneNumber = parsePhoneNumberValue(phone);

  if (!phoneNumber?.isPossible()) {
    return phone;
  }

  return phoneNumber.formatInternational();
}
