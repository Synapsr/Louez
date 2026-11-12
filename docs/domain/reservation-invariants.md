# Reservation invariants

What must be true of a reservation, its stock and its money, whoever writes it: the online store, the dashboard, the marketplace, the phone assistant, the API or an agent. The [glossary](glossary.md) defines the words; this page states the rules and says, for each one, whether the code holds it today.

A rule has one of three states:

- **Held**: every writer enforces it, and a test fails when one stops.
- **Partial**: some writers enforce it. The page names the ones that do not.
- **Open**: no writer enforces it yet. The page names what is known to break.

A change to a reservation writer keeps every held rule held, and moves a partial or open rule forward or leaves it where it is. It never adds a writer that skips a rule the others follow. When a rule changes state, change it here in the same pull request.

## The writers

| What it writes | Where it lives |
| --- | --- |
| A booking from the online store, the marketplace or the phone assistant | `createReservation`, `apps/web/lib/reservations/create-reservation.ts` |
| A booking typed in the dashboard | `createManualReservation`, `apps/web/app/(dashboard)/dashboard/reservations/actions.ts` |
| An edit of dates, lines, prices or delivery | `updateReservation`, same file |
| An extension asked by the customer | `apps/web/lib/reservations/extension-service.ts` |
| A status change made by the store | `changeStoreReservationStatus`, `packages/api/src/services/reservation-status.ts` |
| A status change made by a customer, a payment or the marketplace | `changeReservationStatus` from `@louez/db`, called directly |
| A payment, a refund, a deposit hold | the payment actions of the dashboard file, `apps/web/lib/reservations/`, the Stripe webhooks |

Two implementations create a booking and a third reshapes one. Most of the open rules below come from that: a rule fixed in one writer stays broken in the next. The reservation lots of the API migration ([API and agents](../architecture/api-and-agents.md)) end with one service per kind of write in `packages/api`, and every caller on it.

## Stock

**S1. One availability rule.** A unit or a quantity is free on a window when its lifecycle is active, no downtime covers the window, and no reservation in a blocking status overlaps the window widened by the store's turnover buffer, with strict bounds ([ADR 0006](../adr/0006-canonical-availability-semantics.md)). The blocking statuses are `confirmed` and `ongoing`, plus `pending` unless the store turned `pendingBlocksAvailability` off (`getBlockingReservationStatuses`). `packages/db` owns the predicates; `reserveInventory` in `packages/api` allocates on them.
_Partial._ `createManualReservation` computes capacity with its own code, and its overlap query leaves out the test that tells a live marketplace hold from an expired one.

**S2. A write that can raise demand checks capacity under the product locks.** A new booking, a line added, a quantity raised, dates moved, and a change into a blocking status all read the free stock after `SELECT … FOR UPDATE` on the products, in the transaction that writes.
_Partial._ `updateReservation` checks only when the dates change and the status is `confirmed` or `ongoing`: a line added or a quantity raised with the same dates is written unchecked.

**S3. The store may book over its stock, and only on purpose.** Louez never leaves a renter unable to record what they decided. When stock is short, the dashboard write is refused with the list of shortfalls (product, quantity asked, quantity free); sent again with `allowOverbooking`, it is written, its activity row records `overbooked` and the shortfalls, and the inbox shows it until it is over. A customer, the marketplace and the phone assistant never get that choice: their booking is refused.
_Partial._ Creation follows it. An edit either skips the check (S2) or, on a date change, refuses with no way to go on.

**S4. A unit serves one reservation at a time.** A unit assigned to a line is never assigned to another line whose reservation blocks the same window. This one is not for the store to override: two customers cannot leave with the same bike. Only a conflict that comes from the turnover buffer alone can be passed, with `overrideTurnoverBuffer`.
_Held_ for assignment and for date changes of assigned units.

**S5. Consumable stock moves with the status.** A confirmation takes the quantity, a cancellation or a rejection of a confirmed or ongoing reservation gives it back, a completion keeps it used. `changeReservationStatus` does it; an edit reconciles through `reconcileReservationStock`.
_Held._

**S6. A line blocks stock for the reservation's whole window.** The checkout accepts a period per line and prices each line on its own period, then stores only the reservation's dates: a helmet taken for one day of a four-day booking blocks four days.
_Open._ Either lines keep their own period, or the checkout stops accepting one. To decide with the convergence of the creation paths.

## Money

**M1. The totals are the sum of their parts.** The subtotal is the sum of the lines' totals (plus the insurance when it is not carried as a line). The total is the subtotal plus the delivery fee, less the discount.
_Open._ `updateReservation` computes the new totals from a read made before its transaction and compares only the status once it holds the lock. Measured on real data, the reservations that break the rule were all edited at least once; none of the never-edited ones does.

