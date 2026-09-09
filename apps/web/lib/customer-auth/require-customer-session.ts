import "server-only";

import { getCustomerSession, type CustomerSession } from "@/lib/customer-auth/session";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";
import { storefrontRedirect } from "@/lib/storefront-url";

interface StoreRef {
  id: string;
  slug: string;
}

/**
 * The signed-in customer of the store, or a redirect to the login page that
 * comes back to `redirectPath` once the code is verified.
 */
export const requireCustomerSession = async (
  store: StoreRef,
  redirectPath: string,
): Promise<CustomerSession> => {
  const session = await getCustomerSession(store.id);
  if (session) return session;

  storefrontRedirect(store.slug, buildLoginPath({ redirect: redirectPath }));
};
