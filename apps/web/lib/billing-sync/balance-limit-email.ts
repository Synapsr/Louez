import { eq } from "drizzle-orm";

import { db, stores, users } from "@louez/db";

import { env } from "@/env";
import { formatMinor } from "@/lib/billing/billing-format";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";
import type { BalanceLimitCrossing } from "@/lib/billing-sync/balance-limit-crossings";
import { getBillingOverview } from "@/lib/billing-sync/pages";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendBalanceLimitEmail } from "@/lib/email/send";
import { log } from "@/lib/evlog";

// The balance limit's email (louez-billing docs/api, README §8.8): the owner of a
// store that crossed into a balance notice (balance-limit-crossings.ts) gets one
// email, with the balance and the limit the overview gives at send time. A send that
// fails is logged and never retried, so no version can send twice.

/** Emails one store's owner the balance and the limit the overview gives now. */
async function notifyCrossing(
  { storeId, version }: BalanceLimitCrossing,
  send: typeof sendBalanceLimitEmail,
): Promise<void> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true, userId: true, email: true, settings: true, theme: true },
  });
  if (!store) {
    log.warn("billing", `balance limit email: store ${storeId} v${version} does not exist`);
    return;
  }
  const owner = await db.query.users.findFirst({
    where: eq(users.id, store.userId),
    columns: { email: true },
  });
  const to = owner?.email ?? store.email;
  if (!to) {
    log.warn("billing", `balance limit email: store ${storeId} v${version} has no address`);
    return;
  }
  const locale = getLocaleFromCountry(store.settings?.country);
  const overview = await getBillingOverview(storeId, locale);
  if (!overview.ok || !overview.value.balance) {
    log.error(
      "billing",
      `balance limit email: no balance for store ${storeId} v${version} (${overview.ok ? "none in the overview" : overview.reason}); not sent`,
    );
    return;
  }
  const { currency, amountMinor, limitMinor, standing } = overview.value.balance;
  // The words follow the overview, as the numbers do: a store back under its limit
  // since the version was issued, by a card or a payment, is told nothing.
  if (standing === "ok") {
    log.info(
      "billing",
      `balance limit email: store ${storeId} v${version} is back under its limit`,
    );
    return;
  }
  await send({
    variant: standing,
    to,
    storeId,
    storeName: store.name,
    primaryColor: store.theme?.primaryColor ?? undefined,
    balance: formatMinor(amountMinor, currency, locale),
    limit: limitMinor === null ? null : formatMinor(limitMinor, currency, locale),
    ctaUrl: `${env.NEXT_PUBLIC_APP_URL}${BILLING_SETTINGS_PATH}`,
    locale,
  });
  log.info("billing", `balance limit email (${standing}) sent for store ${storeId} v${version}`);
}

/**
 * Emails the owner of each store that crossed into a balance notice, one store after
 * the other. A failure is logged for that store and never thrown: the pull that cached
 * the versions has already committed.
 */
export async function notifyBalanceLimitCrossings(
  crossings: readonly BalanceLimitCrossing[],
  send: typeof sendBalanceLimitEmail = sendBalanceLimitEmail,
): Promise<void> {
  for (const crossing of crossings) {
    try {
      await notifyCrossing(crossing, send);
    } catch (error) {
      log.error(
        "billing",
        `balance limit email for store ${crossing.storeId} v${crossing.version} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
