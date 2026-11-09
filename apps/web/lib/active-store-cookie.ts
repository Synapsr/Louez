/** The dashboard's active store (lib/store-context.ts), as a cookie. */
export const ACTIVE_STORE_COOKIE = "louez_active_store";

/** How the active store cookie is set: by the store switcher, and by the onboarding's store step (lib/stores/new-store-port.ts). */
export const activeStoreCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // Keep using NODE_ENV as specified
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 365, // 1 year
  path: "/",
} as const;
