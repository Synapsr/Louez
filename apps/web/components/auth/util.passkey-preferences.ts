const PREFERRED_KEY = "louez:passkey-preferred:v1";
// v1 recorded an appearance, not a dismissal. Do not let that passive marker
// suppress the new non-modal invitation when the user never chose “Later”.
const PROMPT_PREFIX = "louez:passkey-prompt:v2:";
const DISMISSAL_MS = 30 * 24 * 60 * 60 * 1000;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStorage = (): PreferenceStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** A UI hint only: no email, credential identifier, or authorization lives here. */
export const prefersPasskey = (storage = browserStorage()): boolean => {
  try {
    return storage?.getItem(PREFERRED_KEY) === "1";
  } catch {
    return false;
  }
};

export const rememberPasskey = (enabled: boolean, storage = browserStorage()): void => {
  try {
    if (enabled) storage?.setItem(PREFERRED_KEY, "1");
    else storage?.removeItem(PREFERRED_KEY);
  } catch {
    // A blocked preference must never prevent signing in.
  }
};

export const canPromptPasskey = (
  userId: string,
  storage = browserStorage(),
  now = Date.now(),
): boolean => {
  try {
    // Without persistent storage, keep the automatic invitation unobtrusive.
    if (!storage) return false;
    const value = storage.getItem(`${PROMPT_PREFIX}${userId}`);
    if (!value) return true;
    const dismissedAt = Number(value);
    return Number.isFinite(dismissedAt) && now - dismissedAt >= DISMISSAL_MS;
  } catch {
    return false;
  }
};

export const dismissPasskeyPrompt = (
  userId: string,
  storage = browserStorage(),
  now = Date.now(),
): void => {
  try {
    storage?.setItem(`${PROMPT_PREFIX}${userId}`, String(now));
  } catch {
    // Enrollment remains available from account settings.
  }
};
