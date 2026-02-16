# Optional Multi-Location One-Way Routing (Codex Plan)

## Summary
Implement an **opt-in multi-location routing mode** for stores that need one-way rentals, while keeping today's default flow unchanged for everyone else.

Chosen direction:
1. End-to-end scope across dashboard + storefront + artifacts.
2. Store-managed locations.
3. Pricing formula: two legs from boutique.
4. Multi-location checkout uses location selectors only.
5. Primary location label displayed as `Boutique`.

This extends the current delivery system and avoids breaking existing stores.

## Approaches Considered
1. Keep free-form addresses only and add dropoff address.
- Rejected: weaker data quality and harder consistent city labeling.
2. Store-managed locations with free-form override.
- Rejected for v1: adds UX and validation complexity.
3. Store-managed locations only when enabled (selected).
- Best fit for one-way operations, controlled choices, cleaner pricing, stable labels.

## Data Model And Persistence Changes

### 1) New table: `store_locations`
File: `packages/db/src/schema.ts`

Add `storeLocations`:
- `id` (nanoid PK)
- `storeId` (FK to `stores`, indexed)
- `label` (varchar)
- `city` (varchar, required)
- `address` (text, optional)
- `latitude` / `longitude` (decimal, required)
- `isPrimary` (boolean, default false)
- `isActive` (boolean, default true)
- `displayOrder` (int, default 0)
- `createdAt` / `updatedAt`

Relations:
- `storesRelations.locations = many(storeLocations)`
- `storeLocationsRelations.store = one(stores)`

### 2) Extend `reservations` for route snapshots
File: `packages/db/src/schema.ts`

Add columns:
- `deliveryFlowType` (`'address' | 'locations'`, default `'address'`)
- `pickupLocationId` (nullable FK to `store_locations`)
- `dropoffLocationId` (nullable FK to `store_locations`)
- `pickupLabel` (varchar, nullable)
- `pickupCity` (varchar, nullable)
- `dropoffLabel` (varchar, nullable)
- `dropoffCity` (varchar, nullable)
- `pickupDistanceKm` (decimal, nullable)
- `dropoffDistanceKm` (decimal, nullable)
- `pickupFee` (decimal, default 0)
- `dropoffFee` (decimal, default 0)

Keep existing delivery fields (`deliveryOption`, `deliveryAddress`, `deliveryCity`, `deliveryDistanceKm`, `deliveryFee`, etc.) for backward compatibility.

### 3) Migration strategy
Directory: `packages/db/src/migrations`

Create migration to add table + columns.

Backfill behavior:
- Existing reservations default to `deliveryFlowType = 'address'`.
- If route snapshot fields are empty, fallback display should behave as `Boutique -> Boutique`.
- If legacy delivery city exists, use it for dropoff display fallback when possible.

No destructive rewrite of legacy delivery fields.

## Shared Types And Settings Changes

### 4) Extend delivery settings type
File: `packages/types/src/store.ts`

Add in `DeliverySettings`:
- `routingMode?: 'address' | 'locations'` (default `'address'`)

Behavior:
- Existing stores without this key keep current behavior.
- Location mode applies only when `delivery.enabled` is true and `routingMode === 'locations'`.

## Dashboard: Delivery Settings + Location Management

### 5) Extend delivery settings UI/actions
Files:
- `apps/web/app/(dashboard)/dashboard/settings/delivery/actions.ts`
- `apps/web/app/(dashboard)/dashboard/settings/delivery/delivery-settings-form.tsx`
- `apps/web/app/(dashboard)/dashboard/settings/delivery/page.tsx`

Add:
- Routing mode selector (`address` vs `locations`).
- Location CRUD (add/edit/reorder/archive).
- Automatic bootstrap of primary location from store coordinates with label `Boutique`.

Validation:
- Cannot enable locations mode without valid store coordinates.
- Must keep at least one active location.
- Exactly one active primary location per store.

### 6) Preserve settings on store settings update
File: `apps/web/app/(dashboard)/dashboard/settings/actions.ts`

Ensure `updateStoreSettings` preserves nested settings currently at risk of being overwritten:
- `settings.delivery`
- `settings.inspection`
- other existing nested config sections

This prevents delivery/location config loss when editing general store settings.

## Storefront Checkout Changes

### 7) Checkout UI in locations mode
Files:
- `apps/web/app/(storefront)/[slug]/checkout/page.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/components/checkout-delivery-step.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-delivery.ts`
- `apps/web/app/(storefront)/[slug]/checkout/types.ts`
- `apps/web/app/(storefront)/[slug]/checkout/reservation-payload.ts`

In locations mode:
- Replace free-form delivery address input with pickup and dropoff location selectors.
- Keep boutique selectable as a location.
- Default both selectors to boutique.

### 8) Pricing formula for locations mode
Use selected rule:
- `totalDistance = distance(store -> pickup) + distance(store -> dropoff)`
- Apply fee config once to total:
- free-threshold check once
- minimum fee once
- if `mode === 'included'`, force fee `0`

Distance limits:
- Validate per leg (`store -> pickup`, `store -> dropoff`) using configured `maximumDistance`.

