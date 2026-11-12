# Reservation invariants

What must be true of a reservation, its stock and its money, whoever writes it: the online store, the dashboard, the marketplace, the phone assistant, the API or an agent. The [glossary](glossary.md) defines the words; this page states the rules and says, for each one, whether the code holds it today.

A rule has one of three states:

- **Held**: every writer enforces it, and a test fails when one stops.
- **Partial**: some writers enforce it, or all do and no test protects it. The page names what is missing.
- **Open**: no writer enforces it yet. The page names what is known to break.

A change to a reservation writer keeps every held rule held, and moves a partial or open rule forward or leaves it where it is. It never adds a writer that skips a rule the others follow. When a rule changes state, change it here in the same pull request.

## The writers

| What it writes                                                          | Where it lives                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A booking from the online store, the marketplace or the phone assistant | `createReservation`, `apps/web/lib/reservations/create-reservation.ts`                                                                                                                                  |
| A booking typed in the dashboard                                        | `createManualReservation`, `apps/web/app/(dashboard)/dashboard/reservations/actions.ts`                                                                                                                 |
| An edit of dates, lines, prices or delivery                             | `updateReservation`, same file                                                                                                                                                                          |
| The billing identity of a reservation                                   | `packages/api/src/routers/dashboard/reservations.ts`                                                                                                                                                    |
| An extension asked by the customer, and its reconciliation by the cron  | `apps/web/lib/reservations/extension-service.ts`, `extension-quote.ts`                                                                                                                                  |
| A status change made by the store                                       | `changeStoreReservationStatus`, `packages/api/src/services/reservation-status.ts`                                                                                                                       |
| A status change made by a customer, a payment or the marketplace        | `changeReservationStatus` from `@louez/db`, called directly                                                                                                                                             |
| Units assigned to a line, replaced or removed                           | `assignUnitsToReservationItem` in the dashboard reservations file; `apps/web/app/(dashboard)/dashboard/products/[id]/actions.ts`; `packages/api/src/services/variant-axes.ts` when a variant is rekeyed |
| A payment, a refund, a deposit return recorded by the store             | the payment actions of the dashboard reservations file, `apps/web/lib/reservations/dashboard-payment-writes.ts`                                                                                         |
| The same, recorded by an agent                                          | `packages/mcp/src/tools/payments.ts` and `apps/web/lib/ai/tools.ts`, each with its own code                                                                                                             |
| A payment or a deposit authorization made by the customer               | `apps/web/lib/reservations/payment-session.ts`, `start-checkout-payment.ts`, `complete-checkout-payment.ts`, `apps/web/app/(storefront)/[slug]/authorize-deposit/`, the Stripe webhooks                 |
| A contract validated or signed                                          | `packages/api/src/services/reservation-contract-validation.ts`, `reservation-sign.ts`                                                                                                                   |

A customer's request to change dates writes a request in the activity, not the dates: the store's edit applies it.

Two implementations create a booking, a third reshapes one, and payments are recorded by three. Most of the partial and open rules below come from that: a rule fixed in one writer stays broken in the next. The reservation lots of the API migration ([API and agents](../architecture/api-and-agents.md)) end with one service per kind of write in `packages/api`, and every caller on it.

## Stock

**S1. One availability rule per stock kind.** Returnable stock: a unit or a quantity is free on a window when its lifecycle is active, no downtime covers the window, and no reservation in a blocking status overlaps the window widened by the store's turnover buffer, with strict bounds ([ADR 0006](../adr/0006-canonical-availability-semantics.md)). A reservation's window runs to its end date, or to the end a live extension checkout is holding (`reservationAvailabilityEndSql`). Consumable stock has no time dimension: what is free is the quantity on hand less what blocking reservations have not consumed yet. Untracked stock has no limit. The blocking statuses are `confirmed` and `ongoing`, plus `pending` unless the store turned `pendingBlocksAvailability` off (`getBlockingReservationStatuses`). `packages/db` owns the predicates; `reserveInventory` in `packages/api` allocates on them.
_Partial._ Every writer of a booking allocates with `reserveInventory`: the checkout, the dashboard's creation and edit, the extension, and a change into a status that takes stock (`checkExistingReservationInventory`). A line booked with no exact combination is served by any unit that matches what it chose, for each of them but the extension, which still asks one combination to cover the whole line. Two more cases escape the rule. `buildReservationOverlapPredicate` gives MySQL the window's start in the server's time zone, not in UTC like the stored dates: on a server ahead of UTC, a booking that ends less than the offset after the buffered start is not seen. And a booked line that chose some of a product's axes counts on the product alone for the other bookings, not on the combinations that can serve it. No database test covers the extension's allocation (X1).

