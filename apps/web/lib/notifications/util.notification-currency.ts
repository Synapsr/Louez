import type { NotificationContext } from "./dispatcher";

/**
 * The currency of the reservation's amounts: the one frozen on the reservation,
 * else (rows from before it existed) the store's.
 */
export const reservationCurrencyOf = (ctx: NotificationContext): string | undefined =>
  ctx.reservation?.currency || ctx.store.settings?.currency || undefined;

/** The currency the payment was made in, else the reservation's. */
export const paymentCurrencyOf = (ctx: NotificationContext): string | undefined =>
  ctx.payment?.currency || reservationCurrencyOf(ctx);
