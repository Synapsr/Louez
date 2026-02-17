import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { env } from '@/env'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'

function getEncryptionKey(): Buffer {
  const secret = env.TULIP_ENCRYPTION_KEY
  if (!secret) {
    throw new Error('errors.tulipEncryptionKeyMissing')
  }

  // Normalize variable-length secret to 32 bytes for AES-256.
  return createHash('sha256').update(secret).digest()
}

export function encryptTulipApiKey(apiKey: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptTulipApiKey(payload: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(':')
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('errors.tulipEncryptedPayloadInvalid')
  }

  const key = getEncryptionKey()
  const iv = Buffer.from(ivRaw, 'base64url')
  const tag = Buffer.from(tagRaw, 'base64url')
  const encrypted = Buffer.from(encryptedRaw, 'base64url')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}