**S2. A write that can raise demand checks capacity under the product locks.** A new booking, a line added, a quantity raised, dates moved, and a change into a blocking status all read the free stock after `SELECT … FOR UPDATE` on the products, in the transaction that writes.
_Partial._ Returnable stock: every writer checks. `updateReservation` does whenever the edit moves what a stock-holding reservation asks for, per product and per size or combination chosen (`compareReservationDemand`). Consumable stock is reconciled, and refuses to go below zero, on an edit of a `confirmed` or `ongoing` reservation only: an edit of a `pending` one is not checked against it.

**S3. The store may book over its returnable stock, and only on purpose.** Louez never leaves a renter unable to record what they decided. When stock is short, the dashboard write is refused with the list of shortfalls (product, quantity asked, quantity free); sent again with `allowOverbooking`, it is written, its activity row records `overbooked` and the shortfalls, and the inbox shows it until it is over. A customer, the marketplace and the phone assistant never get that choice: their booking is refused. Consumable stock is physical: no override takes it below zero.
_Held._ Creation and edits follow it, with the same check (`reserveInventory`, `onShortfall: "collect"`), the same answer, the same trace written in the write's transaction (`services/capacity-verdict.ts`), and the same inbox item, which leaves once a later edit fits the stock. The override books over what other bookings hold of a consumable and have not taken yet, never over what is on hand: a write that would take it below zero is refused with `errors.consumableInsufficientStock`.

**S4. A unit serves one reservation at a time.** A unit assigned to a line is never assigned to another line whose reservation blocks the same window. This one is not for the store to override: two customers cannot leave with the same bike. Only a conflict that comes from the turnover buffer alone can be passed, with `overrideTurnoverBuffer`.
_Partial._ Assignment and the dashboard's date changes refuse a hard conflict. A unit can be assigned to a reservation that does not block yet (a quote, or a request when requests do not block), then to a confirmed one; confirming the first checks the product's capacity (`checkExistingReservationInventory`), not its assigned units. No test covers assignment conflicts.

**S5. Consumable stock moves with the status.** A confirmation takes the quantity, a cancellation of a confirmed or ongoing reservation gives it back, a completion keeps it used. `changeReservationStatus` does it; an edit reconciles through `reconcileReservationStock`.
_Partial._ The status helper holds it, with database tests, and so does the dashboard's creation. Nothing tests that the dashboard's edit keeps calling the reconciliation.

**S6. A line blocks stock for the reservation's whole window.** The checkout accepts a period per line and prices each line on its own period, then stores only the reservation's dates: a helmet taken for one day of a four-day booking blocks four days.
_Open._ Either lines keep their own period, or the checkout stops accepting one. To decide with the convergence of the creation paths.

## Money

**M1. The totals are the sum of their parts.** The subtotal is the sum of the lines' totals, plus the insurance when it is not carried as a line. The total is what the tax engine gives for the lines, the delivery fee and the discount, tax included (`calculateTaxBreakdown`): with prices that include tax it is the subtotal plus delivery less the discount; with prices before tax, the tax comes on top. The deposit is never part of it.
_Partial._ `updateReservation` still computes the new totals from a read made before its transaction, and refuses the edit when that read no longer holds under its locks (C2): two edits at once no longer leave the lines of one and the total of the other. It builds its total apart from the pricing the checkout uses (M3).

**M2. A reservation has one currency, written on it when it is created.** `reservations.currency` holds it (`reservationCurrency`, `apps/web/lib/reservations/payment-billing-facts.ts`). Every amount stated, asked or held on that reservation is in it, whatever the store's settings say later. An amount sent against an existing provider object, the capture of a hold or the refund of a charge, is in that object's own currency, as the provider states it: a capture against a hold in another currency than the reservation's is refused, and the store captures it from Stripe.
_Partial._ What asks or holds money on an existing reservation reads the reservation's currency: the customer's payment session, the payment request, the dashboard's deposit hold, the customer's own deposit authorization and the extension quote. A capture is counted in its hold's currency, which Stripe is asked for, and a Stripe refund in its charge's; both are recorded as Stripe answered them. So does what states an amount to someone: the emails and text messages, the outbox payload of a status change (a row queued without the field states the store's, and so does a row queued with it but sent by an instance still running the previous code: the guarantee holds once every instance runs the new code), the contract, the invoice and credit note of a payment with no currency of its own, the marketplace's view of a booking, the inbox, and the dashboard's page and edit form of a reservation. A test fails when one of these reads the store's: the dashboard's hold, capture and refund (`deposit-currency.db.test.ts`), the payment session (`payment-session.db.test.ts`), the payment request (`util.payment-request.test.ts`, `actions.db.test.ts`), the extension quote (`extension-quote.test.ts`), each email that states an amount (`lib/email/send.test.ts`), the messages of a new request (`post-creation-effects.test.ts`), the status-change payload (`status-change-effects.test.ts`) and the marketplace view (`marketplace-booking.db.test.ts`). No test covers the customer's deposit authorization page, the contract, the invoice fallback, nor the dashboard's two pages. Still in the store's current currency, on screen and in read answers only: the dashboard's reservation list, calendar and planning, and its customer page; the list, calendar, planning, upcoming and overdue answers of the API (`services/reservations.ts`, one currency per answer, set in `routers/dashboard/reservation-follow-up.ts`; `reservations.get` gives the reservation's own); the customer account's pages, which format every amount with the store's currency (`useFormatMoney`). Rows created before the column existed hold null and fall back to the store's current currency, as does a stored value that is no currency code: a store that changes currency would restate all of them, until a backfill writes the currency they were made in.

