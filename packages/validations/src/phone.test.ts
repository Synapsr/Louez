import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPossibleE164PhoneNumber, isPossiblePhoneNumberInput } from './phone';

test('validates E.164 phone numbers with libphonenumber metadata', () => {
  assert.equal(isPossibleE164PhoneNumber('+4791234567'), true);
  assert.equal(isPossibleE164PhoneNumber('+3546123456'), true);
  assert.equal(isPossibleE164PhoneNumber('+4712'), false);
});

test('validates national phone input with default country context', () => {
  assert.equal(isPossiblePhoneNumberInput('06 12 34 56 78'), true);
  assert.equal(isPossiblePhoneNumberInput('91 23 45 67', 'NO'), true);
  assert.equal(isPossiblePhoneNumberInput('12', 'NO'), false);
});
