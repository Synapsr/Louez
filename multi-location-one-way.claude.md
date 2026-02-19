# Multi-Location / One-Way Feature Plan

## Context

Bike rental stores (and other rental businesses) need customers to choose different pickup and return locations. Example: pick up bikes in Brest (the shop), return in Quimper. The store defines predefined locations where they operate, each with a delivery fee. This is opt-in -- only stores that enable it see the feature. Existing delivery flow (distance-based to customer's address) remains untouched.

Client requests:
- Customer chooses pickup location and return location
- Fees calculated per location
- Reservation list shows pickup/return cities under dates
- Calendar shows location info on hover / after customer name

---

## 1. Types

**File: `packages/types/src/store.ts`**

Add new types:

```typescript
export interface LocationPoint {
  id: string            // nanoid
  name: string          // "Brest - Boutique", "Quimper - Gare"
  address: string
  city: string
  latitude: number
  longitude: number
  fee: number           // fixed fee per use (0 = free, i.e. home base)
  isHome: boolean       // the store's main location
  displayOrder: number
}

export interface LocationsSettings {
  enabled: boolean
  allowOneWay: boolean
  locations: LocationPoint[]
}
```

Extend `StoreSettings`:
```typescript
locations?: LocationsSettings  // add after delivery
```

---

## 2. Database Migration

**New file: `packages/db/src/migrations/XXXX_add_location_fields.sql`**

```sql
ALTER TABLE `reservations`
  ADD COLUMN `pickup_location_id` varchar(21) DEFAULT NULL,
  ADD COLUMN `pickup_location_name` varchar(255) DEFAULT NULL,
  ADD COLUMN `pickup_location_city` varchar(255) DEFAULT NULL,
  ADD COLUMN `pickup_location_fee` decimal(10,2) DEFAULT NULL,
  ADD COLUMN `return_location_id` varchar(21) DEFAULT NULL,
  ADD COLUMN `return_location_name` varchar(255) DEFAULT NULL,
  ADD COLUMN `return_location_city` varchar(255) DEFAULT NULL,
  ADD COLUMN `return_location_fee` decimal(10,2) DEFAULT NULL,
  ADD COLUMN `is_one_way` boolean DEFAULT false;
```

All nullable -- existing reservations unaffected. Names/cities denormalized so data survives if store edits/removes a location later.

**File: `packages/db/src/schema.ts`** -- Add matching Drizzle columns to `reservations` table after existing delivery fields.

---

## 3. Dashboard: Location Settings Page

**New files:**
- `apps/web/app/(dashboard)/dashboard/settings/locations/page.tsx` -- server page
- `apps/web/app/(dashboard)/dashboard/settings/locations/locations-settings-form.tsx` -- client form
- `apps/web/app/(dashboard)/dashboard/settings/locations/actions.ts` -- server action

**Pattern:** Follow existing delivery settings page structure (`apps/web/app/(dashboard)/dashboard/settings/delivery/`)

**UI:**
1. Enable toggle -- master on/off
2. Allow one-way toggle
3. Location list (sortable) -- each entry has:
   - Name (text)
   - Address (`AddressInput` component for geocoding)
   - City (auto-filled from geocoding)
   - Fee (number input, store currency)
   - "Home" checkbox (only one allowed; fee auto-set to 0)
4. Add Location button
5. Auto-populate first location from store address on first enable

**Nav entry:** Add to `apps/web/components/dashboard/settings-nav.tsx` with `MapPin` icon.

**Validation:** At least one location when enabled, exactly one `isHome`.

---

## 4. Storefront: Checkout Flow

### 4a. Types update

**File: `apps/web/app/(storefront)/[slug]/checkout/types.ts`**

```typescript
export type StepId = 'contact' | 'locations' | 'delivery' | 'address' | 'confirm'  // add 'locations'

export interface SelectedLocation {
  locationId: string
  name: string
  city: string
  fee: number
}
```

Extend `CheckoutFormProps` with `locationsSettings?: LocationsSettings`

### 4b. New hook

**New file: `apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-locations.ts`**

Manages:
- `pickupLocation` / `returnLocation` state
- Auto-selects home location as default for both
- Computes `isOneWay`, `totalLocationFee`
- **Same location**: `totalFee = pickupLocation.fee` (charged once, covers round-trip)
- **One-way**: `totalFee = pickupLocation.fee + returnLocation.fee` (each leg billed)
- Validates one-way is allowed when different locations selected

### 4c. New step component

**New file: `apps/web/app/(storefront)/[slug]/checkout/components/checkout-locations-step.tsx`**

UI:
- **Pickup location**: Radio cards listing all locations with name + fee
- **Return location**: Same list (only shown if `allowOneWay`; otherwise locked to same as pickup)
- Fee summary: "Retrait: Brest (Gratuit) -- Retour: Quimper (30,00 EUR)"

### 4d. Step flow update

**File: `apps/web/app/(storefront)/[slug]/checkout/utils.ts`**

```
Steps: ['contact']
  + ['locations']   (if locations enabled)
  + ['delivery']    (if delivery enabled AND locations NOT enabled)
  + ['address']     (if delivery selected OR requireCustomerAddress)
  + ['confirm']
```

When locations is enabled, it **replaces** the delivery step entirely. No mixing of both -- stores must disable locations to use standard distance-based delivery.

### 4e. Checkout form wiring

**File: `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`**
- Wire `useCheckoutLocations` hook
- Render `CheckoutLocationsStep`
- Include location fees in `totalWithDelivery`

**File: `apps/web/app/(storefront)/[slug]/checkout/page.tsx`**
- Pass `locationsSettings` to `CheckoutForm`

### 4f. Order summary

**File: `apps/web/app/(storefront)/[slug]/checkout/components/checkout-order-summary.tsx`**

Add location fee lines when applicable (pickup fee + return fee with `MapPin` icon).

### 4g. Payload builder

**File: `apps/web/app/(storefront)/[slug]/checkout/reservation-payload.ts`**

Add `locations` field to payload:
```typescript
locations?: {
  pickupLocationId, pickupLocationName, pickupLocationCity,
  returnLocationId, returnLocationName, returnLocationCity,
}
```

---

## 5. Server-Side Validation

**File: `apps/web/app/(storefront)/[slug]/checkout/actions.ts`**

After the existing delivery validation block, add location validation:
1. Check `locationsSettings.enabled`
2. Validate pickup/return location IDs exist in store's settings
3. If different IDs, check `allowOneWay`
4. **Recalculate fees from server-side settings** (never trust client)
5. Same location = charge once; one-way = charge both fees
6. Add total location fee to `serverTotalWithDelivery`
7. Write all 9 new columns to the reservation insert

---

## 6. Dashboard: Reservation List Display

### Table view
**File: `apps/web/app/(dashboard)/dashboard/reservations/reservations-table-view.tsx`**

Under the dates cell, add:
```
Brest → Quimper     (one-way)
Brest               (same location)
```

### Card view
**File: `apps/web/app/(dashboard)/dashboard/reservations/reservations-card-view.tsx`**

Same pattern under dates.

### Types
**File: `apps/web/app/(dashboard)/dashboard/reservations/reservations-types.ts`**

Add `pickupLocationCity`, `returnLocationCity`, `pickupLocationName`, `returnLocationName`, `isOneWay` to reservation type.

---

## 7. Dashboard: Calendar Display

**File: `apps/web/app/(dashboard)/dashboard/calendar/reservation-bar.tsx`**

- **Tooltip**: Add location line with `MapPin` icon: "Brest → Quimper" (or just "Brest" if same)
- **Bar label** (when one-way): Append short location indicator after customer name

**File: `apps/web/app/(dashboard)/dashboard/calendar/types.ts`**

Add location fields to calendar reservation type.

---

## 8. Dashboard: Reservation Detail

**File: `apps/web/app/(dashboard)/dashboard/reservations/[id]/reservation-detail-client.tsx`**

Add a "Locations" card when location data exists:
- Pickup location: name + fee
- Return location: name + fee
- One-way badge if applicable

---

## 9. Dashboard: New / Edit Reservation

### New reservation
**File: `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`**

Add location selectors (conditional on `locations.enabled`):
- Pickup location dropdown
- Return location dropdown (if `allowOneWay`)
- Fee display

### Edit reservation
**File: `apps/web/app/(dashboard)/dashboard/reservations/[id]/edit/edit-reservation-form.tsx`**

Same selectors, pre-populated with current values.

### ORPC mutations
**File: `packages/api/src/routers/dashboard/reservations.ts`** -- accept location fields in `createManualReservation` and `updateReservation`

---

## 10. Email Templates

**Files:**
- `apps/web/lib/email/templates/reservation-confirmation.tsx`
- `apps/web/lib/email/templates/reservation-cancelled.tsx`
- `apps/web/lib/email/templates/reservation-completed.tsx`

Add location section after dates:
```
Lieu de retrait : Brest - Boutique
Lieu de retour : Quimper - Gare
```
Only rendered when location data exists.

---

## 11. i18n

Add translation keys to `fr.json` and `en.json`:
- `dashboard.settings.locations.*` -- settings page
- `storefront.checkout.locations.*` -- checkout step
- `dashboard.reservations.locations.*` -- list/detail display
- Email template strings

---

## Edge Cases

| Case | Handling |
|------|----------|
| Store removes a location referenced by old reservations | Denormalized data on reservation preserved |
| Store disables locations after bookings exist | Old reservations keep their data, new ones skip locations |
| Same pickup and return location | `isOneWay = false`, fee charged **once** (pickup fee only; return fee = 0). The fee covers the round-trip transport. |
| Home location | Fee = 0 by default, represents the physical store |
| Both delivery + locations enabled on same store | **Locations replaces delivery** in checkout. When locations is enabled, the distance-based delivery step is hidden. Stores must disable locations to use standard delivery. |
| `allowOneWay = false` | Return location locked to same as pickup |

---

## Pricing Summary

| Scenario | Pickup fee | Return fee | Total |
|----------|-----------|------------|-------|
| Home → Home | 0 | 0 | 0 |
| Quimper → Quimper (fee: 30) | 30 | 0 (same loc) | 30 |
| Home → Quimper (fee: 30) | 0 | 30 | 30 |
| Quimper (30) → Morlaix (25) | 30 | 25 | 55 |

---

## Verification Plan

1. **Settings page**: Create a store with 3 locations (Brest/0EUR, Quimper/30EUR, Morlaix/25EUR), toggle one-way
2. **Storefront checkout**: Complete a booking with same-location, then one-way -- verify fees in summary
3. **Server validation**: Attempt to tamper with location fees client-side -- verify server recalculates
4. **Dashboard list**: Verify "Brest → Quimper" shows under dates for one-way bookings
5. **Calendar**: Hover reservation bar -- verify location tooltip
6. **Reservation detail**: Verify location card with fees
7. **New reservation (dashboard)**: Create manual reservation with location selection
8. **Emails**: Verify confirmation email includes location names
9. **Backward compat**: Verify stores without locations enabled see zero changes
