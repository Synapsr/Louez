import { env } from '@/env';
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