### 9) Server-side reservation creation validation and write
File: `apps/web/app/(storefront)/[slug]/checkout/actions.ts`

Add server checks:
- location IDs belong to store
- locations are active
- distances recomputed server-side

Persist:
- `deliveryFlowType = 'locations'`
- selected location IDs
- route snapshot labels/cities
- leg distances + leg fees
- keep `deliveryFee = pickupFee + dropoffFee` for compatibility

Legacy address flow remains unchanged.

## Dashboard Reservation Create/Edit Support

### 10) Manual reservation and edit flows
Files:
- `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`
- `apps/web/app/(dashboard)/dashboard/reservations/new/types.ts`
- `apps/web/app/(dashboard)/dashboard/reservations/actions.ts`
- `packages/validations/src/api.ts`
- `packages/api/src/context.ts`

Add route fields for manual create/edit in location mode:
- pickup location
- dropoff location
- server-side recalculation and validation with same rules as storefront

## Reservation Labels In List And Calendar

### 11) Reservations list (table/cards)
Files:
- `apps/web/app/(dashboard)/dashboard/reservations/reservations-types.ts`
- `apps/web/app/(dashboard)/dashboard/reservations/reservations-table-view.tsx`
- `apps/web/app/(dashboard)/dashboard/reservations/reservations-card-view.tsx`

Under dates, show:
- `Boutique -> Boutique` (default)
- `Boutique -> City`
- `City A -> City B`

### 12) Calendar bars and tooltips
Files:
- `apps/web/app/(dashboard)/dashboard/calendar/types.ts`
- `apps/web/app/(dashboard)/dashboard/calendar/reservation-bar.tsx`
- `apps/web/app/(dashboard)/dashboard/calendar/month-view.tsx`
- other calendar views as needed for consistent rendering

Show compact route suffix where space allows and full route in tooltip.

## End-To-End Read Surfaces

### 13) Reservation details and customer-facing pages
Files:
- `apps/web/app/(dashboard)/dashboard/reservations/[id]/reservation-header.tsx`
- `apps/web/app/(dashboard)/dashboard/reservations/[id]/reservation-detail-client.tsx`
- `apps/web/app/(storefront)/[slug]/confirmation/[reservationId]/page.tsx`
- `apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/page.tsx`

Expose route info consistently with snapshot-first rendering.

### 14) Emails, contract, and ICS export
Files:
- `apps/web/lib/email/send.ts`
- `apps/web/lib/email/templates/reservation-confirmation.tsx`
- `apps/web/lib/email/templates/request-accepted.tsx`
- `apps/web/lib/pdf/contract.tsx`
- `apps/web/lib/pdf/generate.ts`
- `apps/web/app/api/calendar/ics/route.ts`

Add departure/arrival location info in generated artifacts.

## i18n Updates
Files:
- `apps/web/messages/en.json`
- `apps/web/messages/fr.json`
- other locales aligned later or with fallback behavior

Add keys for:
- pickup/dropoff labels
- route string formatting
- location management UI
- validation and error messages

## API And Interface Changes

### Store settings/public shape
- `DeliverySettings.routingMode?: 'address' | 'locations'`

### New entities
- `store_locations` table and relation exposure in relevant queries.

### Reservation payloads (storefront and dashboard)
Add location-mode route payload:
- `pickupLocationId`
- `dropoffLocationId`
- flow discriminator (`deliveryFlowType`/equivalent input field)

Keep legacy delivery payload path valid.

## Edge Cases And Failure Modes
1. Store has no coordinates: locations mode cannot be enabled.
2. Location archived after booking: reservation keeps snapshot labels/cities.
3. One leg exceeds max distance: block with explicit error.
4. Only one active location: default to `Boutique -> Boutique`.
5. Free threshold with two-leg routing applies once on total transport fee.
6. Included mode always yields `deliveryFee = 0`.
7. Legacy reservations missing route fields render fallback labels.
8. Race condition on location updates during checkout handled by submit-time server validation.
9. Existing stores not in location mode keep current address flow unchanged.

## Test Cases

### Unit tests
1. Two-leg distance pricing (normal, free-threshold, included, minimum fee).
2. Per-leg max-distance validation.
3. Route label formatter (`Boutique` fallback, city-to-city variants).

### Integration tests
1. Delivery settings: enable locations mode + location CRUD.
2. Checkout in locations mode:
- boutique to boutique
- boutique to city
- city to city
- invalid/deactivated location
3. Reservation writes persist snapshots and fee breakdown.
4. Dashboard list + calendar show route labels.
5. Confirmation, account, email, contract, ICS include route data.

### Regression tests
1. Legacy address delivery checkout unchanged.
2. Non-delivery stores unchanged.
3. General settings update does not wipe delivery/location config.

## Assumptions And Locked Defaults
1. Feature is opt-in via `delivery.routingMode = 'locations'`.
2. Primary location label is fixed to `Boutique`.
3. In location mode, checkout uses location selectors only.
4. Pricing formula is two legs from boutique.
5. Max-distance validation is per leg.
6. Legacy mode remains available and unchanged for all non-opted stores.