**M3. A price is a fact of the booking.** The unit price, its breakdown, the tax rate, the promotion and the promo code applied when the line was priced are stored on the reservation. Only an edit of that line reprices it, and then with every rule the first pricing used. An edit of something else, or a change of the store's or the product's settings, changes no amount of an existing reservation.
_Open._ An edit reprices through the seasonal engine alone and drops the product's promotion. The totals the dashboard writes are later read back with the store's current tax settings.

**M4. Money has one representation.** An amount is a whole number of the currency's minor units, or a decimal string with exactly the currency's digits, and it is rounded once, where it is computed. A currency without decimals has none anywhere.
_Open._ Prices are JavaScript numbers rounded to two decimals in several places, and Stripe amounts are converted apart: a 50 % promotion on ¥101 is ¥50.50 in Louez and ¥51 at Stripe.

**M5. A provider is asked once for one intent.** A charge, a hold, a capture or a refund is first recorded as an attempt under the reservation's lock, then sent with an idempotency key that is stable for that attempt. A retry after a lost answer finds the same provider object. A second caller finds the attempt and does not call.
_Partial._ The extension's checkout and refund follow it. The ordinary checkout and payment sessions, the deposit authorization and its capture, and the dashboard's refund send no key and record no attempt. Two deposit holds asked at once both go to the provider and both get a payment row, and the second overwrites the reservation's reference to the first; a hold the provider accepted but Louez failed to record is on the customer's card and nowhere in the database.

**M6. The balance is what is owed less what was received, in the reservation's currency.** A payment in another currency does not reduce it.
_Partial._ The statistics filter by currency (`services/sales-analytics.ts`). So do the payment request, the customer's payment session and the extension's paid check: they count a payment only when it is in the reservation's currency (`getSettledPaymentAmount` and `isRentalPaid` given that currency, `packages/utils/src/util.payment-movement.ts`). Only a Stripe payment states a currency of its own, since older rows recorded by hand kept the column's default, and a refund follows the payment it gives back. Tests cover the rule and its three callers (`util.payment-movement.test.ts`, `util.payment-request.test.ts`, `payment-session.db.test.ts`, `extension-quote.test.ts`). Still summing every payment whatever its currency: the dashboard's paid totals and payment summaries (`reservations-utils.ts`, `[id]/util.payment-refunds.ts`), the remaining amount a recorded payment is checked against (`recordPayment`), the customer account's paid amount and paid state, the API's reservation readers (`services/reservations.ts`) and the cancellation preview (`services/reservation-status.ts`). So the customer account can show as paid a reservation the payment session would still charge.

**M7. No more goes back than came in.** A refund never exceeds what its payment still holds, and a deposit return never exceeds the deposit received less what was already returned or captured. The check and the write are one step under the reservation's lock. A hold, its capture and its release are rows about the same provider intent.
_Partial._ Refunds of a Stripe payment are bounded by the payment. `returnDeposit` and the recorded payments check their limit before their transaction. The agents' `record_payment` (MCP and the in-app assistant) records a `deposit_return` with no limit at all.

## Status

**T1. One function changes a status, one inserts.** `changeReservationStatus` locks the row, checks the transition, moves consumable stock, dates `billableAt` and `withdrawnAt`, and writes the activity row. `insertReservation` is the application's only insert. `scripts/reservation-writes.test.mjs` fails on a write in another form ([Data layer, DL-12](../code-review/04-data-layer.md)); it reads syntax, exempts the seeds, and does not see the store-cloning script, the billing-date backfill or dynamic SQL.
_Held_ for application code.

