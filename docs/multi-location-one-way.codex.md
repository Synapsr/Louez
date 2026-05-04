# Multi-Location Pickup And Return Plan

## Summary

Implement configurable pickup/return locations for stores that operate from several places while keeping stock, pricing, and opening hours global to the store.

This is not multi-site inventory. Locations are operational information for the reservation flow:

- customers can choose where they pick up equipment;
- customers can choose where they return equipment;
- pickup and return locations can be different;
- delivery to/from a customer address remains available when delivery is enabled;
- no per-location stock, fees, or opening hours are introduced.

## Locked Decisions

1. The primary location is virtual and comes from the store's existing address fields.
2. Additional locations are persisted in a new `store_locations` table.
3. The primary location is always listed first and is not edited from the locations UI.
4. `locationId = null` or an omitted location id means the primary virtual location.
5. Location selection is enabled by an explicit toggle in delivery settings.
6. Locations do not replace delivery. They coexist with the existing address delivery flow.
7. Location choices never affect stock availability or reservation pricing.
8. Only address delivery legs use existing delivery fee logic.
9. Reservation location data is snapshotted server-side.
10. Prefer deduction over mode flags: no `deliveryFlowType`, no `isOneWay`.
11. No migration backfill for old reservations; display code falls back when snapshots are missing.

## Current Checkout Model

The checkout already has two independent legs:

- outbound/reception: `store` or `address`;
- return: `store` or `address`.

The feature extends `store` from "the store's single address" to "a selected store location".

When multi-location is enabled:

- `method = "store"` means a configured location selection;
- `method = "address"` keeps the existing delivery/address behavior;
- if `method = "store"` and no location id is provided, the primary virtual location is used.

This keeps the current payload shape largely intact and avoids a deep rename from `store` to `location`.

## Data Model

### New Table: `store_locations`

File: `packages/db/src/schema.ts`

Stores only additional locations. The primary location remains on `stores`.

Fields:

- `id` varchar(21), nanoid primary key
- `storeId` varchar(21), required, indexed, FK to `stores`
- `name` varchar(255), required
- `address` text, required
- `city` varchar(255), nullable
- `postalCode` varchar(20), nullable
- `country` varchar(2), default `FR`
- `latitude` decimal(10,7), nullable
- `longitude` decimal(10,7), nullable
- `isActive` boolean, default true
- `createdAt` timestamp
- `updatedAt` timestamp

No unique constraint on `(storeId, name)`. The address disambiguates similar names, and a uniqueness constraint would block legitimate cases.

Relations:

- `storesRelations.locations = many(storeLocations)`
- `storeLocationsRelations.store = one(stores)`

### Store Settings

File: `packages/types/src/store.ts`

Extend `DeliverySettings` with:

```ts
multiLocationEnabled?: boolean
```

Dashboard wording:

- toggle: `Activer les lieux de retrait et de retour`
- description: `Permettre aux clients de choisir un lieu configure pour le retrait et le retour du materiel. Le stock reste commun a la boutique.`

### Reservation Snapshots

Add lightweight IDs plus JSON snapshots to `reservations`.

Recommended columns:

- `pickupLocationId` varchar(21), nullable
- `returnLocationId` varchar(21), nullable
- `pickupLocationSnapshot` json, nullable
- `returnLocationSnapshot` json, nullable

Snapshot type:

```ts
export interface ReservationLocationSnapshot {
  type: 'primary' | 'additional'
  name: string
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  latitude?: number | null
  longitude?: number | null
}
```

Rules:

- snapshot is always written for new `store` legs, including the primary virtual location;
- `locationId = null` means the primary virtual location;
- `locationId != null` must belong to the store and be active when creating/updating to a new choice;
- old reservations without snapshots use display fallbacks.

## Dashboard Settings

Location management lives in `Parametres > Livraison` to stay near the existing pickup/delivery configuration.

Files likely touched:

- `apps/web/app/(dashboard)/dashboard/settings/delivery/page.tsx`
- `apps/web/app/(dashboard)/dashboard/settings/delivery/delivery-settings-form.tsx`
- `apps/web/app/(dashboard)/dashboard/settings/delivery/actions.ts`
- `packages/api` or app server helpers if delivery settings are moved through oRPC later

UI requirements:

- show the multi-location toggle;
- show the primary virtual location first, read-only, derived from the store address;
- list additional locations;
- add an additional location;
- edit an additional location;
- deactivate/reactivate an additional location;
- no reordering in v1;
- no editable primary marker in v1.

Validation:

- additional location `name` is required;
- additional location `address` is required;
- coordinates are stored when available but should not block reservation if missing;
- zero active additional locations is allowed because the primary virtual location always exists.

Disabling a location:

- never changes existing reservations, including future reservations;
- only hides that location from future checkout/manual reservation selections;
- existing reservations keep their snapshot.

## Storefront Checkout

Files likely touched:

- `apps/web/app/(storefront)/[slug]/checkout/page.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/checkout-form.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/components/checkout-delivery-step.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/components/delivery-leg-card.tsx`
- `apps/web/app/(storefront)/[slug]/checkout/hooks/use-checkout-delivery.ts`
- `apps/web/app/(storefront)/[slug]/checkout/reservation-payload.ts`
- `apps/web/app/(storefront)/[slug]/checkout/actions.ts`

When delivery and multi-location are both enabled, each leg keeps two choices:

Reception:

- `Retrait dans un lieu`
- `Livraison a mon adresse`

Return:

- `Retour dans un lieu`
- `Recuperation a mon adresse`

When delivery is disabled but multi-location is enabled:

- only location selection is shown for `store` legs;
- no address delivery choice appears.

Location UI:

