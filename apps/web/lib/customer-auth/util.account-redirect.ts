/**
 * Pure helpers for the two redirect parameters of the customer auth flow:
 * `/account/login?redirect=` and `/r/{id}?redirect=`. Both are attacker
 * controllable (they travel in emails and query strings), so each one is
 * reduced to a short whitelist before it reaches `redirect()`.
 */

export const ACCOUNT_PATH = "/account";

export const RESERVATION_OUTCOME_EVENTS = [
  "paid",
  "requested",
  "payment_received",
  "deposit_authorized",
] as const;

export type ReservationOutcomeEvent = (typeof RESERVATION_OUTCOME_EVENTS)[number];

export const isReservationOutcomeEvent = (value: unknown): value is ReservationOutcomeEvent =>
  typeof value === "string" && RESERVATION_OUTCOME_EVENTS.some((event) => event === value);

/** The `?event=` of a URL, or null when absent or unknown. */
export const parseReservationOutcomeEvent = (
  value: string | string[] | null | undefined,
): ReservationOutcomeEvent | null => {
  const single = Array.isArray(value) ? value[0] : value;
  return isReservationOutcomeEvent(single) ? single : null;
};

/**
 * Login accepts store-relative account paths and the checkout.
 * Other destinations fall back to `/account`.
 */
export const getSafeAccountRedirect = (value: string | string[] | null | undefined): string => {
  const single = Array.isArray(value) ? value[0] : value;
  if (!single) return ACCOUNT_PATH;
  if (single === "/checkout") return single;

  const isAccountPath =
    single === ACCOUNT_PATH ||
    single.startsWith(`${ACCOUNT_PATH}/`) ||
    single.startsWith(`${ACCOUNT_PATH}?`);
  const isStoreRelative =
    single.startsWith("/") && !single.startsWith("//") && !single.includes("\\");

  return isAccountPath && isStoreRelative ? single : ACCOUNT_PATH;
};

/**
 * `/r/{id}?redirect=`: the reservation page, its contract, or the
 * reservation page with one known `?event=`. Everything else falls back to
 * the reservation page.
 */
export const getInstantAccessRedirectPath = (
  value: string | null | undefined,
  reservationId: string,
): string => {
  const reservationPath = `${ACCOUNT_PATH}/reservations/${reservationId}`;
  if (!value) return reservationPath;

  if (value === reservationPath || value === `${reservationPath}/contract`) {
    return value;
  }

  if (value.startsWith(`${reservationPath}?`)) {
    const params = new URLSearchParams(value.slice(reservationPath.length + 1));
    const event = params.get("event");
    if (isReservationOutcomeEvent(event) && [...params.keys()].every((key) => key === "event")) {
      return `${reservationPath}?event=${event}`;
    }
  }

  return reservationPath;
};

export const LOGIN_ERROR_CODES = [
  "invalidToken",
  "reservationNotFound",
  "storeNotFound",
  "customerNotFound",
  "verificationError",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export const parseLoginErrorCode = (
  value: string | string[] | null | undefined,
): LoginErrorCode | null => {
  const single = Array.isArray(value) ? value[0] : value;
  return LOGIN_ERROR_CODES.find((code) => code === single) ?? null;
};

/** `/account/login` with its optional `redirect` and `error` parameters. */
export const buildLoginPath = ({
  redirect,
  error,
}: {
  redirect?: string | null;
  error?: LoginErrorCode | null;
}): string => {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (redirect && redirect !== ACCOUNT_PATH) params.set("redirect", redirect);
  const query = params.toString();
  return query ? `${ACCOUNT_PATH}/login?${query}` : `${ACCOUNT_PATH}/login`;
};
