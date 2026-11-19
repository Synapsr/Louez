import { minutesToPriceDuration } from "@louez/utils";

/**
 * schema.org `Offer`s for a rented product: one per rate of its grid ("25 €
 * per day", "120 € per week"), each saying it is a rental (GoodRelations
 * `LeaseOut`) and which period its price covers. Pure, so the shape is
 * tested without a request.
 */

/** A rate as the storefront prints it; `periodMinutes` null for a forfait (per booking). */
export interface RentalRate {
  price: number;
  periodMinutes: number | null;
}

export interface RentalOffersInput {
  /** The product page, canonical. */
  url: string;
  /** ISO 4217. */
  currency: string;
  /** Never empty. */
  rates: readonly RentalRate[];
  inStock: boolean;
  seller: { name: string; url: string };
  /** `YYYY-MM-DD`; Google drops an offer whose price has expired. */
  priceValidUntil: string;
}

// UN/ECE Recommendation 20 unit codes, the ones schema.org's unitCode expects.
const PERIOD_UNIT_CODES: Record<string, string> = {
  minute: "MIN",
  hour: "HUR",
  day: "DAY",
  week: "WEE",
};

/** The rental period a price covers, as a schema.org quantity; null when it has none. */
export function periodQuantity(
  periodMinutes: number | null,
): { value: number; unitCode: string } | null {
  if (!periodMinutes || periodMinutes <= 0) return null;
  const period = minutesToPriceDuration(periodMinutes);
  const unitCode = PERIOD_UNIT_CODES[period.unit];
  return unitCode ? { value: period.duration, unitCode } : null;
}

/** A rate from a percentage tier is a float (120.00000075): a price is in cents. */
const toCents = (price: number): number => Math.round(price * 100) / 100;

const offerOf = (input: RentalOffersInput, rate: RentalRate): Record<string, unknown> => {
  const price = toCents(rate.price);
  const offer: Record<string, unknown> = {
    "@type": "Offer",
    url: input.url,
    price,
    priceCurrency: input.currency,
    priceValidUntil: input.priceValidUntil,
    // These items are rented out, not sold: the GoodRelations vocabulary is
    // what schema.org uses to say so.
    businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
    availability: input.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    seller: { "@type": "LocalBusiness", name: input.seller.name, url: input.seller.url },
  };

  const quantity = periodQuantity(rate.periodMinutes);
  if (quantity) {
    // Without this the price reads as a sale price instead of a rate per
    // rental period (1 day, 2 hours, …).
    offer.priceSpecification = {
      "@type": "UnitPriceSpecification",
      price,
      priceCurrency: input.currency,
      unitCode: quantity.unitCode,
      referenceQuantity: {
        "@type": "QuantitativeValue",
        value: quantity.value,
        unitCode: quantity.unitCode,
      },
    };
  }

  return offer;
};

/** One `Offer`, or a list when the grid holds several rates. */
export function buildRentalOffers(
  input: RentalOffersInput,
): Record<string, unknown> | Record<string, unknown>[] {
  const offers = input.rates.map((rate) => offerOf(input, rate));
  return offers.length === 1 ? offers[0] : offers;
}
