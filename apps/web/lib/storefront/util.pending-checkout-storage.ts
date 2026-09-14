/**
 * Remembers, in the browser, the pending reservation a checkout just sent to
 * Stripe. When the customer backs out and submits again, the id travels with
 * the payload so the server reuses that reservation (unchanged cart) or
 * replaces it (changed cart) instead of piling up pending bookings. The
 * server validates everything; this is a hint, never a credential.
 */

const STORAGE_KEY = "louez:checkout:pending-reservation";

interface PendingCheckoutRecord {
  storeId: string;
  reservationId: string;
}

const getStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is PendingCheckoutRecord =>
  typeof value === "object" &&
  value !== null &&
  "storeId" in value &&
  typeof value.storeId === "string" &&
  "reservationId" in value &&
  typeof value.reservationId === "string";

export const readPendingCheckout = (storeId: string): string | undefined => {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && parsed.storeId === storeId ? parsed.reservationId : undefined;
  } catch {
    return undefined;
  }
};

export const writePendingCheckout = (record: PendingCheckoutRecord): void => {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked: the expiry webhook still cleans up server-side.
  }
};

export const clearPendingCheckout = (): void => {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
};
