import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatPhoneForDisplay,
  getCountriesSortedForDisplay,
  normalizePhoneNumber,
  parsePhoneInput,
  validateAndNormalizePhone,
} from './phone';

test('phone country list includes Norway and Iceland', () => {
  const countries = getCountriesSortedForDisplay();

  assert.ok(countries.some((country) => country.iso === 'NO'));
  assert.ok(countries.some((country) => country.iso === 'IS'));
  assert.ok(countries.length > 200);
});

test('normalizes Norwegian and Icelandic international numbers', () => {
  assert.equal(normalizePhoneNumber('+47 91 23 45 67'), '+4791234567');
  assert.equal(normalizePhoneNumber('+354 612 3456'), '+3546123456');
});

test('normalizes international numbers written with 00 prefix', () => {
  assert.equal(normalizePhoneNumber('0047 91 23 45 67'), '+4791234567');
  assert.equal(normalizePhoneNumber('00354 612 3456'), '+3546123456');
});

test('uses default country for national input', () => {
  assert.equal(normalizePhoneNumber('06 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhoneNumber('91 23 45 67', 'NO'), '+4791234567');
});

test('supports non-geographic international numbers', () => {
  const result = validateAndNormalizePhone('+800 1234 5678');

  assert.equal(result.valid, true);
  assert.equal(result.normalized, '+80012345678');
  assert.equal(result.detectedCountry, undefined);
});

test('rejects impossible phone numbers', () => {
  const result = validateAndNormalizePhone('+47 12');

  assert.equal(result.valid, false);
  assert.equal(result.normalized, null);
});

test('formats phone numbers for display using metadata', () => {
  assert.equal(formatPhoneForDisplay('+4791234567'), '+47 91 23 45 67');
  assert.equal(formatPhoneForDisplay('+3546123456'), '+354 612 3456');
});

test('parses phone input for the UI country selector', () => {
  assert.deepEqual(parsePhoneInput('+354 612 3456', 'FR'), {
    country: 'IS',
    displayValue: '+354 612 3456',
    nationalNumber: '6123456',
    normalized: '+3546123456',
  });
});
