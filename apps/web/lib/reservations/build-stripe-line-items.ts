export interface StripeLineItem {
  name: string;
  description?: string;
  quantity: number;
  unitAmount: number;
}

export interface StripeTaxLine {
  amountInclTax: number;
}

export interface StripeLineItemSource {
  name: string;
  quantity: number;
  /** Server-priced line subtotal (gross of the promo discount). */
  subtotal: number;
  /** Tax engine line: net of the allocated discount, tax included. */
  taxLine: StripeTaxLine | undefined;
}

export interface BuildStripeLineItemsInput {
  reservationNumber: string;
  isPartialPayment: boolean;
  depositPercentage: number;
  /** Amount actually charged now (already floored/capped). */
  finalChargeAmount: number;
  displayMode: "inclusive" | "exclusive";
  /** Promo discount already allocated by the tax engine to the tax lines. */
  discountAmount: number;
  items: StripeLineItemSource[];
  insuranceAmount: number;
  insuranceTaxLine: StripeTaxLine | undefined;
  deliveryFee: number;
  deliveryTaxLine: StripeTaxLine | undefined;
  /** Currency-aware conversion to Stripe minor units. */
  toCents: (amount: number) => number;
}

export const INSURANCE_LINE_NAME = "Garantie casse/vol";
export const DELIVERY_LINE_NAME = "Livraison";

/**
 * Stripe Checkout line items. Stripe charges the sum of the lines, so they
 * must always add up to `finalChargeAmount`:
 * - partial payment: one deposit line for the charged amount;
 * - HT display, or TTC display with a promo: one line per tax-engine line,
 *   each net of its allocated discount (the engine's total is the charge);
 * - TTC display without a promo: one line per product at the per-unit price,
 *   plus insurance and delivery as-is, so the customer sees quantities.
 */
export const buildStripeLineItems = ({
  reservationNumber,
  isPartialPayment,
  depositPercentage,
  finalChargeAmount,
  displayMode,
  discountAmount,
  items,
  insuranceAmount,
  insuranceTaxLine,
  deliveryFee,
  deliveryTaxLine,
  toCents,
}: BuildStripeLineItemsInput): StripeLineItem[] => {
  if (isPartialPayment) {
    return [
      {
        name: `Acompte (${depositPercentage}%)`,
        description: `Acompte pour la réservation ${reservationNumber}`,
        quantity: 1,
        unitAmount: toCents(finalChargeAmount),
      },
    ];
  }

  // The tax engine is the only source that has the promo discount allocated
  // per line; gross per-unit prices would overcharge by the discount.
  if (displayMode === "exclusive" || discountAmount > 0) {
    return [
      ...items.flatMap((item) =>
        item.taxLine && item.taxLine.amountInclTax > 0
          ? [
              {
                name: item.name,
                description: item.quantity > 1 ? `${item.quantity} × ${item.name}` : undefined,
                quantity: 1,
                unitAmount: toCents(item.taxLine.amountInclTax),
              },
            ]
          : [],
      ),
      ...(insuranceTaxLine && insuranceTaxLine.amountInclTax > 0
        ? [
            {
              name: INSURANCE_LINE_NAME,
              description: `${INSURANCE_LINE_NAME} - réservation ${reservationNumber}`,
              quantity: 1,
              unitAmount: toCents(insuranceTaxLine.amountInclTax),
            },
          ]
        : []),
      ...(deliveryTaxLine && deliveryTaxLine.amountInclTax > 0
        ? [
            {
              name: DELIVERY_LINE_NAME,
              quantity: 1,
              unitAmount: toCents(deliveryTaxLine.amountInclTax),
            },
          ]
        : []),
    ];
  }

  return [
    ...items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitAmount: toCents(item.subtotal / item.quantity),
    })),
    ...(insuranceAmount > 0
      ? [
          {
            name: INSURANCE_LINE_NAME,
            description: `${INSURANCE_LINE_NAME} - réservation ${reservationNumber}`,
            quantity: 1,
            unitAmount: toCents(insuranceAmount),
          },
        ]
      : []),
    ...(deliveryFee > 0
      ? [{ name: DELIVERY_LINE_NAME, quantity: 1, unitAmount: toCents(deliveryFee) }]
      : []),
  ];
};

/** Sum of the line items in minor units, for parity checks against the charge. */
export const sumStripeLineItems = (lineItems: StripeLineItem[]): number =>
  lineItems.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);

/**
 * Amount charged now: the full total, or `depositPercentage` of it for a
 * partial payment, floored at Stripe's minimum and never above the total.
 */
export const getCheckoutChargeAmount = ({
  total,
  depositPercentage,
}: {
  total: number;
  depositPercentage: number;
}): { isPartialPayment: boolean; finalChargeAmount: number } => {
  const isPartialPayment = depositPercentage < 100;
  const amountToCharge = isPartialPayment ? Math.round(total * depositPercentage) / 100 : total;
  const MINIMUM_STRIPE_AMOUNT = 0.5;
  const effectiveChargeAmount = Math.max(amountToCharge, MINIMUM_STRIPE_AMOUNT);
  return { isPartialPayment, finalChargeAmount: Math.min(effectiveChargeAmount, total) };
};
