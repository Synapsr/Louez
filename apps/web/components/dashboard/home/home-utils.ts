import type { HomeReservation } from "./home-types";

/**
 * Revenue growth in percent, or `null` when there is nothing to compare to: a
 * first month with sales is not "+100 %", it has no trend yet.
 */
export const calculateGrowth = (current: number, previous: number): number | null => {
  if (previous === 0) return null;

  return Math.round(((current - previous) / previous) * 100);
};

/** Two-letter avatar initials for a reservation's customer. */
export const getCustomerInitials = ({ customer }: HomeReservation): string =>
  `${customer.firstName.charAt(0)}${customer.lastName.charAt(0)}`.toUpperCase();

const MAX_LISTED_PRODUCTS = 2;

/** First product names of a reservation plus how many are left out. */
export const summarizeProducts = ({ items }: HomeReservation) => {
  const names = items
    .map((item) => item.product?.name)
    .filter((name): name is string => Boolean(name));

  return {
    names: names.slice(0, MAX_LISTED_PRODUCTS),
    remainingCount: Math.max(0, items.length - MAX_LISTED_PRODUCTS),
  };
};
