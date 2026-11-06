/**
 * Sign-in methods available on this instance, computed server-side from the
 * deployment mode and configured integrations (see lib/deployment.ts):
 * - password: `primary` on standalone instances, so the first owner needs no
 *   external service to create an account; `secondary` on the platform, where
 *   an account is created by e-mail code or Google and a password is an
 *   optional extra — reachable from the e-mail step, never a way to sign up
 * - emailOtp: requires an SMTP transport
 * - google: requires Google OAuth credentials
 */
export interface SignInMethods {
  password: 'primary' | 'secondary' | false;
  emailOtp: boolean;
  google: boolean;
}

interface InstanceCapabilities {
  standalone: boolean;
  emailConfigured: boolean;
  googleAuthConfigured: boolean;
}

export const resolveSignInMethods = ({
  standalone,
  emailConfigured,
  googleAuthConfigured,
}: InstanceCapabilities): SignInMethods => ({
  password: standalone ? 'primary' : 'secondary',
  emailOtp: emailConfigured,
  google: googleAuthConfigured,
});
