# Rate-Based Pricing Method

## Pricing kind: duration vs fixed

The per-product enum `pricingKind` (DB column `products.pricing_kind`, values `duration` | `fixed`, default `duration`) decides whether duration enters the price calculation at all.

- `duration`: everything below applies (V1 legacy tiers, V2 rate-based, seasonal pricing).
- `fixed` ("Forfait"): the line subtotal is `price × quantity`, full stop. `basePeriodMinutes` is `null`, pricing tiers and seasonal pricing are absent (product create/update purges them), and `enforceStrictTiers` is ignored. Deposits remain supported. Inventory is a separate axis: `stockKind=returnable` keeps time-window availability, `stockKind=consumable` decrements on confirmation, and `stockKind=untracked` has no quantity limit. Every calculation entry point (`calculateRentalPrice`, `calculateRateBasedPrice`, `calculateSeasonalAwarePrice`, `calculateCartItemPrice`) short-circuits through `calculateFixedPrice` when `isFixedPriceProduct` matches, and the resulting `PricingBreakdown` carries `pricingKind: 'fixed'` with `duration: 1`.

The rest of this document describes `duration` products only.

## Overview

Rate-based products (`basePeriodMinutes > 0`) have a base price/period and optional additional pricing tiers. Each tier defines a fixed price for a specific duration period (in minutes).

Example:

- Base: 20€ / 4h (basePeriodMinutes=240)
- Tier 1: 50€ / 1j (period=1440)
- Tier 2: 92.8€ / 2j (period=2880)
- Tier 3: 160€ / 3j (period=4320)

## Two Modes: `enforceStrictTiers`

The per-product boolean `enforceStrictTiers` (DB column `products.enforce_strict_tiers`) controls how prices are calculated.

### Mode 1: Strict (enforceStrictTiers = true) — DEFAULT for new products

**UI choice**: "Par périodes entières". The choice is visible with a single base rate.

Only exact tier durations are valid rental periods. If the rental duration falls between tiers, snap UP to the next tier and charge that tier's price.

**Algorithm**:

1. Collect all available periods: [basePeriodMinutes, ...tier.period]
2. Find the smallest period ≥ rental duration
3. Charge that tier's exact price

**Example**: Duration = 2j 2h (3000 min)

- Available: [240, 1440, 2880, 4320, 15840]
- Smallest ≥ 3000 → 4320 (3j)
- Price = 160€

**Edge case**: Duration > all tiers → bill whole multiples of the largest tier.

### Mode 2: Progressive (enforceStrictTiers = false) — DEFAULT for legacy products

**UI choice**: "Au prorata". The first base period remains the minimum charge.

Linear interpolation between adjacent tiers. Each tier is an anchor point on a price/duration curve. Between two consecutive tiers, the price transitions in a straight line from one to the next.

**Algorithm**:

1. Collect all rates (base included), sorted by period ascending
2. For duration d:
   - If d ≤ smallest period → charge the smallest period's price (base minimum)
   - If d matches a tier exactly → charge that tier's exact price
   - If d falls between tier A and tier B (consecutive):
     `ratio = (d - A.period) / (B.period - A.period)`
     `price = A.price + (B.price - A.price) × ratio`
   - If d > largest tier → extrapolate at the largest tier's per-minute rate:
     `price = largest.price / largest.period × d`

**Example**: Duration = 12h (720 min)

- Between base(240, 20€) and 1j(1440, 50€)
- ratio = (720 - 240) / (1440 - 240) = 0.4
- Price = 20 + (50 - 20) × 0.4 = 32€

**Example**: Duration = 4j (5760 min), last tier is 3j(4320, 160€)

- Beyond last tier → 160 / 4320 × 5760 = 213.33€

**Edge case**: Duration < smallest period (including base) → charge 1 full base period.

**Single-rate behavior**:
If only the base rate is defined:

- strict mode bills whole base periods,
- progressive mode bills proportionally using the base rate per minute.

**Guarantees**:

- Tier prices are respected exactly at tier boundaries
- Continuous curve (no price cliffs)
- Monotonically non-decreasing (longer never costs less, given non-decreasing tier prices)

## Original Subtotal (reference price without discounts)

The reference uses the same billing mode as the charged price:

- Strict: round the duration up to whole base periods, then multiply by the base price and quantity.
- Progressive: apply the base rate proportionally, with one base period as the minimum. Round the price per item before multiplying by quantity, as for the charged subtotal.

This keeps proration out of advertised discounts. A single rate of 15 EUR per week over 14 days and 2 hours costs 30.18 EUR in progressive mode, with the same reference price and no savings. Additional discounted rates can still produce savings against this reference.

## Savings & Reduction Percent

- `savings = max(0, originalSubtotal - subtotal)`
- `reductionPercent = (savings / originalSubtotal) × 100` (only if savings > 0)

## Seasonal pricing

Season dates use the store timezone. A rental occupies `[start, end)`: returning exactly when a new season begins never incurs that season's price. Seasonal end dates are inclusive calendar dates.

Evaluate each applicable seasonal grid for the **full rental duration**, using the product's strict or progressive mode. Allocate that result in proportion to the elapsed time covered by the season. The base grid applies outside configured seasons. This preserves the minimum and the duration tiers across season boundaries, instead of restarting them for every segment.

For a 24-hour rental with 12 hours at 25 EUR/day and 12 hours at 40 EUR/day, the total is 32.50 EUR. For a shorter rental the single minimum is shared between the seasons. In strict mode, the full rental is rounded before its price is allocated. A seven-day rental remains eligible for each seasonal grid's seven-day rate even if the seasons change during the week.

Amounts are allocated with cumulative cent rounding so the displayed seasonal amounts add up to the total. The deposit is applied once, after allocation. Proration creates no discount; discounted duration rates retain their savings against the corresponding seasonal base rates. The storefront, cart, checkout and reservation creation use the same shared engine.