**M2. A reservation has one currency, fixed when it is created.** `reservations.currency` holds it. Every amount stated, asked, held, captured or refunded on that reservation is in it, whatever the store's settings say later (`reservationCurrency`, `apps/web/lib/reservations/payment-billing-facts.ts`).
_Partial._ The deposit hold and the extension quote read the store's current currency. Rows created before the column existed hold null and fall back to the store's current currency: a store that changes currency would restate all of them, until a backfill writes the currency they were made in.

**M3. A price is a fact of the booking.** The unit price, its breakdown, the tax rate, the promotion and the promo code applied when the line was priced are stored on the reservation. Only an edit of that line reprices it, and then with every rule the first pricing used. An edit of something else, or a change of the store's or the product's settings, changes no amount of an existing reservation.
_Open._ An edit reprices through the seasonal engine alone and drops the product's promotion. The totals the dashboard writes are later read back with the store's current tax settings.

**M4. Money has one representation.** An amount is a whole number of the currency's minor units, or a decimal string with exactly the currency's digits, and it is rounded once, where it is computed. A currency without decimals has none anywhere.
_Open._ Prices are JavaScript numbers rounded to two decimals in several places, and Stripe amounts are converted apart: a 50 % promotion on ¥101 is ¥50.50 in Louez and ¥51 at Stripe.

**M5. A provider is asked once for one intent.** A charge, a hold, a capture or a refund is first recorded as an attempt under the reservation's lock, then sent with an idempotency key that is stable for that attempt. A retry after a lost answer finds the same provider object. A second caller finds the attempt and does not call.
_Partial._ A deposit hold has neither the attempt nor the key: two requests at once can place two holds on the customer's card, and the second overwrites the reference to the first. An orphaned hold does not show in the database at all.

**M6. The balance is what is owed less what was received, in the reservation's currency.** A payment in another currency does not reduce it. The statistics follow the same rule (`services/sales-analytics.ts`).
_Held_ for the figures; the payment writers are reviewed with the money lot.

## Status

**T1. One function changes a status.** `changeReservationStatus` locks the row, checks the transition, moves consumable stock, dates `billableAt` and `withdrawnAt`, and writes the activity row. `insertReservation` is the only insert. `scripts/reservation-writes.test.mjs` fails on any other write ([Data layer, DL-12](../code-review/04-data-layer.md)).
_Held._

**T2. The transitions are a fixed graph.** `pending` goes to `confirmed`, `rejected` or `cancelled`; `quote` to `confirmed`, `declined` or `cancelled`; `confirmed` to `ongoing` or `cancelled`; `ongoing` to `completed` or `cancelled`. Nothing leaves `completed`, `cancelled`, `rejected` or `declined`, and nothing enters `pending` or `quote` (`packages/db/src/consumable-stock.ts`).
_Held._

**T3. A completed reservation is not edited.** Its lines, dates and totals are what was rented.
_Held_ in `updateReservation`.

## Concurrency

**C1. Locks are taken in one order.** The store row, then products by id, then reservations, then units by id ([Data layer, Lock order](../code-review/04-data-layer.md)). A path that still takes the reservation first runs inside `retryTransactionOnDeadlock`.
_Partial._ `updateReservation` locks the reservation and its units, then the products, with no retry.

**C2. A write decides on what it reads under its locks.** Whatever it read before them it reads again, or it proves nothing changed, before its first write.
_Partial._ Checkout and the store's status changes do. `updateReservation` does not (M1).

**C3. No effect runs inside a transaction that may run again.** A fee, an email, a notification or a provider call runs after the commit, once.
_Held_ for the paths listed under the lock order.

## Effects

**E1. A message that must not be lost is a row of the outbox, added in the write's transaction** ([The outbox](../architecture/api-and-agents.md#the-outbox)).
_Partial._ The store's status changes do. The messages of a new booking are sent after the commit from memory: a crash between the two loses them.

**E2. A write sent twice with the same idempotency key runs once.** Every procedure built on `storeProcedure` gets it from `runOperation`.
_Held_ for procedures; the server actions that are not procedures yet have none.

## Measuring

Each rule about data at rest can be counted with a read-only query: totals against lines, reservations over the stock, holds per reservation, currencies. Run the count on real data before and after a rule moves to held, to see that the writers stopped producing violations. Keep the figures out of this repository.

---

## Related

- [Glossary](glossary.md) — the domain's words
- [ADR 0005](../adr/0005-unit-status-three-dimensions.md) — lifecycle, downtime and operational state of a unit
- [ADR 0006](../adr/0006-canonical-availability-semantics.md) — the availability rule and who owns it
- [Data layer](../code-review/04-data-layer.md) — DL-12 (status and inserts), DL-13 (billing marks), lock order
- [API and agents](../architecture/api-and-agents.md) — procedures, idempotency, the outbox
