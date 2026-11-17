/**
 * The outcome a page states as done, if any: the payment recorded, or the
 * request sent.
 */
export type CartResetOutcome = "paid" | "requested" | null;

/**
 * What the reservation page may state as done for the cart: a payment only
 * once it is recorded; a request when the page was reached as its landing.
 * The request's landing is named by the URL, which anyone can write: the
 * reset then asks this browser for its record of a REQUEST of that
 * reservation (`consumeStartedCheckout`), so it never touches the record, or
 * the cart, of a payment checkout left unpaid.
 */
export const cartResetOutcome = (
  event: string | null | undefined,
  paymentStatus: string,
): CartResetOutcome => {
  if (event === "paid") return paymentStatus === "paid" ? "paid" : null;
  return event === "requested" ? "requested" : null;
};
