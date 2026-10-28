import { env } from '@/env';
import { readHandoffSigningKey } from '@/lib/billing/handoff';
import { isBillingSyncEnabled, readBillingSyncConfig } from '@/lib/billing-sync/config';
import { isStandaloneMode } from '@/lib/deployment';
import { log } from '@/lib/evlog';
import { describeHostingMisconfiguration } from '@/lib/hosting';
import { parsePayAsYouGoConfig } from '@/lib/pay-as-you-go/config';

import { describeBillingMisconfiguration, getRawBillingSetting, isBillingEnabled } from './mode';

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
 * Server-start check of the offer for new stores. With LOUEZ_BILLING=cloud, a set but
 * malformed PAYG_DEFAULT_PRICING is logged and the start is refused: new stores would
 * otherwise get the built-in ladder. A self-hosted instance never reads it.
 */
export function checkPayAsYouGoOfferAtStartup(
  logger: StartupLogger = log,
  rawPricing: string | undefined = env.PAYG_DEFAULT_PRICING,
): boolean {
  if (!isBillingEnabled() || !rawPricing?.trim()) return true;
  if (parsePayAsYouGoConfig(rawPricing)) return true;
  logger.error(
    'billing',
    'PAYG_DEFAULT_PRICING is not a valid pay-as-you-go config (JSON with flatRateCents or tiers), stopping',
  );
  return false;
}

/**
 * Server-start check of the billing service variables (louez-billing docs/api, README
 * §12), the hand-off's signing key included from M2. In service mode (LOUEZ_BILLING=cloud
 * with BILLING_SERVICE_URL) it logs every problem and returns false, and the caller
 * stops the server. Outside service mode the variables are ignored and it returns true.
 */
export function checkBillingSyncConfigAtStartup(logger: StartupLogger = log): boolean {
  if (!isBillingSyncEnabled()) return true;
  const errors = [readBillingSyncConfig(), readHandoffSigningKey()].flatMap((result) =>
    result.ok ? [] : result.errors,
  );
  if (errors.length === 0) return true;
  for (const error of errors) logger.error('billing', `billing service config: ${error}`);
  logger.error('billing', 'billing service config is invalid, stopping');
  return false;
}
