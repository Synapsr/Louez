/**
 * The checkout's side of a test reservation (packages/db test-reservations.ts).
 */

/** A second test reservation in the store: the dashboard deletes the first. */
export const TEST_RESERVATION_EXISTS_ERROR = "errors.testReservationExists";

/** The storefront page that simulates a test reservation's payment, store-relative. */
export const testPaymentPath = (reservationId: string): string =>
  `/checkout/test-payment?reservation=${encodeURIComponent(reservationId)}`;

/**
 * Whether the error is the duplicate key of `reservations_one_test_per_store`: two
 * test checkouts of a store raced, and this one lost. Reads the driver's error
 * through the ORM's causes.
 */
export function isTestReservationConflict(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && depth < 5; depth++) {
    if (cause instanceof Error) {
      const code = Reflect.get(cause, "code");
      if (code === "ER_DUP_ENTRY" && cause.message.includes("reservations_one_test_per_store")) {
        return true;
      }
      cause = cause.cause;
    } else {
      return false;
    }
  }
  return false;
}
