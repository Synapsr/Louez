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
