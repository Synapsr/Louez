import { authClient } from "@louez/auth/client";
import { rememberPasskey } from "@/components/auth/util.passkey-preferences";
import { createAuthMutationError, getAuthErrorCode } from "@/lib/utils/util.auth-error";

const assertSuccess = (result: { data?: unknown; error?: unknown }): void => {
  if (result.error || !result.data) {
    throw createAuthMutationError(getAuthErrorCode(result.error));
  }
};

export const passkeyMutations = {
  register: () => ({
    mutationFn: async () => {
      // Let the browser choose its passkey provider; the account email labels the credential.
      const result = await authClient.passkey.addPasskey();
      assertSuccess(result);
      rememberPasskey(true);
    },
  }),
  signIn: () => ({
    mutationFn: async () => {
      const result = await authClient.signIn.passkey();
      if (getAuthErrorCode(result.error) === "PASSKEY_NOT_FOUND") rememberPasskey(false);
      assertSuccess(result);
      rememberPasskey(true);
    },
  }),
  remove: () => ({
    mutationFn: async (id: string) => {
      assertSuccess(await authClient.passkey.deletePasskey({ id }));
    },
  }),
  reauthenticate: () => ({
    mutationFn: async () => {
      assertSuccess(await authClient.signOut());
      window.location.assign("/login?callbackUrl=%2Fdashboard%2Faccount");
    },
  }),
};
