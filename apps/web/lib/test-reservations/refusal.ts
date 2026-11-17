/**
 * The translated refusal of a provider call on a test reservation (packages/db
 * test-reservations.ts, `refuseOnTestReservation`): nothing is charged, held,
 * refunded or insured for it. Manual records (cash, transfer) stay allowed.
 */
export const TEST_RESERVATION_REFUSED_ERROR = "errors.testReservationRefused" as const;
