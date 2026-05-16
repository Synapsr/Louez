import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '@/env';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;

function getIntegrationEncryptionKey(): Buffer {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is required for integration credentials',
    );
  }

  return Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64url');
}

export function encryptIntegrationSecret(value: string): {
  encrypted: string;
  keyVersion: number;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getIntegrationEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: [
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.'),
    keyVersion: KEY_VERSION,
  };
}

export function decryptIntegrationSecret(encryptedValue: string): string {
  const [ivValue, authTagValue, ciphertextValue] = encryptedValue.split('.');
  if (!ivValue || !authTagValue || !ciphertextValue) {
    throw new Error('Invalid encrypted integration secret format');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getIntegrationEncryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
