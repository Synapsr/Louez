import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // Better Auth resolves relative requests against the browser's current
  // origin. Keeping this same-origin avoids baking a deployment URL into the
  // client bundle of the published Docker image.
  plugins: [magicLinkClient(), emailOTPClient(), passkeyClient()],
});
