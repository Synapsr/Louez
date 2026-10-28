import { Suspense } from "react";

import { isBillingSyncEnabled } from "@louez/db";

import { BillingReturnToast } from "@/components/dashboard/billing-return-toast";

/**
 * Mounts the toast of the return from the billing pages in service mode only, so
 * elsewhere a typed or linked `?billing=` shows nothing (README §12). A server
 * component: the dashboard group's layout renders it after reading the request, so
 * the mode comes from the runtime environment, not the build's.
 */
export function BillingReturnToastSlot() {
  if (!isBillingSyncEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <BillingReturnToast />
    </Suspense>
  );
}
