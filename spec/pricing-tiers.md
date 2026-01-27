# Pricing Tiers - Specification

> **Status**: Phase 1 in progress, Phase 2 planned
> **Last updated**: 2026-01-27

---

## Table of Contents

1. [Overview](#overview)
2. [Current Architecture](#current-architecture)
3. [Phase 1: Discount Precision](#phase-1-discount-precision)
4. [Phase 2: Fixed Bracket Pricing](#phase-2-fixed-bracket-pricing)
5. [UX & Design Guidelines](#ux--design-guidelines)
6. [Wording Reference (8 Languages)](#wording-reference-8-languages)
7. [Files Reference](#files-reference)

---

## Overview

Louez supports **tiered pricing** for rental products: the longer a customer rents, the lower the effective unit price. Each tier defines a minimum duration threshold and a discount percentage applied to the base price.

This document specifies two phases of improvement:

| Phase | Name | Goal | Scope |
|-------|------|------|-------|
| **1** | Discount precision | Eliminate rounding errors in bidirectional price editing | Schema + server actions + frontend |
| **2** | Fixed bracket pricing | Allow store owners to enforce exact tier durations | Schema + pricing engine + storefront + dashboard |

Both phases share a single schema migration and are designed to be backward-compatible. Existing products are unaffected.

---

## Current Architecture

### Data model

```
products
  ├── price            DECIMAL(10,2)   Base price per unit (e.g., 80.00 EUR/day)
  ├── pricingMode      ENUM('hour','day','week')
  └── productPricingTiers[]
        ├── minDuration       INT           Threshold (e.g., 3 = "from 3 days")
        ├── discountPercent   DECIMAL(5,2)  Percentage off base price (e.g., 25.00)
        └── displayOrder      INT
```

### Pricing engine flow

```
1. Input: basePrice, duration, tiers[]
2. Find applicable tier: highest minDuration ≤ duration
3. Effective price = basePrice × (1 - discountPercent / 100)
4. Total = effectivePrice × duration × quantity
```

### Dashboard tier editor (4-column grid)

Each tier row displays 4 editable fields in a responsive grid:

| Column | Field | Example |
|--------|-------|---------|
| **Duration** | `minDuration` (integer) | `3 jours` |
| **Discount** | `discountPercent` (percentage) | `-25%` |
| **Target price** | Computed unit price (editable) | `60.00 /j.` |
| **Total cost** | Computed total for tier duration (editable) | `180.00` |

All four fields are **bidirectionally linked** through `discountPercent`. Editing any one field recomputes the others instantly.

---

## Phase 1: Discount Precision

### Problem

The `discount_percent` column uses `DECIMAL(5,2)`, storing only 2 decimal places. When a store owner enters a **target price** or **total cost** that produces a repeating decimal percentage, the truncation causes visible rounding drift.

**Concrete example:** Product at 80 EUR/day, 3-day tier, desired total = 160 EUR.

```
Step 1  User enters total: 160 EUR
Step 2  Unit price:         160 / 3 = 53.333333... EUR/day
Step 3  Discount:           (80 - 53.333...) / 80 × 100 = 33.333333...%
Step 4  Stored in DB:       DECIMAL(5,2) → 33.33%  ← truncated
Step 5  Recalculated price: 80 × (1 - 0.3333) = 53.336 EUR/day
Step 6  Recalculated total: 53.336 × 3 = 160.008 → rounded to 160.01 EUR
```

**Result:** The store owner entered 160 EUR, but the storefront shows **160.01 EUR**. The 0.01 EUR drift erodes trust.

### Root cause

`DECIMAL(5,2)` cannot represent `33.333333...%`. The truncation to `33.33%` introduces an error of `0.003333...%`, which propagates through the pricing engine.

**A frontend-only fix is impossible.** Even if the client computes a precise value, the database truncates it on write. On the next page load, the imprecise value is read back.

### Solution: `DECIMAL(10,6)`

Increase the column precision to 6 decimal places.

**Proof with the same example:**

```
Stored:             33.333333%
Recalculated price: 80 × (1 - 0.33333333) = 53.333336 EUR/day
Recalculated total: 53.333336 × 3 = 160.000008 → rounded to 160.00 EUR
```

The residual error (0.000008 EUR) is **625x below** the 0.005 EUR rounding threshold.

**Edge case validation:**

| Base price | Duration | Target total | Exact % | Stored (6 dec.) | Recalculated total | Error |
|------------|----------|-------------|---------|------------------|--------------------|-------|
| 80 EUR | 3 days | 160.00 EUR | 33.333...% | 33.333333% | 160.000008 → 160.00 | 0.00 |
| 100 EUR | 7 days | 490.00 EUR | 30.000% | 30.000000% | 490.000000 → 490.00 | 0.00 |
| 3 EUR | 7 days | 10.00 EUR | 52.380952...% | 52.380952% | 10.000000 → 10.00 | 0.00 |
| 7 EUR | 11 days | 50.00 EUR | 35.064935...% | 35.064935% | 50.000005 → 50.00 | 0.00 |
| 150 EUR | 3 days | 270.00 EUR | 40.000% | 40.000000% | 270.000000 → 270.00 | 0.00 |

### Changes required

#### 1. Database schema

**File:** `src/lib/db/schema.ts`

```typescript
// Before
discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull(),

// After
discountPercent: decimal('discount_percent', { precision: 10, scale: 6 }).notNull(),
```

**Migration command:**
- Development: `pnpm db:push`
- Production: `pnpm db:generate` then `pnpm db:migrate`

MySQL `ALTER TABLE` widening a DECIMAL is non-destructive. Existing values like `33.33` become `33.330000`.

#### 2. Server actions

**File:** `src/app/(dashboard)/dashboard/products/actions.ts`

Three locations where `.toFixed(2)` must become `.toFixed(6)`:

```typescript
// createProduct (line ~68)
discountPercent: tier.discountPercent.toFixed(6),

// updateProduct (line ~145)
discountPercent: tier.discountPercent.toFixed(6),
```

The `duplicateProduct` function copies `tier.discountPercent` as-is (already a string from the DB), so no change is needed there.

#### 3. Frontend conversion precision

**File:** `src/components/dashboard/pricing-tiers-editor.tsx`

The bidirectional conversion formulas in `onChange` handlers must preserve full precision:

```typescript
// Before — rounds to 2 decimal places (insufficient)
const discount = Math.round(((basePrice - targetPrice) / basePrice) * 100 * 100) / 100

// After — rounds to 6 decimal places (lossless for DECIMAL(10,6))
const discount = Math.round(((basePrice - targetPrice) / basePrice) * 100 * 1e6) / 1e6
```

This applies to both the **target price** onChange and the **total cost** onChange.

#### 4. Display rounding

The discount percentage input field (`value={tier.discountPercent}`) will now hold values like `33.333333`. The `<Input type="number">` renders this as-is, which is acceptable since the user sees the precise result of their price/total input.

For **badges and labels** (storefront, preview table), percentages are already displayed via `Math.round()` in `calculateRentalPrice`. No change needed.

#### What does NOT change

| Component | Reason |
|-----------|--------|
| Pricing engine (`calculate.ts`) | Already uses floating-point arithmetic |
| Zod validation (`product.ts`) | Validates range 0-99, not decimal precision |
| TypeScript types (`store.ts`) | `discountPercent: number` — no precision constraint |
| Storefront components | `parseFloat()` handles any decimal string |
| User-facing behavior | Users never see `33.333333%` in badges or labels |

---

## Phase 2: Fixed Bracket Pricing

### Problem

The current tiered pricing is **progressive**: any rental duration qualifies for the best applicable tier. A 5-day rental with tiers at 1, 3, and 7 days gets the 3-day tier discount applied to all 5 days.

Some store owners want **fixed bracket pricing** (also called "package pricing"): customers can only rent at tier-defined durations. Between-tier durations are not available.

### Example scenario

A car rental company with:
- Base price: 80 EUR/day
- 3-day tier: 180 EUR total (= 60 EUR/day, -25%)
- 7-day tier: 350 EUR total (= 50 EUR/day, -37.5%)

**Progressive mode (current):**

| Customer wants | Duration charged | Price | Explanation |
|----------------|-----------------|-------|-------------|
| 1 day | 1 day | 80 EUR | Base price |
| 2 days | 2 days | 160 EUR | 80 x 2, no tier applies |
| 3 days | 3 days | 180 EUR | 60 x 3, 3-day tier |
| 5 days | 5 days | 300 EUR | 60 x 5, 3-day tier |
| 7 days | 7 days | 350 EUR | 50 x 7, 7-day tier |

**Fixed bracket mode (new):**

| Customer wants | Duration charged | Price | Explanation |
|----------------|-----------------|-------|-------------|
| 1 day | 1 day | 80 EUR | Base price (= 1-day bracket) |
| 2 days | 3 days | 180 EUR | Snaps up to 3-day bracket |
| 3 days | 3 days | 180 EUR | Exact 3-day bracket |
| 5 days | 7 days | 350 EUR | Snaps up to 7-day bracket |
| 7 days | 7 days | 350 EUR | Exact 7-day bracket |

The key difference: **there is no 2-day or 5-day option**. The customer picks from the available brackets.

### Schema change

**File:** `src/lib/db/schema.ts`

```typescript
// In the products table definition, add:
enforceStrictTiers: boolean('enforce_strict_tiers').default(false).notNull(),
```

This is a **product-level** setting (not store-level), because different products may need different strategies. A store might rent bikes with progressive discounts and luxury cars with fixed brackets.

### Pricing engine changes

**File:** `src/lib/pricing/calculate.ts`

```typescript
/**
 * Get available durations when strict tiers are enforced.
 * Returns null for progressive pricing (any duration allowed).
 */
export function getAvailableDurations(
  tiers: PricingTier[],
  enforceStrictTiers: boolean
): number[] | null {
  if (!enforceStrictTiers || tiers.length === 0) return null
  // Always include "1" (base price) plus all tier durations
  const durations = new Set([1, ...tiers.map((t) => t.minDuration)])
  return [...durations].sort((a, b) => a - b)
}

/**
 * Snap a duration to the next valid tier bracket (round up).
 * Used when enforceStrictTiers is true.
 */
export function snapToNearestTier(
  duration: number,
  availableDurations: number[]
): number {
  return availableDurations.find((d) => d >= duration)
    ?? availableDurations[availableDurations.length - 1]
}
```

The main `calculateRentalPrice` function does NOT change — it already computes `effectivePrice * duration`. When strict mode is enabled, the **input** `duration` is pre-snapped to a valid bracket by the calling code (storefront or checkout).

### Dashboard UX

#### Toggle placement

The toggle appears **inside** the pricing tiers card, below the tier rows and above the preview table. It is only visible when tiers are enabled (at least one tier exists).

```
┌─────────────────────────────────────────────┐
│ [Toggle] Réductions longue durée            │
├─────────────────────────────────────────────┤
│ Paliers de réduction            [+ Ajouter] │
│                                             │
│ ┌─ Tier 1 ────────────────────────────────┐ │
│ │ 3 jours  │ -25%  │ 60.00/j. │ 180.00   │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ Tier 2 ────────────────────────────────┐ │
│ │ 7 jours  │ -37.5% │ 50.00/j. │ 350.00  │ │
│ └──────────────────────────────────────────┘ │
│                                             │
│ ┌──────────────────────────────────────────┐ │
│ │ [Toggle] Proposer uniquement ces durées  │ │
│ │ Lorsque activé, les clients ne peuvent   │ │
│ │ réserver que pour les durées exactes de   │ │
│ │ vos paliers (ex: 1 jour, 3 jours,       │ │
│ │ 7 jours). Les durées intermédiaires ne   │ │
│ │ sont pas proposées.                      │ │
│ └──────────────────────────────────────────┘ │
│                                             │
│ ┌─ Preview (adapts to mode) ──────────────┐ │
│ │ Durée     │ Prix/u. │ Total  │ Économie │ │
│ │ 1 jour    │ 80.00   │ 80.00  │ -        │ │
│ │ 3 jours   │ 60.00   │ 180.00 │ -60.00   │ │
│ │ 7 jours   │ 50.00   │ 350.00 │ -210.00  │ │
│ └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Preview table behavior:**
- **Progressive mode:** Shows predefined sample durations (1, 3, 7, 14, 30 days) with interpolated prices.
- **Fixed bracket mode:** Shows **only** the tier-defined durations (1 day + each tier). No intermediate durations appear, making it immediately clear which "packages" the customer can choose.

### Storefront UX

When `enforceStrictTiers` is `true`:

1. **Date picker:** The end date is constrained to only produce valid tier durations from the selected start date. Intermediate dates are greyed out or not selectable.

2. **Duration selector (alternative):** Instead of a date range, show a dropdown or button group with the available brackets:
   ```
   [1 jour - 80 EUR] [3 jours - 180 EUR] [7 jours - 350 EUR]
   ```

3. **Pricing display:** Show packages as a clear table instead of "from X EUR/day":
   ```
   ┌───────────┬──────────┐
   │ 1 jour    │   80 EUR │
   │ 3 jours   │  180 EUR │
   │ 7 jours   │  350 EUR │
   └───────────┴──────────┘
   ```

4. **Informational message:** If a customer attempts to select an intermediate duration, display:
   > "Ce produit est disponible pour les durées suivantes : 1 jour, 3 jours, 7 jours."

### Edge cases

| Case | Behavior |
|------|----------|
| No tiers defined + strict mode enabled | Strict mode toggle is hidden (requires at least 1 tier) |
| Duration exceeds all tiers | Snaps to highest tier (e.g., 10 days → 7-day bracket) |
| Single tier (e.g., 7 days only) | Available: 1 day, 7 days. Nothing in between. |
| Product pricing mode changes | Tier durations are in the product's pricing unit (hours, days, weeks) |
| `enforceStrictTiers` toggled off | Instantly reverts to progressive pricing, no data loss |

---

## UX & Design Guidelines

### Guiding principles

1. **The store owner should never have to do mental math.** The 4-column grid (duration, discount %, target price, total cost) lets them think in whichever unit is natural: "I want 25% off" or "I want 60 EUR/day" or "I want 180 EUR for 3 days."

2. **The preview table is the source of truth.** It shows exactly what the customer will see. In progressive mode, it shows a range of durations. In fixed bracket mode, it shows only the available packages.

3. **One toggle, two modes.** The `enforceStrictTiers` toggle is a simple on/off. It doesn't add complexity to the tier editor itself — the same 4-column grid works for both modes.

4. **No jargon.** Avoid terms like "progressive pricing" or "bracket mode" in the UI. Use plain language:
   - "Proposer uniquement ces durées" (not "Activer le mode forfaitaire")
   - "Les durées intermédiaires ne sont pas proposées" (not "Désactiver le pricing progressif")

5. **Visual feedback.** When fixed bracket mode is active, the preview table header could include a subtle badge: "Forfaits" / "Packages", reinforcing that these are the exact options available.

### Responsive layout

The 4-column tier grid is responsive:

| Breakpoint | Layout |
|------------|--------|
| `< sm` (mobile) | 2 columns per row (Duration + Discount on row 1, Price + Total on row 2) |
| `>= sm` | 4 columns in a single row |

```typescript
className={cn(
  'flex-1 grid gap-x-4 gap-y-3',
  basePrice > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'
)}
```

When `basePrice` is 0 or undefined, only the first 2 columns (Duration + Discount) are shown, since target price and total cost cannot be computed.

### Input field sizing

- Duration and Discount inputs: `w-20`
- Target price and Total cost inputs: `w-24`

This keeps the columns compact and avoids disproportionate widths.

---

## Wording Reference (8 Languages)

### Existing keys (`dashboard.products.form.pricingTiers`)

| Key | FR | EN | DE |
|-----|----|----|-----|
| `enableTiers` | Reductions longue duree | Long-term discounts | Langzeitrabatte |
| `enableTiersDescription` | Proposez des reductions automatiques pour les locations plus longues | Offer automatic discounts for longer rentals | Bieten Sie automatische Rabatte fur langere Mieten an |
| `tiersTitle` | Paliers de reduction | Discount tiers | Rabattstufen |
| `addTier` | Ajouter un palier | Add a tier | Stufe hinzufugen |
| `addFirstTier` | Ajouter un premier palier | Add first tier | Erste Stufe hinzufugen |
| `noTiers` | Aucun palier de reduction configure | No discount tiers configured | Keine Rabattstufen konfiguriert |
| `fromDuration` | A partir de | From | Ab |
| `discount` | Reduction | Discount | Rabatt |
| `targetPrice` | Prix cible | Target price | Zielpreis |
| `tierTotal` | Cout total | Total cost | Gesamtkosten |
| `insteadOf` | au lieu de | instead of | statt |
| `duplicateDurationError` | Chaque palier doit avoir une duree minimum differente | Each tier must have a different minimum duration | Jede Stufe muss eine andere Mindestdauer haben |
| `preview` | Apercu des tarifs | Price preview | Preisvorschau |
| `previewDescription` | Voici comment les prix seront calcules pour differentes durees | Here's how prices will be calculated for different durations | So werden die Preise fur verschiedene Dauern berechnet |
| `previewTooltip` | Les reductions s'appliquent automatiquement en fonction de la duree de location | Discounts are automatically applied based on rental duration | Rabatte werden automatisch basierend auf der Mietdauer angewendet |
| `duration` | Duree | Duration | Dauer |
| `pricePerUnit` | Prix unitaire | Unit price | Stuckpreis |
| `total` | Total | Total | Gesamt |
| `savings` | Economie | Savings | Ersparnis |

*(ES, IT, NL, PL, PT follow the same pattern — see `src/messages/*.json`)*

### New keys for Phase 2

| Key | FR | EN |
|-----|----|----|
| `enforceStrictTiers` | Proposer uniquement ces durees | Only offer these durations |
| `enforceStrictTiersDescription` | Lorsque active, les clients ne peuvent reserver que pour les durees exactes de vos paliers. Les durees intermediaires ne sont pas proposees. | When enabled, customers can only book for the exact durations defined by your tiers. Intermediate durations are not available. |
| `packagesLabel` | Forfaits | Packages |
| `availableDurations` | Durees disponibles : {durations} | Available durations: {durations} |
| `selectAvailableDuration` | Ce produit est disponible pour les durees suivantes : {durations}. | This product is available for the following durations: {durations}. |

**Wording rationale:**
- "Proposer uniquement ces durees" is neutral and action-oriented. It avoids technical jargon ("strict", "enforce", "bracket") and clearly describes the outcome.
- "Les durees intermediaires ne sont pas proposees" reassures the store owner about what happens to in-between values.
- The storefront message uses "disponible" (available) rather than "autorise" (allowed) — softer, customer-friendly tone.

---

## Technical Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| `discountPercent` range | 0 - 99 | 100% = free rental, not supported |
| `discountPercent` storage | `DECIMAL(10,6)` | 6 decimals for lossless round-trip from target price |
| `minDuration` | >= 1, integer | Fractional durations not supported |
| Max tiers per product | 5 | UX simplicity, can be increased later |
| Unique constraint | `(productId, minDuration)` | No two tiers with the same threshold |
| `enforceStrictTiers` | Per-product boolean, default `false` | Different products can use different strategies |

### Conversion formulas

```typescript
// Price → Discount
discountPercent = ((basePrice - targetPrice) / basePrice) * 100

// Total → Discount
unitPrice = totalCost / minDuration
discountPercent = ((basePrice - unitPrice) / basePrice) * 100

// Discount → Price
effectivePrice = basePrice * (1 - discountPercent / 100)

// Discount → Total
total = basePrice * (1 - discountPercent / 100) * minDuration
```

All conversions round `discountPercent` to 6 decimal places (`Math.round(x * 1e6) / 1e6`) before storage.

---

## Files Reference

| File | Role | Phase |
|------|------|-------|
| `src/lib/db/schema.ts` | Database schema (Drizzle ORM) | 1 + 2 |
| `src/lib/pricing/calculate.ts` | Pricing engine | 2 |
| `src/lib/pricing/types.ts` | Pricing TypeScript types | 2 |
| `src/lib/validations/product.ts` | Zod validation schemas | 2 |
| `src/types/store.ts` | Shared TypeScript interfaces | - |
| `src/components/dashboard/pricing-tiers-editor.tsx` | Dashboard tier editor | 1 + 2 |
| `src/app/(dashboard)/dashboard/products/actions.ts` | Server actions (CRUD) | 1 |
| `src/app/(dashboard)/dashboard/products/product-form.tsx` | Product form | 2 |
| `src/components/storefront/pricing-tiers-display.tsx` | Storefront tier display | 2 |
| `src/app/(storefront)/[slug]/product/*/add-to-cart-form.tsx` | Add to cart form | 2 |
| `src/messages/*.json` | i18n translations (8 languages) | 1 + 2 |
