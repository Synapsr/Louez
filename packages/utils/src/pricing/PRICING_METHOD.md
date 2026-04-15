# Rate-Based Pricing Method

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

**UI toggle**: "Autoriser une remise progressive" = OFF (unchecked).

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

**UI toggle**: "Autoriser une remise progressive" = ON (checked).

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

For both modes: `originalSubtotal = ceil(durationMinutes / basePeriodMinutes) × basePrice × quantity`

This represents what the customer would pay at the base rate without any tier discounts.

## Savings & Reduction Percent

- `savings = max(0, originalSubtotal - subtotal)`
- `reductionPercent = (savings / originalSubtotal) × 100` (only if savings > 0)
