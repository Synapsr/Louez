/**
 * The origins of the payment rows Louez writes when a session is paid, not when
 * it creates it: a payment request's session and an extension's have no payment
 * row before. Their binding belongs to the money lot; their events keep the
 * store's connected account.
 */
const PAID_SESSION_ORIGINS: ReadonlySet<string> = new Set(["payment_request", "extension"]);

/**
 * Whether a payment row found by a checkout session's id is the one Louez
 * wrote when it created that session, whose account the session is read on.
 */
export const isSessionCreationRow = (row: { readonly origin: string | null }): boolean =>
  row.origin === null || !PAID_SESSION_ORIGINS.has(row.origin);

/**
 * The Stripe account a checkout session is read on, and the one account heard
 * about it, from the session's payment row of the reservation it names, found
 * by its session id: the account that row records, the one Louez created the
 * session on, and no other. A row that records none is read with the store's
 * connected account at the time the event or the return is read.
 */
export const checkoutSessionAccount = <StoreAccount extends string | null>({
  recordedAccountId,
  storeAccountId,
}: {
  readonly recordedAccountId: string | null;
  readonly storeAccountId: StoreAccount;
}): string | StoreAccount => recordedAccountId || storeAccountId;
