/**
 * Sign-in methods available on this instance, computed server-side from the
 * deployment mode and configured integrations (see lib/deployment.ts):
 * - password: standalone instances, so the first owner needs no external
 *   service to create an account
 * - emailOtp: requires an SMTP transport
 * - google: requires Google OAuth credentials
 */
export interface SignInMethods {
  password: boolean;
  emailOtp: boolean;
  google: boolean;
}
