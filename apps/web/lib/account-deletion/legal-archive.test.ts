import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decryptLegalArchivePayload,
  encryptLegalArchivePayload,
  getLegalRetentionDate,
} from './legal-archive';

const encryptionKey = Buffer.alloc(32, 7).toString('base64url');

test('encrypts legal archive payloads with authenticated encryption', () => {
  const payload = {
    number: 'INV-2026-001',
    totalInclTax: '120.00',
  };

  const encrypted = encryptLegalArchivePayload(payload, encryptionKey);

  assert.notEqual(encrypted, JSON.stringify(payload));
  assert.deepEqual(decryptLegalArchivePayload(encrypted, encryptionKey), payload);
});

test('retains accounting records for ten years after fiscal-year closing', () => {
  assert.equal(getLegalRetentionDate('2026-08-28'), '2036-12-31');
  assert.equal(getLegalRetentionDate('2026-01-15', '03-31'), '2036-03-31');
  assert.equal(getLegalRetentionDate('2026-08-28', '03-31'), '2037-03-31');
});