**T2. The transitions are a fixed graph.** `pending` goes to `confirmed`, `rejected` or `cancelled`; `quote` to `confirmed`, `declined` or `cancelled`; `confirmed` to `ongoing` or `cancelled`; `ongoing` to `completed` or `cancelled`. Nothing leaves `completed`, `cancelled`, `rejected` or `declined`, and nothing enters `pending` or `quote` (`packages/db/src/consumable-stock.ts`).
_Held._

**T3. A completed reservation is not edited.** Its lines, dates and totals are what was rented.
_Partial._ `updateReservation` refuses it, before and under its lock. No test covers it, nor a completion that lands during an edit.

**T4. A reservation's number is unique in its store.**
_Open._ The dashboard numbers with a count of the year's reservations plus one, read with no lock; the online store draws a number and checks it before the insert, a race its own comment admits (`apps/web/lib/reservations/reservation-number.ts`). The table has no unique index on store and number.

**T5. A reservation's window is a real interval of the store's time.** The end is after the start, and a local date and time the customer or the store typed is one that exists in the store's time zone.
_Partial._ The extension checks the time zone round trip, nonexistent local times included. `updateReservation` refuses only an end before the start, so it accepts a window of no length.

**T6. Pickup follows the contract's rules.** Validating the contract and signing it are two steps (`services/reservation-contract-validation.ts`); a store that requires a signature refuses a pickup without one (`services/reservation-status.ts`).
_Held_ for the store's status changes.

## Promo codes

**P1. A promo code is used as often as its limit says.** Its validity, its limit and what it may combine with are checked when it is applied, and its use is counted in the booking's transaction.
_Partial._ The evaluation (`packages/api/src/services/promo.ts`) and the counting (`apps/web/lib/reservations/apply-promo-code.ts`) are separate steps. To review with the creation lot.

## Extensions

**X1. An extension holds stock while its checkout is live, and is applied only to the reservation it was quoted for.** A payment that completes against a reservation that changed since the quote, or whose stock is gone, is refunded and not applied (`extension-service.ts`).
_Partial._ The extension service does it; its tests replace the transaction with a mock, and none runs on a database.

## Concurrency

**C1. Locks are taken in one order.** The store row, then products by id, then reservations, then units by id ([Data layer, Lock order](../code-review/04-data-layer.md)). A path that still takes the reservation first retries a lost deadlock: `retryTransactionOnDeadlock` for the customer's and the payment's status changes, `retryOnceOnDeadlock` for the extensions and the unit assignment.
_Partial._ Every known path follows the order or retries. No test fails when a new path inverts it.

**C2. A write decides on what it reads under its locks.** Whatever it read before them it reads again, or it proves nothing changed, before its first write.
_Partial._ The checkout rechecks stock and required accessories under the product locks, and the store's status changes read everything under theirs. The manual creation decides its stock on what it reads under the product locks: the products, the store's availability rules and the combination each line chose. The checkout still takes those rules from a read made before its locks, and both still write the prices they read before locking. `updateReservation` computes before its locks too, then proves under them that nothing it read has changed (`fingerprintReservationEdit`), or refuses the edit. The recorded payments and deposit returns check their limits before their transaction (M7).

**C3. No effect runs inside a transaction that may run again.** A fee, an email, a notification or a provider call runs after the commit, once.
_Held_ for the paths listed under the lock order.

## Effects

**E1. A message that must not be lost is a row of the outbox, added in the write's transaction** ([The outbox](../architecture/api-and-agents.md#the-outbox)).
_Partial._ The store's status changes do. The messages of a new booking, and those of a customer's quote acceptance or cancellation, are sent after the commit from memory: a crash between the two loses them. The extension's messages have their own recoverable attempts, outside the outbox.

**E2. A write sent twice with the same idempotency key runs once.**
_Partial._ A procedure built on `storeProcedure` replays a recorded success and refuses a concurrent or unknown outcome (`runOperation`). A key whose call failed runs again, also when the handler threw after its commit; a procedure with a secret output ignores the key. The server actions that are not procedures yet have none.

## Measuring

Each rule about data at rest can be counted with a read-only query: totals against lines, reservations over the stock, holds per reservation, currencies, numbers used twice. Run the count on real data before and after a rule moves to held, to see that the writers stopped producing violations. Keep the figures out of this repository.

---

## Related

- [Glossary](glossary.md) — the domain's words
- [ADR 0005](../adr/0005-unit-status-three-dimensions.md) — lifecycle, downtime and operational state of a unit
- [ADR 0006](../adr/0006-canonical-availability-semantics.md) — the availability rule and who owns it
- [Data layer](../code-review/04-data-layer.md) — DL-12 (status and inserts), DL-13 (billing marks), lock order
- [API and agents](../architecture/api-and-agents.md) — procedures, idempotency, the outbox
