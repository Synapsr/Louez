/**
 * Remembers, in the browser, the reservation a checkout just made, one record
 * per store (stores can share an origin). Two uses:
 *
 * - The resume hint: when the customer backs out of Stripe and submits again,
 *   the id travels with the payload so the server reuses that reservation
 *   (unchanged cart) or replaces it (changed cart) instead of piling up
 *   pending bookings. Only a payment checkout's record is one: a request is
 *   never resumed. The server validates everything; this is a hint, never a
 *   credential.
 * - The proof that THIS browser started THAT checkout: a confirmation page
 *   empties the cart only when it holds it, and consumes it, so a link to
 *   someone else's checkout, or an old confirmation opened again, leaves the
 *   cart alone.
 */

const STORAGE_PREFIX = "louez:checkout:pending-reservation";
/** The one record every store shared before records were per store. */
const LEGACY_STORAGE_KEY = STORAGE_PREFIX;

const storageKey = (storeId: string): string => `${STORAGE_PREFIX}:${storeId}`;

interface PendingCheckoutRecord {
  reservationId: string;
  resumable: boolean;
}

const getStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const parse = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readStoreRecord = (storage: Storage, storeId: string): PendingCheckoutRecord | null => {
  const parsed = parse(storage.getItem(storageKey(storeId)));
  return typeof parsed === "object" &&
    parsed !== null &&
    "reservationId" in parsed &&
    typeof parsed.reservationId === "string" &&
    "resumable" in parsed &&
    typeof parsed.resumable === "boolean"
    ? { reservationId: parsed.reservationId, resumable: parsed.resumable }
    : null;
};

/** The legacy record, when it names this store: only payment checkouts wrote one. */
const readLegacyRecord = (storage: Storage, storeId: string): PendingCheckoutRecord | null => {
  const parsed = parse(storage.getItem(LEGACY_STORAGE_KEY));
  return typeof parsed === "object" &&
    parsed !== null &&
    "storeId" in parsed &&
    parsed.storeId === storeId &&
    "reservationId" in parsed &&
    typeof parsed.reservationId === "string"
    ? { reservationId: parsed.reservationId, resumable: true }
    : null;
};

const readRecord = (storage: Storage, storeId: string): PendingCheckoutRecord | null =>
  readStoreRecord(storage, storeId) ?? readLegacyRecord(storage, storeId);

const forget = (storage: Storage, storeId: string): void => {
  storage.removeItem(storageKey(storeId));
  if (readLegacyRecord(storage, storeId)) storage.removeItem(LEGACY_STORAGE_KEY);
};

/** The reservation a new checkout of this store may resume, if any. */
export const readPendingCheckout = (storeId: string): string | undefined => {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const record = readRecord(storage, storeId);
    return record?.resumable ? record.reservationId : undefined;
  } catch {
    return undefined;
  }
};

export const writePendingCheckout = ({
  storeId,
  reservationId,
  resumable,
}: { storeId: string } & PendingCheckoutRecord): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    forget(storage, storeId);
    storage.setItem(storageKey(storeId), JSON.stringify({ reservationId, resumable }));
  } catch {
    // Storage full or blocked: the expiry webhook still cleans up server-side,
    // and the confirmation leaves the cart as it is.
  }
};

/**
 * Whether this browser started the checkout of `reservationId` at this store;
 * true once only, since the record is then forgotten.
 */
export const consumeStartedCheckout = (storeId: string, reservationId: string): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    if (readRecord(storage, storeId)?.reservationId !== reservationId) return false;
    forget(storage, storeId);
    return true;
  } catch {
    return false;
  }
};
