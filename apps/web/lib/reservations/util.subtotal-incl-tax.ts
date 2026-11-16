/**
 * The reservation's subtotal tax included, when the subtotal it stores is
 * one: the lines and the insurance of a reservation whose prices are given
 * with tax. With prices given before tax, the stored subtotal is before tax,
 * and has no figure of its own to show as tax included; a reservation that
 * recorded no mode does not say which it is (slice 9's facts).
 */
export const subtotalInclTaxOf = (reservation: {
  subtotalAmount: string;
  taxDisplayMode?: "inclusive" | "exclusive" | null;
}): number | null =>
  reservation.taxDisplayMode === "inclusive" ? parseFloat(reservation.subtotalAmount) : null;
