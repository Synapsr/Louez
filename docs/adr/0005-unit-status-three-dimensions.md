# Unit status is three dimensions, not one column

The legacy `productUnits.status` enum (`available | maintenance | retired`) conflated long-term fleet membership, temporary unavailability, and rental activity — an undated `maintenance` blocked capacity at every date until someone remembered to flip it back, and a planned future repair could not be recorded without blocking today. We split unit state into three dimensions: a merchant-set lifecycle (`active | retired`, retirement carrying a date and reason and being reversible), dated **Downtimes** in a dedicated table (reason + optional open end; capacity is reduced only on covered dates and recovers automatically), and an operational state derived from reservation assignments that is never merchant-set. Declaring a Downtime or Retirement never cancels reservations: conflicts are surfaced for reassignment to another unit.

## Considered Options

- **Widen the enum** (add `repair`, `unavailable`, `lost`…): simplest migration, but undated, no planned maintenance, no automatic return to availability, and merchants could hand-set states that must stay derived.
- **Enum + date columns on the unit**: one unavailability at a time, no history of past maintenance, near-certain later migration to a dedicated table.

## Consequences

- Availability at a date D becomes: lifecycle active AND no Downtime covering D AND no overlapping reservation — both the storefront capacity count (`checkout/actions.ts`) and `unit-availability.ts` must become date-aware with respect to Downtimes.
- Since unit assignment is optional (reservations consume anonymous quantity), a unit's operational state only reflects reservations it is assigned to; the inventory view compensates with a product-level "reserved without assigned unit" indicator.
- Unit mutations write to an append-only unit event log from day one; history not recorded at mutation time is unrecoverable.
