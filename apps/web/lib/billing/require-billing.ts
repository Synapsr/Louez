import { notFound } from "next/navigation";

import { isBillingEnabled } from "./mode";

/** For a page that exists only for platform billing: 404 when LOUEZ_BILLING is off. */
export function requirePlatformBilling(): void {
  if (!isBillingEnabled()) notFound();
}
