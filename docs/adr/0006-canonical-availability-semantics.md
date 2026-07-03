# One canonical availability semantics, owned by packages/db

The inventory feature shipped four hand-synchronized copies of the availability computation — the storefront service (`packages/api/services/availability.ts`), the checkout transaction, the MCP calendar tool, and the dashboard unit helpers (`apps/web/lib/utils/unit-availability.ts`) — and they disagreed on reservation-overlap bounds (inclusive `lte/gte` vs strict `lt/gt`), on the turnover buffer (applied vs ignored), and on whether `pendingBlocksAvailability` is honored. The result: back-to-back bookings sold at checkout that no unit could ever be assigned to, buffer guarantees the dashboard silently violated, and conflict-panel suggestions the reassign action then rejected. We define one canonical semantics and one owner:

- **Canonical rule**: a unit or quantity is available on a window iff lifecycle is `active`, no downtime overlaps the window, and no reservation with a blocking status overlaps the window **widened by the store's `turnoverBufferMinutes`**, using **strict bounds** (`lt`/`gt`) so a rental ending at instant T does not block one starting at T. Blocking statuses derive from `store.settings.pendingBlocksAvailability` — never hardcoded.
- **Owner**: the predicates and helpers live in `packages/db` (next to `buildUnitRentableDuringPredicate`), parameterized by `db | tx` so checkout's in-transaction recheck and the dashboard actions consume the exact same code. `apps/web`, `packages/api` and `packages/mcp` must not re-state the rule.
- **Admin override**: dashboard actions may bypass the **turnover buffer only** via an explicit flag (mirroring the existing `priceOverride`/`isManualOverride` pattern) after the action reports a buffer-only conflict; hard overlaps and double-bookings are never overridable. Storefront paths never override.
- **Write-path integrity**: availability checks that gate a write run **inside the write transaction** after `SELECT … FOR UPDATE` on the touched `product_units` rows (the pattern checkout already uses); mutations that reshape a reservation (dates, items) must update rows in place rather than delete+reinsert, and re-validate existing unit assignments.

## Considered Options

- **Shared core in `packages/api`**: closest to the current service, but MCP and checkout would depend on a storefront-shaped function (business hours, slug resolution) and the tx-parameterized variant fits poorly there.
- **Per-surface copies kept in sync by review**: the status quo; empirically failed within one PR (four copies, three divergences).
- **Inclusive bounds as canon**: would forbid back-to-back rentals the storefront already sells; strict-plus-buffer matches what the customer was promised at booking time.

## Consequences

- `products.quantity` stops being a persisted cache for unit-tracked products: readers derive the active-unit count at read time (the stored column remains authoritative only for non-tracked products). This removes the stale-form and migration-backfill class of bugs entirely.
- `product_units` writes are owned by the inventory actions (which log to the append-only event log). The product form only manages list membership: it may create units and delete unassigned ones; it no longer writes purchase details, notes, or lifecycle. Deleting a unit assigned to a blocking reservation is refused server-side.
- Dashboard-created (manual) reservations get the same server-side capacity check as checkout, with an explicit overbooking override flag that is confirmed in the UI and recorded — refusal is the default.
- `reservation_item_units` gains real foreign keys (`reservation_item_id` cascade, `product_unit_id` set-null — historical assignments survive unit deletion via their identifier snapshot, while deleting a unit with a blocking-status assignment is refused server-side before the FK is ever reached).
- Reserved quantities are netted of capacity-excluded assigned units only when the excluded unit actually absorbs its reservation: the reservation is `ongoing` (unit physically with the customer), or the unit is active and no downtime overlaps the reservation's own dates. A reservation whose assigned unit cannot serve it (retired, or downtimed during it) will be reassigned, so its demand stays counted — netting it would overstate availability and overbook.
