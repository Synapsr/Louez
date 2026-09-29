import type { SignInMethods } from "./sign-in-methods";

/** The two form-based methods; Google is a button on both steps. */
export type LastSignInMethod = "password" | "emailOtp";

export type InitialLoginStep = "password" | "email";

export const LAST_SIGN_IN_METHOD_STORAGE_KEY = "louez:last-sign-in-method";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

const isLastSignInMethod = (value: unknown): value is LastSignInMethod =>
  value === "password" || value === "emailOtp";

/**
 * `localStorage` is absent during SSR and throws in some private-browsing
 * modes. The remembered method is a comfort, never a requirement: every
 * failure reads as "nothing remembered".
 */
const getBrowserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readLastSignInMethod = (
  storage: ReadableStorage | null = getBrowserStorage(),
): LastSignInMethod | null => {
  try {
    const stored = storage?.getItem(LAST_SIGN_IN_METHOD_STORAGE_KEY);
    return isLastSignInMethod(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const rememberLastSignInMethod = (
  method: LastSignInMethod,
  storage: WritableStorage | null = getBrowserStorage(),
): void => {
  try {
    storage?.setItem(LAST_SIGN_IN_METHOD_STORAGE_KEY, method);
  } catch {
    // Storage full or blocked: the next visit opens the default step.
  }
};

/**
 * Step the login form opens on. The remembered method wins when the instance
 * still offers it; otherwise the instance's primary method does.
 */
export const resolveInitialLoginStep = (
  methods: SignInMethods,
  lastMethod: LastSignInMethod | null,
): InitialLoginStep => {
  if (!methods.password) return "email";
  if (!methods.emailOtp) return "password";
  if (lastMethod === "password") return "password";
  if (lastMethod === "emailOtp") return "email";
  return methods.password === "primary" ? "password" : "email";
};
