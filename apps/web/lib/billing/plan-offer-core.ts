// When a Louez plan would have cost a pay-as-you-go store less than what it paid Louez,
// at the store's own tariff (docs/domain/plan-offer.md). Pure: the facts come from
// plan-offer.ts.

export type PlanOfferPlanSlug = "pro" | "ultra";

/** The month the figures are about: the one running, or the last one closed. */
export type PlanOfferPeriod = "current" | "previous";

/** Who bills the store's pay-as-you-go: Louez's legacy per-reservation fees, or the billing service's commission. */
export type PlanOfferSource = "legacy" | "service";

export type PlanOfferCandidate = {
  readonly slug: PlanOfferPlanSlug;
  /** The plan's monthly price, excluding VAT, in minor units of the store's currency. */
  readonly monthlyPriceMinor: number;
  /** The plan's limits; null for none. */
  readonly limits: {
    readonly products: number | null;
    readonly reservationsPerMonth: number | null;
    readonly customers: number | null;
    readonly collaborators: number | null;
  };
};

export type PlanOfferUsage = {
  readonly products: number;
  readonly reservationsThisMonth: number;
  readonly customers: number;
  readonly collaborators: number;
};

export type PlanOfferPeriodCost = {
  readonly period: PlanOfferPeriod;
  /** `YYYY-MM`. */
  readonly month: string;
  /** What the store paid Louez that month, VAT included, in minor units. */
  readonly paidMinor: number;
  /** The month's reservations, as a plan's monthly limit counts them. */
  readonly reservations: number;
};

export type PlanOfferInput = {
  readonly source: PlanOfferSource;
  readonly currency: string;
  /** The store's country (ISO 3166-1 alpha-2), or null. */
  readonly country: string | null;
  /** The plans the store can buy in its currency. */
  readonly plans: readonly PlanOfferCandidate[];
  /** What the store holds now: its catalogue, customers, team, and the running month's reservations. */
  readonly standing: PlanOfferUsage;
  readonly costs: readonly PlanOfferPeriodCost[];
};

export type PlanOffer = {
  readonly plan: PlanOfferPlanSlug;
  readonly source: PlanOfferSource;
  readonly period: PlanOfferPeriod;
  readonly month: string;
  readonly currency: string;
  readonly paidMinor: number;
  /** The plan's monthly price, excluding VAT. */
  readonly planPriceMinor: number;
  /** The VAT rate the comparison counts, in basis points (2000 = 20 %). */
  readonly vatRateBps: number;
  /** The plan's monthly price with that VAT: what `paidMinor` must exceed. */
  readonly thresholdMinor: number;
  /** `paidMinor − thresholdMinor`, above 0. */
  readonly savingsMinor: number;
};

/**
 * Standard VAT rates of the EU member states, in basis points, as Louez's invoices
 * charge a store there that has no VAT number. Monaco is in the French VAT area.
 * Kept by hand: a rate change is a change here.
 */
export const EU_STANDARD_VAT_BPS: Readonly<Record<string, number>> = {
  AT: 2000,
  BE: 2100,
  BG: 2000,
  CY: 1900,
  CZ: 2100,
  DE: 1900,
  DK: 2500,
  EE: 2400,
  ES: 2100,
  FI: 2550,
  FR: 2000,
  GR: 2400,
  HR: 2500,
  HU: 2700,
  IE: 2300,
  IT: 2200,
  LT: 2100,
  LU: 1700,
  LV: 2100,
  MC: 2000,
  MT: 1800,
  NL: 2100,
  PL: 2300,
  PT: 2300,
  RO: 2100,
  SE: 2500,
  SI: 2200,
  SK: 2300,
};

/** The country Louez's stores are in when they did not say: France, as the dashboard defaults to. */
const DEFAULT_COUNTRY = "FR";

/**
 * The VAT rate the comparison counts for a store's country: the standard rate of an
 * EU member state, 0 elsewhere (Louez charges no VAT outside the EU). A store with no
 * country counts as French.
 */
export function planOfferVatRateBps(country: string | null): number {
  const code = (country?.trim() || DEFAULT_COUNTRY).toUpperCase();
  return EU_STANDARD_VAT_BPS[code] ?? 0;
}

/** `amountMinor × (1 + rate)`, rounded half up to the minor unit. */
export function withVatMinor(amountMinor: number, vatRateBps: number): number {
  return Math.floor((amountMinor * (10_000 + vatRateBps) + 5_000) / 10_000);
}

const within = (current: number, limit: number | null) => limit === null || current <= limit;

/** Whether the store's usage fits the plan's limits: a plan it already outgrew is no offer. */
export function fitsPlan(usage: PlanOfferUsage, plan: PlanOfferCandidate): boolean {
  return (
    within(usage.products, plan.limits.products) &&
    within(usage.reservationsThisMonth, plan.limits.reservationsPerMonth) &&
    within(usage.customers, plan.limits.customers) &&
    within(usage.collaborators, plan.limits.collaborators)
  );
}

/**
 * The offer for a store on pay-as-you-go, or null when no plan would have cost it less.
 *
 * For each month, the plan is the cheapest one the store fits: that month's
 * reservations and the running month's, its catalogue, customers and team now (Pro,
 * else Ultra). It costs the store its price excluding VAT plus the VAT of the store's
 * country, while what the store paid Louez already includes VAT; so the plan saves
 * money when the month's payments are above that price with VAT. The running month is
 * checked first, then the last closed one.
 */
export function decidePlanOffer(input: PlanOfferInput): PlanOffer | null {
  const plans = [...input.plans].sort((a, b) => a.monthlyPriceMinor - b.monthlyPriceMinor);
  const vatRateBps = planOfferVatRateBps(input.country);
  const order: readonly PlanOfferPeriod[] = ["current", "previous"];
  for (const period of order) {
    const cost = input.costs.find((entry) => entry.period === period);
    if (!cost || !Number.isSafeInteger(cost.paidMinor)) continue;
    const usage: PlanOfferUsage = {
      ...input.standing,
      reservationsThisMonth: Math.max(input.standing.reservationsThisMonth, cost.reservations),
    };
    const plan = plans.find((candidate) => fitsPlan(usage, candidate));
    if (!plan || plan.monthlyPriceMinor <= 0) continue;
    const thresholdMinor = withVatMinor(plan.monthlyPriceMinor, vatRateBps);
    if (cost.paidMinor <= thresholdMinor) continue;
    return {
      plan: plan.slug,
      source: input.source,
      period,
      month: cost.month,
      currency: input.currency,
      paidMinor: cost.paidMinor,
      planPriceMinor: plan.monthlyPriceMinor,
      vatRateBps,
      thresholdMinor,
      savingsMinor: cost.paidMinor - thresholdMinor,
    };
  }
  return null;
}

/** How long a closed card stays closed. */
export const PLAN_OFFER_DISMISS_DAYS = 30;

/** Whether a card closed at `dismissedAt` is still closed at `now`. */
export function isPlanOfferDismissed(dismissedAt: Date | null, now: Date): boolean {
  if (!dismissedAt) return false;
  return now.getTime() - dismissedAt.getTime() < PLAN_OFFER_DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

/** `YYYY-MM` of `date` in UTC, and of the month before it. */
export function planOfferMonths(now: Date): { current: string; previous: string } {
  const format = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}`;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    current: format(year, month),
    previous: month === 0 ? format(year - 1, 11) : format(year, month - 1),
  };
}
