/**
 * The sales channel a reservation came through, apart from how it was made
 * (`reservations.source`). Only reeent, the marketplace, is one so far.
 */
export const MARKETPLACE_SALES_CHANNEL = "marketplace";
export type SalesChannel = typeof MARKETPLACE_SALES_CHANNEL;

/**
 * Set by the proxy on a storefront visit with `?channel=marketplace` (reeent's
 * links), cleared by `?channel=direct`. httpOnly: the checkout reads it on the
 * server, so a renter's page cannot set it.
 */
export const SALES_CHANNEL_COOKIE = "louez_channel";

/** The channel the storefront cookie holds; null for any other value. */
export const salesChannelFromCookie = (value: string | undefined): SalesChannel | null =>
  value === MARKETPLACE_SALES_CHANNEL ? MARKETPLACE_SALES_CHANNEL : null;

/**
 * What a reservation's funnel events say of its origin: the `source` column
 * as it is, and the sales channel, named after reeent when it is the marketplace.
 */
export const reservationChannelAnalyticsProperties = ({
  source,
  salesChannel,
}: {
  source: string | null;
  salesChannel: string | null;
}) => ({
  reservation_source: source,
  sales_channel: salesChannel,
  ...(salesChannel === MARKETPLACE_SALES_CHANNEL && { marketplace: "reeent" }),
});
