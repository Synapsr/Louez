import {
  type CountryCode,
  type MetadataJson,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

const phoneMetadata: MetadataJson = metadata;
const DEFAULT_COUNTRY: CountryCode = 'FR';

export function isPossiblePhoneNumberInput(
  value: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): boolean {
  const phoneNumber = parsePhoneNumberFromString(
    value,
    defaultCountry,
    phoneMetadata,
  );

  return phoneNumber?.isPossible() ?? false;
}

export function isPossibleE164PhoneNumber(value: string): boolean {
  const phoneNumber = parsePhoneNumberFromString(value, phoneMetadata);

  return phoneNumber?.number === value && phoneNumber.isPossible();
}

const isCountryCode = (value: string): value is CountryCode => value in phoneMetadata.countries;

/** The number in E.164 form, read with a default country when it has no prefix; null when unusable. */
export function toE164PhoneNumber(value: string, defaultCountry: string): string | null {
  const country = defaultCountry.toUpperCase();
  const phoneNumber = parsePhoneNumberFromString(
    value,
    isCountryCode(country) ? country : DEFAULT_COUNTRY,
    phoneMetadata,
  );
  return phoneNumber?.isPossible() ? phoneNumber.number : null;
}

/** ISO 3166-1 alpha-2 codes known to the phone metadata: the list of countries of the platform. */
export function getKnownCountryCodes(): string[] {
  return Object.keys(phoneMetadata.countries);
}
