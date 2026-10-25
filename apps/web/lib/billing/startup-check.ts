import { env } from '@/env';
import { isBillingSyncEnabled, readBillingSyncConfig } from '@/lib/billing-sync/config';
import { isStandaloneMode } from '@/lib/deployment';
import { log } from '@/lib/evlog';

import { describeBillingMisconfiguration, getRawBillingSetting } from './mode';

/** Server-start check: log, without stopping, when billing is off by mistake. */
export function reportBillingModeAtStartup(): void {
  const warning = describeBillingMisconfiguration({
    louezBilling: getRawBillingSetting(),
    platformMode: !isStandaloneMode(),
    stripePriceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY,
  });
  if (warning) log.error('billing', warning);
}

/**
 * Server-start check of the billing service variables (louez-billing docs/api, README
 * §12). In service mode (LOUEZ_BILLING=cloud with BILLING_SERVICE_URL) it logs every
 * problem and returns false, and the caller stops the server. Outside service mode the
 * variables are ignored and it returns true.
 */
export function checkBillingSyncConfigAtStartup(
  logger: { error(tag: string, message: string): void } = log,
): boolean {
  if (!isBillingSyncEnabled()) return true;
  const result = readBillingSyncConfig();
  if (result.ok) return true;
  for (const error of result.errors) logger.error('billing', `billing service config: ${error}`);
  logger.error('billing', 'billing service config is invalid, stopping');
  return false;
}
