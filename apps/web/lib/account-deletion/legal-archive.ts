import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ARCHIVE_FORMAT_VERSION = 'v1';
const AES_GCM_IV_BYTES = 12;

const decodeEncryptionKey = (encodedKey: string): Buffer => {
  const key = Buffer.from(encodedKey, 'base64url');
  if (key.length !== 32) {
    throw new Error('Legal archive encryption key must contain 32 bytes');
  }
  return key;
};

export const encryptLegalArchivePayload = (payload: unknown, encodedKey: string): string => {
  const key = decodeEncryptionKey(encodedKey);
  const initializationVector = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return [
    ARCHIVE_FORMAT_VERSION,
    initializationVector.toString('base64url'),
    authenticationTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

export const decryptLegalArchivePayload = (
  encryptedPayload: string,
  encodedKey: string,
): unknown => {
  const [version, encodedIv, encodedTag, encodedCiphertext] = encryptedPayload.split('.');
  if (version !== ARCHIVE_FORMAT_VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Unsupported legal archive payload');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeEncryptionKey(encodedKey),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
};

export const getLegalRetentionDate = (
  issueDate: string,
  fiscalYearEnd = '12-31',
): string => {
  const [yearText, monthText, dayText] = issueDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error('Invalid legal record issue date');
  }

  const [fiscalMonthText, fiscalDayText] = fiscalYearEnd.split('-');
  const fiscalMonth = Number(fiscalMonthText);
  const fiscalDay = Number(fiscalDayText);
  if (
    !Number.isInteger(fiscalMonth) ||
    !Number.isInteger(fiscalDay) ||
    fiscalMonth < 1 ||
    fiscalMonth > 12 ||
    fiscalDay < 1 ||
    fiscalDay > new Date(Date.UTC(2000, fiscalMonth, 0)).getUTCDate()
  ) {
    throw new Error('Invalid legal archive fiscal year end');
  }

  const closesInIssueYear =
    month < fiscalMonth || (month === fiscalMonth && day <= fiscalDay);
  const closingYear = closesInIssueYear ? year : year + 1;
  const retentionYear = closingYear + 10;
  const lastDayOfMonth = new Date(
    Date.UTC(retentionYear, fiscalMonth, 0),
  ).getUTCDate();
  const retainedDay = Math.min(fiscalDay, lastDayOfMonth);

  return `${retentionYear.toString().padStart(4, '0')}-${fiscalMonth
    .toString()
    .padStart(2, '0')}-${retainedDay.toString().padStart(2, '0')}`;
};
