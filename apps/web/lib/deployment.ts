import { isEmailConfigured } from '@louez/email'

/**
 * Deployment mode of this Louez instance.
 *
 * - `standalone` (the default): a single store served from a single origin.
 *   The storefront lives at the root of the app URL, the dashboard stays
 *   reachable under its path routes (/login, /dashboard, ...), and the
 *   multi-tenant surfaces (extra store creation, subdomain routing) are
 *   disabled.
 * - `platform`: multi-tenant SaaS routing — the dashboard on its own
 *   subdomain and one storefront per store subdomain. Cloud and multi-store
 *   deployments must set LOUEZ_MODE=platform explicitly.
 *
 * Read from process.env at call time — never through the validated env
 * schema — so the prebuilt Docker image honors the value at runtime and the
 * proxy middleware can read it without pulling in server-only modules.
 */
export function isStandaloneMode(): boolean {
  return process.env.LOUEZ_MODE !== 'platform'
}

/** Whether Google OAuth sign-in is available on this instance. */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)
}

/**
 * Instance capabilities exposed to client components through the
 * InstanceProvider mounted in the root layout.
 */
export function getInstanceConfig() {
  return {
    standalone: isStandaloneMode(),
    emailConfigured: isEmailConfigured(),
    googleAuthConfigured: isGoogleAuthConfigured(),
  }
}
