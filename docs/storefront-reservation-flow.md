# Storefront Reservation Flow (Feature Inventory)

## Goal
Document the current customer journey from product selection to reservation submission and reservation viewing, so design can improve UX without losing existing behavior.

## Scope
- Storefront customer flow only (`/{slug}/*`)
- Product selection, cart, checkout, submit, confirmation, and account reservation viewing

## 1. Entry Points
- Home page (`/{slug}`) with hero date picker that routes to `/rental` with selected period.
- Catalog/home featured product cards can open a product preview modal for quick date selection.
- Direct product page (`/{slug}/product/{productId}`) supports full add-to-cart with dates/quantity/options.

## 2. Date & Availability Selection
- Date/time selection supports business-hours-aware slots and advance notice constraints.
- Timezone mismatch notice is shown when store timezone differs from browser timezone.
- Rental listing (`/{slug}/rental`) calls availability API and shows:
  - Product availability status (`available` / `limited` / `unavailable`)
  - Business-hours warnings for the selected period
  - Filter/search/category controls
  - Date change modal (without leaving page)

## 3. Product Selection Features
- Product cards show:
  - Current period price (with tier/rate reductions when applicable)
  - Availability badges
  - Quick add / quantity controls (mobile + desktop variants)
- Product modal supports:
  - Gallery + optional video
  - Rich description
  - Tier/rate pricing breakdown
  - Quantity management
  - Booking attributes (variant-like dimensions from tracked units)
  - Auto-allocation across matching combinations when one combination is insufficient
  - Optional accessories upsell modal after add

## 4. Cart Features
- Cart is persisted in `localStorage` and scoped to one store slug.
- Supports multi-line cart entries for same product with different attribute selections.
- Quantity editing per cart line.
- Global rental dates propagate across cart lines.
- Pricing summary includes:
  - Subtotal
  - Savings (tier/rate discounts)
  - Deposit total (shown separately)
- Checkout CTA from sidebar/sheet (`/{slug}/checkout`).

## 5. Checkout UX (Wizard)
Dynamic steps based on store settings and user choices:
- `contact` (always)
- `delivery` (only when store delivery is enabled)
- `address` (when delivery is selected OR store requires customer address)
- `confirm` (always)

### Contact Step
- First name, last name, email, phone.
- Business toggle with conditional company field.

### Delivery Step
- Pickup vs delivery selection (if delivery optional).
- Forced delivery modes supported (`required` / `included`).
- Address autocomplete input for delivery.
- Real-time distance + fee display (free threshold / round-trip notes).
- Continue blocked when delivery address is invalid/incomplete.

### Address Step
- Address, postal code, city, notes.

### Confirm Step
- Customer recap (with edit shortcut to contact step).
- CGV/terms display and required acceptance checkbox.
- Submit CTA changes by reservation mode:
  - `payment`: pay now label (full or deposit percentage)
  - `request`: request submission label

### Order Summary Panel
- Shows selected period and all lines.
- Displays requested vs resolved attributes (tracked-unit flows).
- Indicates lines still resolving availability or invalid.
- Shows delivery fee when applicable, totals, savings, tax display mode, and deposit info.

## 6. Submit Logic (Server-Side Behaviors)
When checkout submits (`createReservation`):
- Validates store, rental period, business hours, advance notice, min/max duration.
- Re-fetches products and recalculates all prices server-side (never trusts client totals).
- Validates stock and tracked-unit combination availability.
- Recomputes delivery distance/fee server-side.
- Uses transaction + row locking to prevent race conditions on overlapping reservations.
- Creates/updates customer profile.
- Creates reservation + reservation items + activity logs.
- Sends customer/admin notifications (email/SMS/Discord integrations where configured).

## 7. Branching After Submit
### Request mode
- User is redirected to confirmation page (`/{slug}/confirmation/{reservationId}`).
- Page shows reservation summary, next steps, and CTA to account area.

### Payment mode
- If Stripe is configured, user is redirected to Stripe Checkout.
- Return URL lands on `/{slug}/checkout/success?reservation=...&session_id=...`.
- Success page verifies payment status (backup to webhook race), updates reservation/payment state, and shows final summary.

## 8. Reservation Viewing (Post-Submit)
### Account access
- Customer account login via email OTP (`/{slug}/account/login`).
- Session cookie-based customer portal (`/{slug}/account`).
- Reservation list split into active vs history with status/payment badges.

### Reservation detail page
- `/{slug}/account/reservations/{reservationId}`
- Includes:
  - Status card and timeline dates
  - Item list and totals
  - Payment status/history
  - Conditional “Pay now” CTA for accepted unpaid reservations
  - Contract download (for eligible statuses)
  - Customer notes + store contact shortcuts

### Instant access links
- `/{slug}/r/{reservationId}?token=...` can auto-create customer session and deep-link to reservation detail.
- `/{slug}/account/success?...` supports token-based auto-login after payment flows.

## 9. Feature Matrix (Design-Critical Branches)
- Reservation mode:
  - `request`: submit request, no immediate payment
  - `payment`: Stripe checkout (full or partial/deposit %)
- Delivery mode:
  - `optional`: pickup/delivery choice
  - `required`: delivery mandatory
  - `included`: delivery mandatory + fee forced to zero
- Inventory mode:
  - Basic stock quantity
  - Tracked-unit combinations with attribute-based resolution

## 10. Main Screens To Redesign
- Home hero date selection block
- Rental listing (filters + availability cards + date header)
- Product modal / product details add-to-cart module
- Cart sidebar/sheet
- Checkout wizard (all conditional steps)
- Confirmation / success pages
- Account reservation list and reservation detail page