- keep the current radio-card layout;
- the `store` card displays the selected location;
- the selected card contains a select/popover trigger;
- clicking opens all available locations;
- primary virtual location appears first;
- each option shows name plus full address or `address, postalCode city`;
- return location defaults to the selected pickup location but remains editable.

Pricing:

- selected locations add no fees;
- existing delivery fees apply only to `address` legs;
- examples:
  - delivery to customer + return to Portsall => address delivery fee only;
  - pickup at Porspoder + customer address collection => return address fee only;
  - Porspoder -> Portsall => no location fee.

Client payload:

- send only location IDs for `store` legs;
- do not send client-computed snapshots;
- `null`/omitted location ID means primary virtual location.

Server action:

- reconstruct snapshots from DB/store on the server;
- validate additional location IDs belong to the store;
- validate additional locations are active for new choices;
- keep existing address delivery validation unchanged.

## Shared Server Helper

Create a small server-only helper to resolve location IDs into snapshots.

Responsibilities:

- `locationId == null` => build primary snapshot from the store address;
- `locationId != null` => load additional location for the same store;
- creation/update validates active locations;
- display code reads reservation snapshots first and falls back only when missing.

Possible home:

- app server utility near reservation actions if the flow stays action-based;
- or `packages/api/src/services/*` if dashboard/manual reservation logic is moved through oRPC services.

Keep it small and framework-aligned; do not add a broad abstraction layer.

## Dashboard Manual Reservation Create/Edit

Manual creation and editing must match the checkout model.

Required behavior:

- same per-leg model: `store` or `address`;
- when `store`, choose a pickup/return location;
- return defaults to pickup but can differ;
- client sends IDs only;
- server reconstructs snapshots.

Editing an existing reservation with a now-inactive location:

- show the current value from the snapshot;
- if the staff changes the field, only active locations are selectable;
- do not force existing inactive snapshot values to be replaced.

Files likely touched:

- `apps/web/app/(dashboard)/dashboard/reservations/new/new-reservation-form.tsx`
- `apps/web/app/(dashboard)/dashboard/reservations/new/hooks/use-new-reservation-delivery.ts`
- `apps/web/app/(dashboard)/dashboard/reservations/new/components/new-reservation-step-delivery.tsx`
- `apps/web/app/(dashboard)/dashboard/reservations/new/types.ts`
- dashboard reservation edit form files
- `apps/web/app/(dashboard)/dashboard/reservations/actions.ts`
- `packages/validations/src/api.ts`
- relevant oRPC/dashboard reservation router files if used by the current form

## Display Rules

Compact display uses location names, not city names.

Rules:

- same pickup and return location: `Porspoder`
- different locations: `Porspoder -> Portsall`
- address delivery to location return: `Livraison -> Portsall`
- location pickup to address collection: `Porspoder -> Recuperation`
- address both ways: keep existing delivery display conventions

Detailed display:

- `Lieu de retrait: Porspoder`
- address below
- `Lieu de retour: Portsall`
- address below

For address legs, use existing delivery/return address display.

## Surfaces To Update In V1

Because this is operational reservation information, it must appear everywhere staff or customers need logistics context.

Storefront:

- checkout
- checkout confirmation/success
- customer account reservation detail

Dashboard:

- reservation detail
- reservation table/list view
- reservation card view
- calendar bars where space allows
- calendar tooltip
- manual reservation creation
- reservation editing

Artifacts and integrations:

- customer confirmation email
- other reservation lifecycle emails where pickup/return information is shown
- contract/PDF
- ICS calendar feed

ICS rule:

- `LOCATION` should be the pickup location address when reception is in a location;
- if reception is address delivery, use the customer delivery address;
- add full pickup/return logistics to `DESCRIPTION`.

## i18n

Add French and English keys for:

- multi-location toggle and description;
- location list management in delivery settings;
- checkout labels:
  - `Retrait dans un lieu`
  - `Lieu de retrait`
  - `Retour dans un lieu`
  - `Lieu de retour`
- compact route labels:
  - `Livraison`
  - `Recuperation`
- validation errors:
  - location not found;
  - inactive location;
  - missing additional location address/name.

Keep terminology:

- FR UI: `lieu`, `lieu de retrait`, `lieu de retour`;
- EN UI: `location`, `pickup location`, `return location`;
- code: `pickupLocation`, `returnLocation`.

## Migration Strategy

Create a migration that:

- creates `store_locations`;
- adds nullable location ID and snapshot columns to `reservations`.

Do not backfill existing reservations.

Fallback behavior:

- if snapshots are missing and method is `store`, display the current primary virtual location from the store;
- if method is `address`, keep current delivery/return address display.

## Tests And Verification

Unit/service tests:

- resolving primary virtual location snapshot;
- resolving additional active location snapshot;
- rejecting additional location from another store;
- rejecting inactive location for new choices;
- compact route formatter.

Integration/manual verification:

1. Enable multi-location in delivery settings.
2. Add `Portsall` as an additional location.
3. Checkout with `Porspoder -> Porspoder`.
4. Checkout with `Porspoder -> Portsall`.
5. Checkout with delivery address outbound and `Portsall` return.
6. Verify delivery fees apply only to address legs.
7. Verify reservation snapshots are written server-side.
8. Disable `Portsall`; verify old reservation still displays `Portsall`.
9. Verify new checkout no longer offers disabled `Portsall`.
10. Verify dashboard list, detail, calendar, email, PDF, and ICS display the route.
11. Verify stores without multi-location enabled keep current checkout behavior.

## Non-Goals For V1

- stock per location;
- per-location opening hours;
- per-location delivery fees;
- public marketing display on home/catalog pages;
- drag-and-drop location ordering;
- hard deletion of locations;
- backfilling old reservations;
- deep rename of existing `store | address` leg methods.
