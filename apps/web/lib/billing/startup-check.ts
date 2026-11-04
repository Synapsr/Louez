import { env } from '@/env';
import { isBillingSyncEnabled, readBillingSyncConfig } from '@/lib/billing-sync/config';
import { isStandaloneMode } from '@/lib/deployment';
import { log } from '@/lib/evlog';
import { describeHostingMisconfiguration } from '@/lib/hosting';

import { describeBillingMisconfiguration, getRawBillingSetting } from './mode';

type StartupLogger = { error(tag: string, message: string): void };

/** Server-start check: log, without stopping, when billing looks off by mistake. */
export function reportBillingModeAtStartup(): void {
  const warning = describeBillingMisconfiguration({
    louezBilling: getRawBillingSetting(),
    platformMode: !isStandaloneMode(),
    stripePriceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY,
  });
  if (warning) log.error('billing', warning);
}

/**
 * Server-start check of the hosting identity (louez-billing docs/plans/design.md §7.1).
 * With LOUEZ_BILLING=cloud and no LOUEZ_HOSTED_BY=lumycloud it logs why and returns
 * false, and the caller stops the server, so Louez Cloud cannot go live without the
 * hosting line of its legal notices. Elsewhere an unknown value is only logged.
 */
export function checkHostingAtStartup(
  logger: StartupLogger = log,
  input: { louezBilling: string | undefined; louezHostedBy: string | undefined } = {
    louezBilling: getRawBillingSetting(),
    louezHostedBy: process.env.LOUEZ_HOSTED_BY || undefined,
  },
): boolean {
  const problem = describeHostingMisconfiguration(input);
  if (!problem) return true;
  logger.error('billing', problem.message);
  return !problem.stop;
}

/**
 * Server-start check of the billing service variables (louez-billing docs/api, README
 * §12). In service mode (LOUEZ_BILLING=cloud with BILLING_SERVICE_URL) it logs every
 * problem and returns false, and the caller stops the server. Outside service mode the
 * variables are ignored and it returns true.
 */
export function checkBillingSyncConfigAtStartup(logger: StartupLogger = log): boolean {
  if (!isBillingSyncEnabled()) return true;
  const result = readBillingSyncConfig();
  if (result.ok) return true;
  for (const error of result.errors) logger.error('billing', `billing service config: ${error}`);
  logger.error('billing', 'billing service config is invalid, stopping');
  return false;
}
