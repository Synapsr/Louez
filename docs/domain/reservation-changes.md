# Reservation changes

What changes a reservation once it exists: its status, changed by any actor, and its shape (dates, lines, prices, delivery), changed by the store's edit. This page specifies the lot that moves these writes to one service per kind of write in `packages/api`, on RPC, OpenAPI and MCP. It covers what the code does today, what has been decided, what stays open, the fixed rules, and the slices in their order. The rules every writer holds are in [Reservation invariants](reservation-invariants.md), and the words are in the [glossary](glossary.md).

Every sentence about the code is true at `origin/rental-core` 3b011bfc and cites where, except where slice 1 (section 7) changed the status writers' locks and slice 2 what a confirmation records: those sentences are true after them. A sentence that proposes is marked **Proposed**. Line numbers drift: when one no longer matches, search the quoted name.

Two standing rules frame every proposal:

1. **No dead end for the store on short capacity.** When a store-side write is refused because quantities are short (returnable stock, or the turnover buffer), the store can override it explicitly, and the override is recorded with the write. The two overrides are separate: `allowOverbooking` covers a capacity shortfall, and a buffer approval covers a buffer-only one. A physical conflict is never overridable: a unit held by two blocking reservations at once (S4), consumable stock below zero (S3), or a unit another booking's open choice needs (section 6). The store is never stuck, because it can record the booking without that unit, or with another one. A customer, a payment, the marketplace and the system never get an override.
2. **Fixed named rules, not settings.** Each business rule is one named function whose behaviour is what the code does today, unless this page decides otherwise. A setting exists only where one exists already (section 6).

## 1. The writers, as the code is today

`changeReservationStatus` (`packages/db/src/reservation-status.ts:277`) is under every status change. It runs only under a lock token of the owner entry (slice 1), and it locks the reservation row (`:286`), plans the change from the locked status (`planReservationStatusChange`, `:190`), and asks the card gate for a change into the billable set (`confirmed`, `ongoing`, `completed`) from outside it, unless the actor is `payment` (`requiresReservationGate`, `:155`; called at `:286`). It then runs the caller's `beforeWrite` (`:291`) and moves consumable stock (`:293`: `consume` from `pending` or `quote` to `confirmed`, `restore` from `confirmed` or `ongoing` to `cancelled` or `rejected`, `:180`). It writes the status and its dates, writes one activity row (`:314`) and marks the billing snapshot (`:320`). It returns the fee effects, and the caller runs them after the commit (section 4). Consumable stock locks the reservation's consumable products after the reservation (`packages/db/src/consumable-stock.ts:220`).

`checkExistingReservationInventory` (`packages/api/src/services/reservation-inventory.ts:672`) is the stock check of a change into `confirmed`. It reads the reservation's lines in a fixed order (`:684`), locks their products (`:708`) and runs `reserveInventory` with the turnover buffer and the required-accessory check, without the consumable check, and with `onShortfall: "collect"` (`:718`, `:729`; defaults `:185`). It then checks each held unit by id (`findReservationUnitConflicts`, `:731`). A unit's hard conflict throws `ReservationUnitConflictError` (`:738`). A failure of `reserveInventory` or any shortfall throws `ReservationInventoryError("errors.productNoLongerAvailable")` (`:742`): a shortfall counted with the buffer, or a missing required accessory. The unit check does not reject a buffer-only conflict: it returns those units as `turnoverBufferOnlyUnitIds` for the activity row. It also returns the capacity verdict of the demand it checked (`:750`, slice 2) and the date of the row that carries it (`:760`). A confirmation therefore succeeds only when the buffered capacity check also passes.

### Status writers

| Writer                                                                                                                                                                                                                                                                                                           | Actor recorded                                                                                                                                                                                                                                                                            | Transitions                                                                                                                                                                                          | Locks, in order                                                                                                                                                                                                                                                                                                                                                 | Isolation, retry                                                                                                                                                                                                                     | Stock check                                                                                                                                                                                                                                                                                | Card gate                                                                                | Writes besides the helper                                                                                                                                                                                                                                                                                                               | Effects                                                                                                                                                                                                                                                                                                                                                                                                           | Tests                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Store**: `changeStoreReservationStatus`, `packages/api/src/services/reservation-status.ts:472`, behind `reservations.updateStatus` and `reservations.cancel` (`routers/dashboard/reservation-follow-up.ts:311`, `:339`), the dashboard, OpenAPI, MCP and the in-app assistant (`apps/web/lib/ai/tools.ts:320`) | `store_user` for RPC, `mcp`, `api` (`:159`). The in-app assistant calls with transport `rpc` (`apps/web/app/api/chat/route.ts:180`), so its changes are recorded as `store_user`. The actor `ai_chat` exists (`packages/db/src/reservation-status.ts:36`), and no status writer passes it | the five of `STORE_TARGET_STATUSES` (`contracts/reservations.ts:707`): `confirmed`, `ongoing`, `completed`, `cancelled`, `rejected`, from whatever the graph allows                                  | products by id, then the reservation, then a check that no product joined meanwhile, through the owner entry (`runReservationChange`, `:434`). For a change into `confirmed` from `pending` or `quote`, the units it holds come last                                                                                                                            | READ COMMITTED; up to three runs on a deadlock or on a product added meanwhile, then `RESERVATION_BUSY` (`:536`)                                                                                                                     | `checkExistingReservationInventory`, no override (`:507`). Refusals: `RESERVATION_UNITS_UNAVAILABLE` (`:590`), `RESERVATION_ITEMS_UNAVAILABLE` (`:595`)                                                                                                                                    | asked before the confirmation (`:503`)                                                   | activity row with the rejection reason, `contractUnsigned` and booking-rule warnings (`:487`); for a confirmation, the capacity verdict and `turnoverBufferOnlyUnitIds` of its check, through `beforeWrite` (`:486`); contract validation (`:551`); date-change requests settled (`:552`); unsent customer messages superseded (`:556`) | outbox rows in the transaction (`:561`): customer message, store and platform notifications, analytics. After the commit: fee (`:613`); insurance contract attempted or cancelled (`:617`, `:620`); dispatch (`:628`). Confirmation (`requireConfirmation`) under the locks, before the first write, for a confirmation, a rejection or a cancellation (`:513`)                                                   | `packages/api/src/routers/dashboard/reservations.db.test.ts:837`–`:1764`; `apps/web/lib/reservations/status-change-races.db.test.ts` |
| **Customer accepts a quote**: `acceptQuote`, `apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/actions.ts:160`                                                                                                                                                                              | `customer`, activity `quote_accepted`                                                                                                                                                                                                                                                     | `quote → confirmed`                                                                                                                                                                                  | products by id, then the reservation (`runReservationChange`, `:200`); `checkExistingReservationInventory` locks the same products again in `beforeWrite`                                                                                                                                                                                                       | READ COMMITTED; three runs on a deadlock or a product added meanwhile, then `errors.tryAgain` (`:219`)                                                                                                                               | `checkExistingReservationInventory`, the same as the store's, no override. A refusal answers the stock error's key and names no unit                                                                                                                                                       | asked by the helper. A refusal answers the generic key with the store's contact (`:224`) | contract validation `quote_acceptance` (`:212`). No date-change requests to settle: a request exists only on `confirmed` or `ongoing` (`packages/validations/src/date-change-request.ts:22`)                                                                                                                                            | after the commit, from memory: payment session when the store is in payment mode (`:262`), then fee (`:278`), store notification (`:282`), and the customer's `customer_quote_accepted` with the contract and payment links (`:331`). No insurance contract is attempted: no call of `createTulipContractForReservation` or of the insurance port can be reached from this path (established by reading, no test) | `actions.test.mjs:171`–`:247` (mocked transaction); `status-change-races.db.test.ts:336`, `:641`                                     |
| **Customer declines a quote**: `declineQuote`, same file `:379`                                                                                                                                                                                                                                                  | `customer`, `quote_declined`                                                                                                                                                                                                                                                              | `quote → declined`                                                                                                                                                                                   | the reservation only (`runReservationOnlyChange`, `:415`; no stock moves)                                                                                                                                                                                                                                                                                       | READ COMMITTED, three runs, then `errors.tryAgain` (`:433`)                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                       | not asked (not into a billable status)                                                   | —                                                                                                                                                                                                                                                                                                                                       | after the commit: fee voided (`:431`), store notification (`:449`). The customer gets nothing                                                                                                                                                                                                                                                                                                                     | `actions.test.mjs:200`, `:247`–`:267`                                                                                                |
| **Customer cancels a request**: `cancelReservationRequest`, same file `:484`                                                                                                                                                                                                                                     | `customer`                                                                                                                                                                                                                                                                                | `pending → cancelled`. Refused while a Stripe payment that is not a deposit hold is pending (`:536`–`:544`). Refused without `acknowledgePayment` when a payment completed or is authorized (`:546`) | the reservation (`runReservationOnlyChange`, `:526`), then its payments                                                                                                                                                                                                                                                                                         | READ COMMITTED, three runs, then `errors.tryAgain` (`:578`)                                                                                                                                                                          | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | —                                                                                                                                                                                                                                                                                                                                       | after the commit: fee voided, insurance contract cancelled when one exists (`:574`), store notification (`:582`). The customer gets nothing                                                                                                                                                                                                                                                                       | `actions.test.mjs:279`, `:295`                                                                                                       |
| **Checkout replaces its own pending booking**: `supersedePendingCheckout`, `apps/web/lib/reservations/create-reservation.ts:856`                                                                                                                                                                                 | `customer`                                                                                                                                                                                                                                                                                | `pending → cancelled`                                                                                                                                                                                | inside the new checkout's transaction, which the owner entry opens (`runReservationTransaction`, `create-reservation.ts:981`), after the checkout locked its own cart's products: the reservation-only lock (`lockReservationOnlyInTransaction`, `:833`). The superseded reservation's products are not locked, and need not be (no stock moves from `pending`) | the checkout's: READ COMMITTED, three runs                                                                                                                                                                                           | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | cancels the superseded booking's open rental payments                                                                                                                                                                                                                                                                                   | its Stripe sessions are expired after the commit                                                                                                                                                                                                                                                                                                                                                                  | `checkout-status.db.test.ts:311`, `:343`                                                                                             |
| **Paid checkout**: `confirmPaidReservationOrThrow`, `apps/web/lib/reservations/complete-checkout-payment.ts:141`, from the customer's return and from the Stripe webhook                                                                                                                                         | `payment`                                                                                                                                                                                                                                                                                 | `pending → confirmed`                                                                                                                                                                                | several commits, listed below the table; in the status transaction, chosen from a plain read of the status (`runReservationChangeByStatus`, `:177`): products by id, then the reservation, when it is `pending` (the stock check and the stock taken) or `confirmed` (the repair below); the reservation alone otherwise, a no-op                               | READ COMMITTED; three runs, then it throws, so the webhook answers non-2xx and Stripe redelivers; the redelivery runs the confirmation again                                                                                         | `checkExistingReservationInventory`, no override. A refusal leaves the paid reservation `pending` and logs it (`:238`, `:242`). The code's comment says the merchant restocks and confirms from the dashboard (`:227`), but that confirmation runs the same check, with no override either | skipped (`actor: payment`)                                                               | payment details and `depositStatus` (`:152`, `:205`). When the reservation is already confirmed, its stock is consumed again, which changes nothing if it was taken (`:199`)                                                                                                                                                            | listed below the table. No insurance contract is attempted (by reading, as for `acceptQuote`)                                                                                                                                                                                                                                                                                                                     | `checkout-status.db.test.ts:200`–`:293`; `status-change-races.db.test.ts:348`, `:613`                                                |
| **Abandoned checkout**: `cancelAbandonedCheckout`, `apps/web/lib/reservations/cancel-abandoned-checkout.ts:22`, from the Connect webhook (`app/api/webhooks/stripe/connect/route.ts:620`)                                                                                                                        | `system`                                                                                                                                                                                                                                                                                  | `pending → cancelled`, `source = online` only. Refused under the lock while a rental payment is pending or completed (`:46`)                                                                         | the reservation (`runReservationOnlyChange`, `:40`), then a shared lock on its payments, read before the change                                                                                                                                                                                                                                                 | READ COMMITTED, three runs, then it throws and the webhook answers non-2xx; the redelivery skips it and the reservation stays `pending` (section 5)                                                                                  | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | —                                                                                                                                                                                                                                                                                                                                       | fee after the commit                                                                                                                                                                                                                                                                                                                                                                                              | `checkout-status.db.test.ts:385`–`:435`                                                                                              |
| **Failed checkout**: `cancelFailedCheckoutReservation`, `packages/db/src/failed-checkout.ts:16`, from the checkout and from `scripts/run-failed-checkout-cleanup.ts`                                                                                                                                             | `system`                                                                                                                                                                                                                                                                                  | `pending → cancelled`, `online`, no payment row                                                                                                                                                      | the reservation (`runReservationOnlyChange`, `:39`), then a read of its payments                                                                                                                                                                                                                                                                                | READ COMMITTED, three runs, then it throws `ReservationChangeBusyError`: the checkout logs it and answers `errors.createReservationError`, the script stops on it. Nothing runs it again                                             | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | `payment_failed` activity row before the change; calendar events requeued                                                                                                                                                                                                                                                               | fee after the commit                                                                                                                                                                                                                                                                                                                                                                                              | `checkout-status.db.test.ts:449`, `:514`; `packages/db/src/failed-checkout.test.mjs`                                                 |
| **Marketplace cancels**: `cancelMarketplaceBooking`, `packages/api/src/services/marketplace-booking.ts:1102`                                                                                                                                                                                                     | `marketplace`                                                                                                                                                                                                                                                                             | any status the graph lets into `cancelled` (`pending`, `confirmed`, `ongoing`)                                                                                                                       | chosen from a plain read of the status (`runReservationChangeByStatus`, `:1151`): products by id, then the reservation, for `confirmed` and `ongoing`, whose stock comes back; the reservation alone for `pending`, which gives none back                                                                                                                       | READ COMMITTED; three runs, then it throws                                                                                                                                                                                           | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | attempt marked `cancelled`                                                                                                                                                                                                                                                                                                              | after the commit, through the adapter: fee, pending payments released, cancellation side effects. The pending date-change requests of a confirmed booking are not settled (the store's path settles them; the inbox hides them by status)                                                                                                                                                                         | `marketplace-booking.db.test.ts:284`–`:400`                                                                                          |
| **Marketplace hold expires or its payment fails**: `expireAttempt` (`:1177`) via `expireMarketplaceBookingAttempts` (`:1201`, run lazily on a quote, a read or a list: `:354`, `:1037`, `:1071`), and `failMarketplaceBookingAttempt` (`:1238`, from the Connect webhook)                                        | `system`                                                                                                                                                                                                                                                                                  | `pending → cancelled` (`expectedFrom: pending`; a confirmed booking outlives its attempt)                                                                                                            | the reservation (`runReservationOnlyChange`), then the attempt row. The hold's replay expires its own lapsed attempt too (`holdMarketplaceBooking`, `:651`)                                                                                                                                                                                                     | READ COMMITTED, three runs; then the expiry skips it, and the next marketplace quote for the store, read of the booking or list of bookings runs the expiry again; the payment failure throws, and Stripe's redelivery runs it again | none                                                                                                                                                                                                                                                                                       | not asked                                                                                | attempt `expired`                                                                                                                                                                                                                                                                                                                       | fee after the commit                                                                                                                                                                                                                                                                                                                                                                                              | `marketplace-booking.db.test.ts:434`–`:657`                                                                                          |

The paid checkout (`runCheckoutPaymentCompletion`, `complete-checkout-payment.ts:300`) commits in separate steps, in this order:

1. **Payment claim**, its own commit (`claimCompletedCheckoutPayment`, `:338`): once per reservation and session, whichever of the webhook and the customer's return comes first.
2. **Contract validation** `payment`, its own transaction (`:362`).
3. **Marketplace attempt confirmed**, for a marketplace booking (`confirmMarketplaceBookingAttempt`, `:366`). This happens before the status transaction, so an attempt can be `confirmed` while its reservation stays `pending` after a stock refusal.
4. **Invoice** generated for the payment (`:377`). For a claimed payment: a `payment_received` activity row, and the store's payment notifications sent from memory (`:379`–`:411`).
5. **Payment details** written on the pending row outside any transaction (`:152`), then the **status transaction** (`:177`) with its stock check. A refusal is logged, and the reservation stays `pending` (`:238`, `:242`). The refusal is `ReservationInventoryError` (a unit conflict included, `reservation-inventory.ts:571`) or `ConsumableStockError`.
6. **After a confirmation**, from memory: the store's confirmation notifications (`:486`), the invoice attachments and contract signature link prepared (`:496`), the customer's `customer_reservation_confirmed` (`:497`), and calendar sync queued (`:544`).

No hand-written MCP tool writes a status: `packages/mcp/src/tools/` holds calendar, customers and payments only. The marketplace's holds create a booking through the checkout's `createReservation` (`marketplace-booking.ts:700`) and change no status.

Where the status writers differ:

- **Lock order.** Since slice 1 every status writer locks through the owner entry: products, then the reservation, or the reservation alone for those that move no stock. They no longer differ.
- **Override.** No status writer can book over returnable stock. The store's dashboard creation and edit can (S3), the edit only on products whose demand it raises.
- **What a confirmation records.** Since slice 2, every confirmation that checks the stock writes the verdict of its check on its activity row, as the dashboard's creation and edit do (`apps/web/app/(dashboard)/dashboard/reservations/actions.ts:1077`, `:2886`), next to `turnoverBufferOnlyUnitIds`. They no longer differ.
- **Required accessories.** The dashboard's creation and edit skip them (`actions.ts:942`, `:2872`), and every confirmation checks them (`reservation-inventory.ts:185`). So a quote the store typed without a required accessory is refused as "no longer available" at every confirmation, by the store, the customer and the payment alike. So is a request whose accessory line the store removed.
- **Effects.** The store's changes queue outbox rows in their transaction. The customer's, the payment's and the marketplace's send from memory after the commit (E1).
- **Insurance.** The store's confirmation attempts the Tulip contract through `ports.insurance.createContract` after the commit (`reservation-status.ts:617`). The attempt may be skipped or fail, a past start included: `tulipContractStatus` is set to `failed` and the error `errors.tulipContractPastDate` is raised (`apps/web/lib/integrations/tulip/contracts.ts:725`–`:732`). The warning comes back in the store's answer. The customer's acceptance and the paid confirmation attempt none (by reading).
- **Date-change requests.** The store's changes settle them; the marketplace's cancellation does not.

### Shape writers

| Writer                                                                                                                                                                                                                                                                                                                                                            | What it changes                                                                                                  | Locks, isolation, retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Stock check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Writes                                                                                                                                                                                                                               | Effects                                                                                                                     | Tests                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Store edit**: `updateReservation`, `apps/web/app/(dashboard)/dashboard/reservations/actions.ts:1780`. Reached through the legacy `dashboardProcedure` `reservations.updateReservation` (`packages/api/src/routers/dashboard/reservations.ts:153`), which calls the server action the app injects (`context.dashboardReservationActions`); not on OpenAPI or MCP | dates, lines, prices, deposit, insurance, delivery                                                               | prices and totals come from plain reads before the transaction (`:1830`–`:2525`). It then locks the products of existing and submitted lines (`:2553`), the reservation and its units. Under the locks, it refuses the edit when a field of `fingerprintReservationEdit` changed (`:2596`; `apps/web/lib/reservations/util.reservation-edit.ts:43`): status, dates, amounts, insurance, and each line's id, product, quantity, prices, deposit and breakdown. Not covered: product pricing and configuration, store settings, a line's chosen attributes and combination, assignments, delivery addresses. READ COMMITTED; `retryTransactionOnDeadlock` (`:2549`) | runs on a reservation that holds stock, when the edit moves demand (`compareReservationDemand`, `util.reservation-edit.ts:134`): `reserveInventory` with `onShortfall: "collect"`, no consumable or accessory check, the buffer left out with `overrideTurnoverBuffer` (`:2867`). Without `allowOverbooking`, a shortfall refuses the edit only on a product whose demand the edit raised (`:2878`). Every shortfall is recorded in the verdict (`update-reservation.db.test.ts:475`). When the dates move, held units are checked by id: a hard conflict is refused, and a buffer-only conflict is refused unless `overrideTurnoverBuffer` (`:2787`) | items in place; consumables reconciled for `confirmed`/`ongoing` (`:2964`); totals; billing mark (`:2998`); `modified` activity row with the capacity verdict (`:3035`); contract validation; date-change requests settled (`:3001`) | after the commit: Tulip contract sync (`:3056`), revalidation, modification email when asked (`:3089`), analytics (`:3110`) | `update-reservation.db.test.ts:336`–`:864` |
| **Customer's return-date request**: `requestReturnDateChange`, `.../[reservationId]/date-change-actions.ts:24`                                                                                                                                                                                                                                                    | writes a request in the activity under the reservation's lock, never the dates; only on `confirmed` or `ongoing` | the reservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | activity row                                                                                                                                                                                                                         | —                                                                                                                           | —                                          |
| **Extension**: `apps/web/lib/reservations/extension-service.ts`, `extension-quote.ts`                                                                                                                                                                                                                                                                             | the end date and totals, after a paid supplement                                                                 | the reservation (`extension-quote.ts:53`), then products (`:176`, `:301`), then units. READ COMMITTED; `retryOnceOnDeadlock` (`extension-service.ts:46`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `reserveInventory` with the buffer and the accessory check, no override; units by id, buffer included (`extension-quote.ts:181`–`:239`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | items, end date, totals; settles date-change requests (`extension-service.ts:79`–`:89`)                                                                                                                                              | its own recoverable attempts                                                                                                | mocked transaction only (X1)               |

Which statuses can be edited depends on the path:

- `updateReservation` refuses only a `completed` reservation (`actions.ts:1806`).
- The edit context the page opens refuses `completed`, `cancelled` and `rejected`, but allows `declined` (`packages/api/src/services/reservation-edit-context.ts:16`).
- A call that bypasses the page can also edit a cancelled or rejected reservation, since the fingerprint only requires the status to be unchanged.

When submitted lines are not empty, they replace the lines left out. An empty list takes the unchanged-lines branch (`actions.ts:1898`).

The edit's total is `subtotal + delivery − discount` (`:2525`), without the tax engine. It reprices a line through `calculateSeasonalAwarePrice` alone (`:1980`, `:2128`), without the product's promotion that the checkout applies (`apps/web/lib/reservations/price-cart.ts:126`, `packages/api/src/services/pricing-catalog.ts:286`).

The unit assignment (`assignUnitsToReservationItem`, `actions.ts:4637`) locks the reservation, then the product, then the units, and retries once (`:5038`). It checks stock twice:

- Without the buffer first. A shortfall answers `errors.insufficientCapacity`, with no override (`:4879`): another booking's open choice needs the unit.
- Then with the buffer. A shortfall answers `errors.turnoverBufferConflict` unless `overrideTurnoverBuffer` (`:4884`, `:4967`).

The override is written nowhere: `reservation_item_units` has no column for it (`packages/db/src/schema.ts:3290`), and the unit event's payload holds only the reservation and the line (`actions.ts:4684`). The assignment deletes every assignment of the line and inserts the selected units with new ids, including the units it keeps (`:5019`, `:5023`). Deleting a unit sets its assignments' `product_unit_id` to null (`schema.ts:3321`). The product page's move to another unit (`apps/web/app/(dashboard)/dashboard/products/[id]/actions.ts:345`, `:421`) behaves the same.

**A writer outside this lot.** Product and variant configuration can rewrite the combination keys of booked lines. `syncProductCombinationKeys` (`packages/api/src/services/variant-axes.ts:152`) rekeys `reservation_items.combination_key` when a product's booking axes change (`services/products.ts:1317`), and so does withdrawing a variant from the store (`removeVariantFromStoreProducts`, `variant-axes.ts:209`, `:265`). That writer stays out of this lot. Any approval or confirmation bound to a line's choice must treat a rekeyed line as changed (slices 5a, 12).

## 2. The state table

The graph is `packages/db/src/consumable-stock.ts:36` (T2). The columns are:

- **Who** may make the change.
- **Preconditions**: what must hold.
- **Checked under**: which locks the check runs under.
- **Written**: what is written besides the status, dates, activity and billing mark, which the helper always writes.
- **Effects**: what goes out.
- **State**: **Today** means the code does it the same way for every writer that may make the change. **Differs** means writers disagree, and how. **Decided** points to section 3, and **Stated** to section 4.

| Change                  | Who                                                                                                                                                                                                            | Preconditions                                                                                                                        | Checked under                                                                                         | Written                                                                                                                           | Effects                                                                                                                                                                                                                | State                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending → confirmed`   | store (session, key, agent, assistant); payment                                                                                                                                                                | buffered capacity and held units (a buffer-only unit conflict alone refuses nothing); card gate unless payment; required accessories | store and payment: products, reservation, units                                                       | consumables taken; the capacity verdict and buffer-only units. Store: rule warnings. Payment: payment details and `depositStatus` | store: outbox (`customer_request_accepted`, notifications, analytics), fee, insurance contract attempted. Payment: the steps of section 1, from memory, no insurance attempt, no fee (section 4)                       | **Differs**: outbox vs memory; insurance; the payment's separate commits. Neither writer can book over the stock: a paid request that lost its stock stays `pending`, with no way out but freeing stock (slice 4). Accessories are checked again although the checkout checked them (slice 3). |
| `pending → rejected`    | store                                                                                                                                                                                                          | none                                                                                                                                 | products, reservation                                                                                 | rejection reason                                                                                                                  | outbox (`customer_request_rejected`, supersedes an unsent acceptance)                                                                                                                                                  | **Today**                                                                                                                                                                                                                                                                                      |
| `pending → cancelled`   | store; customer (no pending Stripe payment other than a deposit hold; acknowledged when paid or authorized); checkout supersede; system (abandoned, failed, marketplace expiry or failed payment); marketplace | per writer, as in section 1                                                                                                          | store and marketplace: products, reservation. Others: the reservation alone, then payments or attempt | supersede: open payments cancelled. Failed: `payment_failed` row                                                                  | store: outbox (`customer_reservation_cancelled`). Customer: store notified from memory, customer nothing. System, marketplace: customer nothing                                                                        | **Differs** on effects. The customer hears of a store's cancellation and nothing of the system's: a decision of 2026-11-08 ([API and agents](../architecture/api-and-agents.md#ports)).                                                                                                        |
| `quote → confirmed`     | store; customer                                                                                                                                                                                                | buffered capacity and held units; card gate; required accessories; contract validated (`quote_acceptance` for the customer)          | store and customer: products, reservation, units                                                      | consumables taken                                                                                                                 | store: outbox `customer_request_accepted`, insurance contract attempted. Customer: from memory, `customer_quote_accepted` with contract and payment links; payment session first in payment mode; no insurance attempt | **Differs**: effects, insurance. **Decided** (D1): a quote the store created over the stock stays refused to the customer while the shortfall lasts; the store confirms it (slice 4).                                                                                                          |
| `quote → declined`      | customer                                                                                                                                                                                                       | none                                                                                                                                 | reservation                                                                                           | —                                                                                                                                 | store notified from memory                                                                                                                                                                                             | **Today** (the store cannot decline; it cancels)                                                                                                                                                                                                                                               |
| `quote → cancelled`     | store                                                                                                                                                                                                          | none                                                                                                                                 | products, reservation                                                                                 | —                                                                                                                                 | outbox `customer_reservation_cancelled`                                                                                                                                                                                | **Today**                                                                                                                                                                                                                                                                                      |
| `confirmed → ongoing`   | store                                                                                                                                                                                                          | contract signed when `contractSignatureMode` is `required` (T6)                                                                      | products, reservation                                                                                 | `pickedUpAt`; `contractUnsigned` when handed over unsigned                                                                        | outbox: store notifications, analytics; no customer message                                                                                                                                                            | **Today**; all or nothing (section 4)                                                                                                                                                                                                                                                          |
| `confirmed → cancelled` | store; marketplace                                                                                                                                                                                             | none                                                                                                                                 | store and marketplace: products, reservation                                                          | consumables restored; `withdrawnAt`                                                                                               | store: outbox, insurance cancelled. Marketplace: adapter after the commit; date-change requests left pending                                                                                                           | **Differs**: date-change requests                                                                                                                                                                                                                                                              |
| `ongoing → completed`   | store                                                                                                                                                                                                          | none                                                                                                                                 | products, reservation                                                                                 | `returnedAt`; consumables kept                                                                                                    | outbox: store notifications, analytics                                                                                                                                                                                 | **Today**; all or nothing (section 4)                                                                                                                                                                                                                                                          |
| `ongoing → cancelled`   | store; marketplace                                                                                                                                                                                             | none                                                                                                                                 | as `confirmed → cancelled`                                                                            | consumables restored, although handed over                                                                                        | as `confirmed → cancelled`                                                                                                                                                                                             | **Differs** as above. **Stated** (section 4)                                                                                                                                                                                                                                                   |

## 3. Decisions

Taken by the program's operator after review, for this lot.

**D1. A customer cannot accept a quote the store created over the stock while the shortfall lasts.** The acceptance is refused as today. The store confirms the quote itself, with the override of slice 4.

- Reason: carrying the store's approval into the customer's acceptance needs approval evidence bound to the quote's revision and its canonical demand. It also needs an exact "no worse" comparison per demand identity, over time segments. Neither exists:
  - shortfalls are per line;
  - a pooled line's shortfall has `combinationKey: null` (`reservation-inventory.ts:478`);
  - a quote edit writes no fresh verdict, because a quote does not hold stock, so it skips the edit's stock check (`actions.ts:2856`).
- Strongest objection: the store already decided, and the customer's acceptance fails on a decision that is not theirs. The answer is that a comparison of aggregate shortfalls would let a new problem through. An approved shortage of 1 on size M, with M freed and L short by 1, gives an equal aggregate and an unapproved shortage on L.
- Possible later slice, not in this lot: approval evidence bound to the quote's revision and to stable demand identities, compared per time segment.

**D2. API keys and agents may book over the stock.** The owner delegates that authority when granting write access. A call with `allowOverbooking` always asks for confirmation (`requireConfirmation({ always: true })`). Its preview lists every shortfall, and its token is bound to the current verdict (slice 4). The credential is recorded on the activity row.

- What this proves: the caller saw the preview, not that a human approved it. The same agent can send both calls (`packages/api/src/platform/confirmation.ts:40`).
- Strongest objection: an unattended agent could approve shortages again and again while it optimises bookings. A store that wants a human in the loop withholds write access until owner hand-offs exist.

**D3. An unapproved buffer-only conflict on a held unit does not refuse a customer's or a payment's confirmation.** It is named in the activity row, and the inbox lists it until the store approves or reassigns (slice 5b). The buffered capacity check still runs and can still refuse such a confirmation (section 1). Neither writer is promised acceptance.

- Strongest objection: the buffer may be needed for cleaning or charging, so accepting it may promise what the store cannot deliver. The inbox item is how the store learns of it before pickup.

**D4. The quote-acceptance message links to the reservation's page in the customer account, which shows the current balance and opens the payment.** No message sender opens a Stripe session.

- Reason: `createReservationPaymentSessionForCustomer` opens a new session on every call (`apps/web/lib/reservations/payment-session.ts:33`), so a sender retrying from the outbox would leave orphan sessions.
- Strongest objection: a delayed message read on another device adds a sign-in, and the page shows the current amount, which may differ from the quote the customer accepted.
- Ordering: while the acceptance itself still opens a session, the session-before-fee order stays (`.../actions.ts:262`, `:278`). A page link does not make that session idempotent.

## 4. Decided as today, stated

Each rule below is what the code does today. Every slice preserves it unless the rule names the slice that changes it.

- **The customer's actions and replays.** Today a replay after a success gets `invalidStatus` (`acceptQuote`, `.../actions.ts:187`, `:235`). So does a retry of a call that committed and then lost its answer. **Changed by slice 6a**: the customer's accept, decline and cancel become replayable per customer, action and reservation, and a replay returns the first outcome.
- **A deposit-hold attempt is never erased.** It keeps its amount, currency and card, and can still be reconciled (`claimAttempt`, `apps/web/lib/reservations/deposit-hold.ts:409`; M5). This holds through a cancellation, an edit and a completion: none of them deletes or closes it.
  - Today the paid confirmation writes `depositStatus` directly (`complete-checkout-payment.ts:157`, `:205`), and can overwrite what the hold writer settled meanwhile.
  - **Changed by slice 6a**: the paid confirmation leaves alone a `depositStatus` that the hold writer (`settleDepositIntent`) has moved past `pending`/`card_saved`.
- **Cancelling while equipment is out.** `ongoing → cancelled` restores consumables and stops blocking stock (`stockAction`, `packages/db/src/reservation-status.ts:180`; the blocking statuses), although the units may still be physically out. Kept as today. Flagged as a product question for the owner, outside this lot: whether a cancellation after pickup should wait for a return.
- **Pickup and return are all or nothing.** A reservation has one `pickedUpAt` and one `returnedAt` (`packages/db/src/schema.ts:1788`, `:1789`), and no per-unit fulfilment. `completed` releases every line at once. Returning one bike of two is recorded by the edit (a line changed), not by a status.
- **Past dates.** The store can always record a past rental. Its confirmation records booking-rule warnings and refuses nothing for the dates (`services/reservation-status.ts:520`). Insurance refuses a past start (`tulip/contracts.ts:732`): the reservation's `tulipContractStatus` becomes `failed` and the store's answer carries the warning. This uninsured outcome is visible to the store. For the customer's and the payment's confirmations it becomes visible with slice 6c.
- **Billing marks and fees per transition.** Every status change marks the billing snapshot (`reservation-status.ts:320`), and so does the edit (`actions.ts:2998`). The fees are in the table below. Every slice preserves both, along with the marketplace's fee flag, the Connect webhook's fee collection, and the quote acceptance's session-before-fee order. A test covers the race where a confirmation is followed by a cancellation before the confirmation's fee is recorded (the runner voids it, `apps/web/lib/billing/reservation-effects.ts:132`): `apps/web/lib/billing/reservation-effects.db.test.ts`, "a record that runs after the cancellation that followed it writes nothing".

| Change                                                                 | Fee effect                                                                          | Where                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| into `confirmed` from `pending` or `quote`, by any actor but `payment` | records a fee (`marketplace: true` for a marketplace booking)                       | `packages/db/src/reservation-status.ts:214` |
| into `confirmed` by `payment`                                          | none: the Connect webhook records the paid checkout's fee with the collected amount | `:213`                                      |
| `confirmed → ongoing`, `ongoing → completed`                           | none (stays in the billable set)                                                    | `:209`                                      |
| into `cancelled`, `rejected` or `declined`, from any status            | voids the reservation's fees                                                        | `:224`, `:148`                              |
| an edit                                                                | none; billing mark only                                                             | `actions.ts:2998`                           |

## 5. Open, not in this lot

- **Consent to the quote's latest revision.** The customer accepts whatever the quote holds under the lock (`acceptQuote`, `.../actions.ts:200`). Nothing proves the customer saw that revision's price.
- **Signed contracts and issued invoices after an edit.** Contract validation returns at once when the reservation is already validated, and never invalidates a signature (`packages/api/src/services/reservation-contract-validation.ts:23`). An edit that changes dates, lines or amounts leaves the signed contract and the issued invoice as they were. Amendment, re-signature and document versions are not decided.
- **An expired checkout whose cancellation fails is never cancelled.** The Connect webhook's `checkout.session.expired` commits the session's pending payment as cancelled first, then cancels the abandoned checkout (`apps/web/app/api/webhooks/stripe/connect/route.ts:585`–`:625`). When that cancellation throws (a busy reservation, as a lost deadlock before slice 1), the webhook answers 500 and Stripe sends the event again; the redelivery reads the cancelled payment, concludes the checkout was not abandoned, and skips the cancellation. The reservation stays `pending`, holding its stock while `pendingBlocksAvailability` is on, until the store cancels it. It is so on `rental-core` before slice 1 too.
- **Outstanding payment sessions and extension checkouts after an edit.** An edit can change the balance while an older Stripe session can still be paid, or while an extension checkout is live. A late payment, the changed balance and a stale extension plan are not handled. Until this is decided, slice 12's preview warns when a payment session or an extension checkout is outstanding.

## 6. The fixed rules

Each is one named function or one existing setting. None becomes a new setting in this lot.

| Rule                                   | Lives in                                                                                            | Behaviour                                                                                                                                                                                                                             | Changed by                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Transition graph                       | `packages/db/src/consumable-stock.ts:36`                                                            | T2                                                                                                                                                                                                                                    | —                                                  |
| Card gate                              | `requiresReservationGate`, `packages/db/src/reservation-status.ts:155`                              | asked for an entry into the billable set, except by `payment`                                                                                                                                                                         | —                                                  |
| Blocking statuses                      | setting `pendingBlocksAvailability` (exists)                                                        | `confirmed`, `ongoing`, and `pending` unless turned off                                                                                                                                                                               | —                                                  |
| Marketplace hold validity              | `buildReservationAvailabilityPredicate`, `packages/db/src/unit-availability.ts:113`                 | a pending marketplace booking whose hold expired blocks nothing. It depends on the persisted source and attempt, not on the actor: a store actor can act on a marketplace booking                                                     | —                                                  |
| Live extension hold                    | `reservationAvailabilityEndSql`, `unit-availability.ts:46`                                          | a reservation blocks to the end that a live extension checkout holds. It depends on the persisted attempt, not on the actor                                                                                                           | —                                                  |
| Turnover buffer                        | setting `turnoverBufferMinutes` (exists)                                                            | `0` by default                                                                                                                                                                                                                        | —                                                  |
| Capacity override (`allowOverbooking`) | one function per actor                                                                              | store session: on creation and edit. Refused for customer, payment, marketplace and system                                                                                                                                            | slice 4 (store confirmation); D2 (keys and agents) |
| Buffer approval                        | stored approval, per unit or per line                                                               | store-side only, per call; never a setting                                                                                                                                                                                            | slices 5a, 5b                                      |
| Physical conflicts                     | `findReservationUnitConflicts`; consumable stock; the assignment's strict check (`actions.ts:4879`) | never overridden                                                                                                                                                                                                                      | —                                                  |
| Edit's demand rule                     | `compareReservationDemand`, `actions.ts:2878`                                                       | only a shortfall on a product whose demand the edit raised refuses the edit; every shortfall is recorded                                                                                                                              | —                                                  |
| Editable statuses                      | the edit's guard and the edit context                                                               | today: inconsistent (section 1)                                                                                                                                                                                                       | slice 8a                                           |
| Customer cancellation                  | `cancelReservationRequest`                                                                          | `pending` only. Refused while a non-deposit-hold Stripe payment is pending, and without acknowledgment when a payment completed or is authorized                                                                                      | —                                                  |
| Required accessories                   | `checkExistingReservationInventory`                                                                 | checked at every confirmation                                                                                                                                                                                                         | slice 3: checked where a cart is composed          |
| Stock on cancellation                  | `stockAction`, `reservation-status.ts:180`                                                          | consumables come back from `confirmed` and `ongoing`                                                                                                                                                                                  | — (section 4)                                      |
| Money on cancellation                  | `reservation-status.ts:105`                                                                         | The store's status cancellation itself neither refunds nor releases money (`refundedAutomatically: false`); the marketplace's cancellation additionally releases pending payments through its adapter (`marketplace-booking.ts:1102`) | —                                                  |
| Signature before pickup                | setting `contractSignatureMode` (exists)                                                            | as set; enforced by the only path that picks up                                                                                                                                                                                       | —                                                  |

No channel-scoped rule is proposed. Every rule that seems to depend on the channel depends on persisted facts (source, attempt) or on the actor.

## 7. Slices

### Order

Each slice is one decision and one pull request, in this order. Each changes this page and [Reservation invariants](reservation-invariants.md) in the same pull request. Slice 13 is independent and can land at any point.

| Id  | Decision                                                          | Depends on | Migration                         | API / MCP                                                 | Invariants                                    |
| --- | ----------------------------------------------------------------- | ---------- | --------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| 1   | One lock function for every status change                         | —          | none                              | none                                                      | C1 Held for status changes                    |
| 2   | A confirmation records the verdict it checked                     | 1          | none                              | none                                                      | S3's inbox clause true of confirmations       |
| 3   | Required accessories checked where a cart is composed             | 1          | none                              | none                                                      | S2 text; a dead end removed                   |
| 4   | The store may confirm over its returnable stock                   | 2          | none                              | `reservations_update_status` gains `allowOverbooking`     | S3 Held for confirmations                     |
| 5a  | Buffer approval: storage and lifecycle                            | 4          | additive (shape chosen in the PR) | approval action                                           | S4 "still open" paragraph, storage part       |
| 5b  | Buffer approval: confirmation and inbox                           | 5a         | none                              | inbox type `unit_buffer_conflict`                         | S4 closed                                     |
| 6a  | Status services, one entry per actor                              | 1          | none                              | none                                                      | C1, C3; replay and deposit rules of section 4 |
| 6b  | Durable messages for every status writer                          | 6a         | none (`api_effects` exists)       | none                                                      | E1 Held for status changes                    |
| 6c  | Insurance attempted at the customer's and payment's confirmations | 6a         | none                              | none                                                      | —                                             |
| 7   | `updateReservation` moves to `packages/api`, behaviour preserved  | 6b         | none                              | RPC only, sessions only                                   | none change                                   |
| 8a  | Editable statuses                                                 | 7          | none                              | `RESERVATION_NOT_EDITABLE`                                | T3 Held for edits                             |
| 8b  | A real window                                                     | 7          | none                              | `RESERVATION_WINDOW_INVALID`                              | T5 Held for edits                             |
| 9   | Booking pricing facts preserved                                   | 7          | additive where a fact is missing  | none                                                      | M3 Open → Partial                             |
| 10  | Edit totals from the tax engine, under the locks                  | 9          | none                              | output shape unchanged                                    | M1 Held for edits                             |
| 11  | Repricing keeps promotion and tax facts                           | 10         | none                              | none                                                      | M3 Partial                                    |
| 12  | The edit exposed to the API and agents                            | 8a, 8b, 11 | none                              | `reservations_update`, `POST /reservations/{id}`          | E2 for edits                                  |
| 13  | Storefront availability on the allocator                          | —          | none                              | `check_availability` and calendar figures match the write | S1 Held, within the rule's own limits         |

Do not bundle:

- **Slice 1 with any behaviour change.** It reorders locks only. Mixed with a new check, a race failure could not be attributed.
- **Slices 4 and 5a/5b.** Two overrides, two refusal codes, two traces: a reviewer must see each alone against S3 and S4.
- **5a with 5b.** First the approval is written and invalidated correctly; only then does a confirmation trust it.
- **6a, 6b and 6c.** Moving the services, making the messages durable, and adding insurance are three behaviours with three rollbacks.
- **Slice 7 with 8a, 8b, 9, 10 or 11.** The move must keep every existing test passing unchanged. A move that also reprices cannot be checked against today's behaviour.
- **Slice 12 before 8a, 8b and 11.** Otherwise agents get edits of terminal statuses and the known pricing defects.
- **6b with the new booking's messages.** Those change `createReservation` and `createManualReservation`, which belong to the creation lot.
- **Slice 13 with anything.** It changes figures that every storefront page shows, and needs a measurement first.
- **Producer before consumer.** A slice that emits a new outbox payload variant ships the consumer first. Old consumers must accept or ignore the new variant before any producer emits it.

### 1. One lock function

**Done.** Every status change takes its locks through one owner entry, in the lock order, at READ COMMITTED, with one bounded restart rule. Nothing else changed but lock order, isolation and retries.

**Defect, before it.** Three paths locked the reservation in the helper, then the products, and retried a lost deadlock (`retryTransactionOnDeadlock`): the customer's acceptance, the paid confirmation (its already-confirmed repair branch included) and the marketplace's cancellation when it restored consumables. Only the store's change retried on a product added meanwhile. The failed checkout, the abandoned checkout, the marketplace's expiry and the checkout itself ran at the connection's default isolation, with no retry. No test failed when a new path inverted the order.

**The entries.** They live in `packages/db`, with the token types and the restart signal (`ReservationProductsChangedError` moved there from `packages/api`). `packages/api` and `apps/web` call them; no `packages/db → packages/api` dependency was added.

- **The owner entry**, `runReservationTransaction(work)` (`packages/db/src/reservation-change.ts:78`). It opens the transaction itself at READ COMMITTED and gives `work` an owner token, which only it creates and which ends with its transaction, committed or rolled back. On a lost deadlock, `ReservationProductsChangedError`, or a status changed under `runReservationChangeByStatus`, it rolls back and runs the whole transaction again, three runs in all, then throws `ReservationChangeBusyError`. `runReservationChange(scope, work)` (`:111`) is that entry with the products' lock taken first; `runReservationOnlyChange(scope, work)` (`:125`) with the reservation-only lock. `runReservationChangeByStatus(scope, needsProducts, work)` (`:160`) reads the status plainly, takes the products' lock when `needsProducts(status)`, the reservation's alone otherwise, and gives `work` the status read under the lock; when the reservation-only lock finds another status than the one read, the run starts over from the read, within the same three runs.
- **Which lock.** A change that moves stock or runs a stock check takes the products' lock; a change that moves none takes the reservation's alone, as it took no product lock before this slice. The products' lock: the customer's acceptance, the paid confirmation of a `pending` or `confirmed` reservation, the marketplace's cancellation of a `confirmed` or `ongoing` booking, and the store's change, which took them for every change before this slice and still does. The reservation alone: the customer's decline and cancellation, the paid confirmation of any other status (a no-op), the marketplace's cancellation of a `pending` booking, its expiry and failed payment, the abandoned and the failed checkout, the checkout replacing its pending booking. Taking the products to cancel a `pending` marketplace booking would deadlock it against a hold retry: the retry holds the attempt row while its checkout's own transaction waits for the products, a wait in JavaScript that MySQL cannot see, which ends in a lock wait timeout that nothing retries.
- **The transaction-level entries**, `lockReservationInTransaction(owner, scope)` and `lockReservationOnlyInTransaction(owner, scope)` (`packages/db/src/reservation-lock.ts:228`, `:256`), for a transaction that composes a change with other writes: they take the owner token, so they cannot run in a transaction the owner entry did not open. The first locks the reservation's products by id, then the reservation, then reads the product set again and throws the restart signal when a product joined, which reaches its owner. The second locks the reservation alone.
- **The tokens** (`ReservationLock`, `reservation-lock.ts:95`). The module records, when it issues a token, its transaction, its store, its reservation and its kind, and every check reads that record (`assertReservationLock`, `:299`), never the token's own fields; an issued token is frozen too, so its fields cannot be rewritten. A token made by hand, copied or wrapped is not one the module issued, and is refused. A class with a private member makes them nominal: no object literal type-checks as one. A `products` token allows any status change. A `reservation` token allows only a change that moves no stock and runs no `beforeWrite`: `changeReservationStatus` throws `ReservationLockError` otherwise, before the card gate and before anything is written (`packages/db/src/reservation-status.ts:312`). `restoreReservationStock` takes a `products` token, `consumeReservationStock` a `products` token or the `inserted` token of `insertReservation`.
- **What a token guarantees at run time, and what it does not.** A token of the owner entry (`products`, `reservation`, and an `inserted` token issued in its transaction, as the checkout's) is refused once its transaction ends, committed or rolled back, and in any other transaction. An `inserted` token issued in a transaction the owner entry did not open (the dashboard's creation, `apps/web/app/(dashboard)/dashboard/reservations/actions.ts:956`, whose transaction, isolation and retry this slice leaves as they were) cannot be closed by the entry: nothing tells the module when that transaction ends, so it is valid there by convention only, and its one use is the stock taken right after the lines are inserted (`:1084`). Every `inserted` token allows that one use, once: `consumeReservationStock` for its own reservation, then it is spent, so a token kept past it allows nothing. The registry guards against a caller's mistake, not against code running in the process: a token proves what the module issued, not that the caller still holds the rows it locked.

**Callers.**

| Caller                                                            | Entry, token                                                                                                                                                                          | When the runs are exhausted, and what runs the change again                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the store's change, `changeStoreReservationStatus`                | `runReservationChange` (`packages/api/src/services/reservation-status.ts:434`)                                                                                                        | `RESERVATION_BUSY` (retryable), as before; the store tries again                                                                                                                                        |
| the customer's acceptance, `acceptQuote`                          | `runReservationChange` (`.../[reservationId]/actions.ts:200`); it reads the status first and goes on only for a `quote`, whose acceptance takes stock and checks it                   | `errors.tryAgain`, nothing written; the customer tries again                                                                                                                                            |
| the customer's decline and cancellation                           | `runReservationOnlyChange` (`:415`, `:526`)                                                                                                                                           | `errors.tryAgain`, nothing written; the customer tries again                                                                                                                                            |
| the paid confirmation, `confirmPaidReservationOrThrow`            | `runReservationChangeByStatus` (`apps/web/lib/reservations/complete-checkout-payment.ts:177`): products for `pending` and `confirmed` (the repair branch), else the reservation alone | throws: the webhook answers non-2xx and the payment's claim stays; Stripe's redelivery runs the confirmation again. From the customer's return, the webhook's delivery runs it                          |
| the marketplace's cancellation, `cancelMarketplaceBooking`        | `runReservationChangeByStatus` (`packages/api/src/services/marketplace-booking.ts:1151`): products for `confirmed` and `ongoing`, the reservation alone for `pending`                 | throws, as a lost deadlock did before; the marketplace asks again                                                                                                                                       |
| the marketplace's expiry, `expireMarketplaceBookingAttempts`      | `runReservationOnlyChange` (`:1252`)                                                                                                                                                  | skips the booking; its attempt stays live and lapsed, so the next marketplace quote for its store, read of the booking or list of bookings runs the expiry again. No cron runs it                       |
| the hold's replay of a lapsed attempt, `holdMarketplaceBooking`   | `runReservationOnlyChange` (`:654`)                                                                                                                                                   | skips the expiry and answers `hold_expired`, as it would have; the expiry above takes the booking                                                                                                       |
| the marketplace's failed payment, `failMarketplaceBookingAttempt` | `runReservationOnlyChange` (`:1284`)                                                                                                                                                  | throws: the Connect webhook answers non-2xx; Stripe's redelivery runs it again, the attempt being still `checkout_pending`                                                                              |
| the abandoned checkout, `cancelAbandonedCheckout`                 | `runReservationOnlyChange` (`apps/web/lib/reservations/cancel-abandoned-checkout.ts:44`)                                                                                              | throws: the Connect webhook answers non-2xx, as a lost deadlock did before. Nothing runs it again: the redelivery skips it and the reservation stays `pending` (section 5)                              |
| the failed checkout, `cancelFailedCheckoutReservation`            | `runReservationOnlyChange` (`packages/db/src/failed-checkout.ts:39`)                                                                                                                  | throws `ReservationChangeBusyError`, as a lost deadlock threw before: the checkout logs it and answers `errors.createReservationError`; the cleanup script stops on it. Nothing runs it again by itself |
| the checkout replacing its pending booking                        | the checkout's transaction opened by `runReservationTransaction` (`create-reservation.ts:981`), then `lockReservationOnlyInTransaction`                                               | the checkout fails with `errors.createReservationError`, as a lost deadlock did before; the customer submits again                                                                                      |

Each caller's work holds no outside effect, by reading: the store's messages go to the outbox in it, and every fee, message, Stripe call, insurance call and revalidation runs after it returns.

**What this section had wrong or left out, found in the implementation:**

- The transaction-level entry needs an owner token, so the checkout's own transaction (`writeReservation`) now opens through the owner entry: it moved from the connection's default isolation with no retry to READ COMMITTED and three runs. What a run gathers for after the commit (the superseded sessions, the fee effects) starts empty on each run.
- The abandoned checkout ran its payment check in `beforeWrite`, which a reservation-only token refuses. The check moved into the work, under the reservation's lock, before the change: a payment still open leaves the checkout as before.
- The inventory missed the hold's replay of a lapsed attempt (`holdMarketplaceBooking`), which expired it in a plain transaction.
- The dashboard's creation takes a new reservation's consumables (`consumeReservationStock`) without a status change: hence the `inserted` token.
- The customer's actions had no retryable error: exhausted retries threw, and the page showed its generic error. They now answer the existing key `errors.tryAgain`.
- The marketplace's cancellation of a `pending` booking took no product lock, and must not: a hold retry holds the attempt row while its checkout waits for the products (see "Which lock"). The cancellation and the paid confirmation choose their lock from the status, hence `runReservationChangeByStatus`.
- A caller swallows `ReservationChangeBusyError` only where something really runs the change again (the marketplace's expiry and the hold's replay, through the next quote, read or list). The others throw, as a lost deadlock threw before.
- The fee race of section 4 is already covered (`apps/web/lib/billing/reservation-effects.db.test.ts`, "a record that runs after the cancellation that followed it writes nothing" and the next test).
- `reconcileReservationStock`, which only the dashboard's edit calls, takes no token: the edit follows the lock order through its own code and moves in slice 7.

**Tests.**

- `scripts/reservation-writes.test.mjs` (R6) fails on a call of `changeReservationStatus` whose input does not name `lock`, and on a call of `consumeReservationStock` or `restoreReservationStock` without its lock. The types already make both a compile error in TypeScript, and the helpers refuse a missing or forged token at run time; R6 covers JavaScript files and casts.
- `packages/db/src/reservation-change.db.test.ts`: the owner entry runs READ COMMITTED on a server whose default is REPEATABLE READ; it locks the products, then the reservation, before its work; a product added while it waits starts it over under the new product's lock; three lost runs throw `ReservationChangeBusyError` and write nothing; a token is refused in another transaction, after its own ended, for another reservation, and when made by hand; a reservation-only token is refused on a change that takes or gives back stock or runs a check, and by the stock helpers; a token's fields cannot be rewritten, and a copy with other fields is refused, so a reservation-only token for one reservation neither changes another nor moves stock; an inserted token takes its stock once, and is refused a second time, for a status change and for another reservation; an inserted token issued in the owner entry's transaction is refused once it committed or rolled back; a failed checkout still busy after three runs throws and writes nothing.
- `apps/web/lib/reservations/status-change-races.db.test.ts`: each status writer queued on the reservation before the store's change finishes first, with the owner entry's restart count at zero (before this slice, the acceptance's race was a deadlock); a product added to a quote while its acceptance waits restarts it once, and the acceptance takes the new product's stock; exhaustion gives `RESERVATION_BUSY` for the store, `errors.tryAgain` with nothing written for the customer, a throw for the paid confirmation, whose claim row stays.
- `apps/web/lib/reservations/checkout-status.db.test.ts`: the paid confirmation and its repair branch wait behind a product update with the reservation still free, and restart nothing (before, the confirmation held the reservation and lost a deadlock); the checkout whose payment session failed, its cancellation forced to restart three times, logs `creation failed` and answers `errors.createReservationError`, with the checkout left `pending`.
- `packages/api/src/services/marketplace-booking.db.test.ts`: the marketplace's cancellation queued before a writer that locks the product, then the booking, restocks first with no deadlock (a deadlock before); a hold retry holding the attempt row while its checkout's transaction locks the product, and the cancellation of its `pending` booking, both finish with no restart (a lock wait timeout before); a `confirmed` booking's cancellation waits for its product's lock and restocks, while a `pending` one finishes under another writer's product lock; a booking confirmed between the cancellation's read and its lock starts it over once, under the products' lock, and restocks; an expiry left busy is skipped and taken by the next run.
- Zero restarts in a race is evidence, not enforcement.

**Remaining.** Two paths still lock the reservation before its products and retry once, until their own lots move them: the extension (`extension-quote.ts:53`, `:176`) and the unit assignment (`actions.ts:4701`, `:5038`), with the product page's move to another unit. C1 stays Partial for them. `updateReservation` follows the order through its own code and moves in slice 7.

### 2. A confirmation records the verdict it checked

**Done.** Every confirmation that checks the stock records the verdict of that check, and the inbox reads it as it reads a creation's or an edit's.

**Defect, before it.** `CAPACITY_VERDICT_ACTIVITY_TYPES` was `created` and `modified`. An overbooking flagged at creation stayed in the inbox's `overbooking` source, even after a confirmation that fit the stock. It left only when an edit wrote a new verdict, the reservation ended, or it was cancelled: a quote created over the stock, whose stock was then freed and which was then confirmed, stayed in the inbox until it ended.

**The rule.**

- Every confirmation that runs a stock check writes on its own activity row the verdict of the exact demand it checked under its locks: the store's change, the customer's acceptance and the paid confirmation, all through `checkExistingReservationInventory` (section 1). Its lines are read in a fixed order, by creation date then id, since the allocation places them in turn.
- It runs the check with `onShortfall: "collect"`, then refuses as before when short (until slice 4). So a confirmation writes `overbooked: false` today, and nothing else; a confirmation of a reservation never overbooked writes it too, and shows nothing (the timeline marks only `overbooked: true`).
- An observed verdict is not a store approval: `overbooked: false` means the stock fit, and nothing more. The comment where the verdict is written says so (`reservation-inventory.ts:746`).
- Once slice 4 lands, a confirmation that overrides writes `overbooked: true` with the shortfalls it booked over.
- The verdict types are `created`, `modified`, `confirmed` and `quote_accepted` (`packages/api/src/services/capacity-verdict.ts:16`). The latest verdict wins, as before; a row without `overbooked` (a confirmation before this slice, an edit that moved no demand) is not a verdict.
- The row is dated after every earlier row of the reservation (`nextCapacityVerdictDate`, read under the reservation's lock). `changeReservationStatus` takes that date from its caller for the activity row only: `beforeWrite` returns it as `activityAt`, next to `activityMetadata`, and the status's own dates stay the change's (`packages/db/src/reservation-status.ts:354`). One row is written, as before. The store's change runs its check before its confirmation step and hands the result to `beforeWrite`.

**Tests.**

- `packages/api/src/routers/dashboard/inbox.db.test.ts`: a quote created over the stock shows an `overbooking` item; the store's confirmation is refused while the stock is short; the stock is freed, the store confirms it, the row records `overbooked: false`, and the item leaves. A reservation never overbooked records `overbooked: false` and shows nothing. A creation and an edit dated in a second the confirmation's clock has not reached: the confirmation's verdict is dated one second after them, and the reservation's `billableAt` is the change's own date.
- `apps/web/lib/reservations/status-change-races.db.test.ts`: the same quote leaves the inbox once the store's change, the customer's acceptance or, for a request, the paid confirmation finds that the stock fits; each confirmation of a unit only the buffer reaches records the unit next to `overbooked: false`. These two paths live in `apps/web`, so their tests do too, not in the inbox's file as this section first said.
- `packages/api/src/routers/dashboard/reservations.db.test.ts`: the store's buffer-only unit is recorded next to the verdict.

### 3. Required accessories where a cart is composed

**Proposed rule.** `checkExistingReservationInventory` skips the required-accessory check: a confirmation accepts the lines as they are. This is an explicit policy change. The checkout and the extension keep their composition checks, and no customer cart is composed without them.

**Test.**

- A store quote without its accessory is confirmed by the store and by the customer.
- A paid request whose accessory link was added after the checkout is confirmed.
- Regression: a checkout and an extension without a required accessory are still refused.

### 4. The store may confirm over its returnable stock

**Defect.** `checkExistingReservationInventory` has no override (`:727`), and `changeStoreReservationStatus` passes none (`reservation-status.ts:507`). As long as the shortfall lasts, two reservations are refused at confirmation by everyone, against S3:

- a quote created with `allowOverbooking` (`actions.ts:948`);
- a paid request that lost its stock (`complete-checkout-payment.ts:238`).

**Proposed rule.** A store-side confirmation computes two sets of shortfalls under its locks, in the same order as slice 2:

- **Capacity shortfalls**: from the check without the buffer. These refuse with `RESERVATION_INSUFFICIENT_CAPACITY` (`CONFLICT`; `details.shortfalls` gives product, combination, asked and free) unless the call carries `allowOverbooking: true`.
- **Buffer-only shortfalls**: in the check with the buffer and not in the one without. `allowOverbooking` does not cover them: they refuse with `RESERVATION_TURNOVER_BUFFER_CONFLICT` unless a buffer approval covers them (slice 5b).

A unit's hard conflict and consumable stock below zero still refuse, whatever the flags. With the override, the activity row records `overbooked: true` and the capacity shortfalls (slice 2).

**Agents.** Keys and agents may send `allowOverbooking` (D2). The confirmation is always asked, and its state holds the recomputed shortfalls, so a token is bound to them. A preview that approved a shortage of 1 does not approve a shortage of 3.

**Data.** None new. The input of `reservations.updateStatus` gains `allowOverbooking` (optional, default false).

**Test** (`packages/api/src/routers/dashboard/reservations.db.test.ts`):

- A quote created over the stock is refused with its shortfalls, and nothing is written. With `allowOverbooking`, it is confirmed: its consumables are taken, its row records `overbooked: true`, and the inbox shows it.
- The same for a paid `pending` request.
- A hard unit conflict is still refused with the flag.
- A buffer-only shortfall with `allowOverbooking` and no approval is refused with `RESERVATION_TURNOVER_BUFFER_CONFLICT`.
- **Breaking sequence:** an agent's preview shows a shortage of 1. Another booking makes it 3 without touching this reservation. The token sent back is refused with a new preview.

### 5a and 5b. Buffer approval

**Defect.** The assignment and the move to another unit check `overrideTurnoverBuffer` and store nothing (section 1). A confirmation cannot tell a buffer conflict the store approved from one that appeared since. And it cannot leave the buffer out of its capacity check when the store did approve one: with one unit, it refuses as short stock a reservation whose buffer conflict the store accepted (`status-change-races.db.test.ts:414` holds the case only with two interchangeable units).

**Breaking sequence** (written as a test in 5b):

1. A quote has no assigned unit.
2. Another booking takes only its buffer margin.
3. The capacity check with the buffer fails, and the check without it passes.
4. The customer accepts.

"Every buffer-only conflict of the reservation is approved" would be vacuously true here, since the reservation has no units, and the customer would get past the buffer with no store approval. The same global bypass would let an approved unit on product A clear an unapproved buffer shortfall on product B. Each must be refused.

**Proposed rule.** An approval waives the turnover buffer for one named demand, never for the reservation as a whole.

| Approval of                    | Waives                                                                                                                                              | For                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| an assigned unit (line + unit) | that unit's buffer-only conflicts with other bookings, in the unit check; and, in the buffered capacity check, only the demand that unit represents | products with tracked units                              |
| a line (no unit)               | the buffer on that line's demand in the buffered capacity check                                                                                     | quantity-only products, and lines without assigned units |

Unit approvals waive only the demand represented by those units; any remaining quantity keeps its buffer unless separately approved. Approving every assigned unit does not approve the unassigned remainder. A line's assignments are loaded apart from its quantity (`packages/api/src/services/reservation-inventory.ts:683`): a quantity-two line holding one approved unit still has one unit of demand under the buffer.

Each approval holds:

- **who**: actor, user and credential;
- **when**;
- **its basis**: the reservation's window, the line's product, quantity and choice (combination or chosen attributes), the unit for a unit approval, and the store's `turnoverBufferMinutes` at approval;
- **its generation**: the reservation's `stock_basis_version` it was given for.

**Invalidation.** Approval authority is bound to a durable generation that changes whenever its basis changes; returning to an earlier value never restores it. Storage keeps the approval and its invalidation history independently of an assignment being replaced or deleted.

The generation is a column `reservations.stock_basis_version`, an integer that only grows. Every writer that changes what an approval is about increments it in the transaction that makes the change. An approval is valid only while its stored version equals the reservation's version read under the locks. A window edited from A to B and back to A has moved the version twice, so the approval given for A stays lapsed.

The store's `turnoverBufferMinutes` is not part of the version. The approval records it, and the read compares it by value. A setting changed and changed back with no change to the reservation keeps the approval: it was given for that very margin, and the conflict in front of the reader is the one the store accepted. If the reservation also changed meanwhile, the version moved and a new approval is needed.

The writer that increments the version marks the reservation's approvals still in force as lapsed, with the new version and why, in the same transaction. Authority never rests on that mark: the version comparison alone decides. A lapsed approval stays in storage, and the conflict must be approved again. An approval lapses when:

- **the unit is replaced:** an approval never moves to another unit;
- **the dates change;**
- **the line's demand changes:** quantity, choice or product, including a rekeying by `syncProductCombinationKeys`;
- **the buffer setting differs from the one the approval recorded.**

The writers that increment the version:

| Writer                                                     | Changes                                             | Where                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `updateReservation`                                        | the window, lines, and the assignments it drops     | `apps/web/app/(dashboard)/dashboard/reservations/actions.ts:1780` (`:2907`, `:2921`, `:2924`, `:2969`, `:2981`)    |
| `assignUnitsToReservationItem`                             | assignments added, replaced or removed              | `actions.ts:4637` (`:5019`, `:5023`)                                                                               |
| `reassignReservationItemUnit`, the move to another unit    | an assignment replaced                              | `apps/web/app/(dashboard)/dashboard/products/[id]/actions.ts:83` (`:430`, `:433`)                                  |
| the extension's `applyExtension`                           | the end date and the lines                          | `apps/web/lib/reservations/extension-service.ts:61` (`:71`, `:80`)                                                 |
| `syncProductCombinationKeys`, rekeying booked combinations | a line's choice                                     | `packages/api/src/services/variant-axes.ts:152` (`:191`), called from `variant-axes.ts:265` and `products.ts:1317` |
| the variant-axes backfill's restore                        | a line's choice                                     | `apps/web/scripts/run-variant-axes-backfill.ts:187`                                                                |
| `deleteUnits`                                              | an assignment's unit set to null (`schema.ts:3321`) | `packages/api/src/services/unit-mutations.ts:103` (`:120`)                                                         |

`scripts/reservation-writes.test.mjs` fails on a write to a reservation's window, a line's quantity or choice, or an assignment, in a function that does not increment the version. A new booking starts at version 0 with no approval.

The assignment's rewrite increments the version only when the set of assigned units changes. Today it deletes and reinserts every row (`actions.ts:5019`); writing the same units back must keep their approvals.

**Unit deletion.** The assignment's unit becomes null (`schema.ts:3321`). The approval's history stays (who, when, the unit's identifier snapshot), and its authority goes: an approval with no unit waives nothing.

**Who approves:**

- an assignment or a move to another unit made with `overrideTurnoverBuffer`;
- an edit that moves dates with `overrideTurnoverBuffer`, for the units and lines it keeps;
- the store's confirmation with `overrideTurnoverBuffer`, which writes an approval for each buffer-only conflict and shortfall it finds and names them;
- **on an already-confirmed reservation**, the action `reservations.approveTurnoverBuffer` (`id`, the units or lines). It writes the approvals and records an activity row, with no status change: repeating `confirmed → confirmed` is refused today. It is the inbox item's resolution, beside reassigning the unit. Agents get a confirmation preview naming the units and lines.

**At a confirmation** (5b), whoever makes it:

- **Unit check.** A buffer-only conflict on a unit with a valid approval is accepted and named as approved. Without one, it is accepted and named (D3), and the inbox source `unit_buffer_conflict` lists it until it is approved or the unit is reassigned.
- **Buffered capacity check.** The buffer is left out only for the demand that a valid approval covers. Any other buffer-only shortfall refuses: for the store, unless it carries `overrideTurnoverBuffer`; for the customer and the payment, always (D3). The row records `turnoverBufferApproved` with the demand it covered.

How `reserveInventory` takes a buffer per line is left to 5b's PR.

**Storage (5a).** The exact columns are left to the PR, within this shape:

- **One table `turnover_buffer_approvals`**, and the column `reservations.stock_basis_version` (integer, default 0). Table columns: reservation, line, unit nullable, the unit's identifier snapshot, basis, the version given for, the buffer setting at approval, actor, credential, approved at, lapsed at, the version that ended it and why. History is kept after a unit's deletion and after invalidation, and one read covers both scopes.

Two shapes were dropped. Approval columns on `reservation_item_units` and `reservation_items` lose their history with the row, against criterion 3. Activity rows alone derive authority from the latest of many rows, against criterion 1.

Criteria the shape meets:

1. Authority is read under the locks in one indexed query.
2. Invalidation is a version comparison: no value returning to an earlier one restores an approval.
3. History survives a unit's deletion and a lapse.
4. An approval cannot be copied onto a replacement unit.
5. The migration is additive.

The unit event of an assignment also records `overrideTurnoverBuffer: true`.

**Test.**

- One unit, assigned over the buffer with the override, then confirmed by the store, the customer and the payment: each confirmation passes, and its row names the unit as approved.
- Assigned while free, then a booking placed in its buffer: confirmed (D3) and listed in the inbox. `approveTurnoverBuffer` then removes the item.
- Dates moved: the approval lapses, and the inbox lists the conflict again.
- Dates moved and moved back before any confirmation: the approval stays lapsed. The buffer setting changed and changed back, with the reservation untouched: the approval holds.
- A quantity-two line holding one approved unit: the unassigned remainder's buffer-only shortfall still refuses.
- Unit deleted: the history stays, and the approval waives nothing.
- The breaking sequence above, both halves.

### 6a. Status services, one entry per actor

**Proposed rule.** `services/reservation-status.ts` gets one entry per actor: `changeCustomerReservationStatus`, `confirmPaidReservation` and `changeSystemReservationStatus`, next to the store's. The storefront actions, the checkout completion, the webhooks and the cleanup script become thin callers. Each entry preserves its actor's behaviour:

- **authorization:** customer ownership and expected status;
- **gates:** the card gate skipped only by `payment`;
- **the payment claim** and its separate commits (section 1);
- **invoices, invoice attachments and calendar sync;**
- **cancellation cleanup:** marketplace sessions expired and insurance cancelled; the system's narrow source and payment predicates;
- **customer acknowledgment of a payment** before a cancellation;
- **unit ids:** a customer's answer never exposes them.

Two rules of section 4 change here:

- the customer's actions become replayable per customer, action and reservation;
- the paid confirmation does not overwrite a `depositStatus` that the hold writer settled.

**Test.** `actions.test.mjs` and the races move to database tests. A customer's acceptance replayed after a success returns the same outcome, and a lost answer replayed does too. A deposit hold authorized between the claim and the confirmation keeps `authorized`.

### 6b. Durable messages

**Defect.** Several paths send from memory after the commit, so a crash between the commit and the send loses the message:

- `acceptQuote`: the store's notification and `customer_quote_accepted` (`.../actions.ts:282`, `:331`);
- `declineQuote` and `cancelReservationRequest`: the store's notification (`:449`, `:582`);
- the paid checkout: its messages (section 1).

**Proposed rule.** Every status writer of this lot queues its messages as outbox rows in its transaction, as the store's path does.

The payload **freezes**, from what was read under the locks:

- the kind, the actor, and the transition with the reservation's revision;
- the customer's recipients and the language (the store's destinations are read at send time, below);
- the currency, the dates, the lines, and the tax and money facts;
- the previous period, for a modification;
- references to the documents to attach, such as the invoice by id. The sender attaches the stored document and never generates it again.

**Read at send time:**

- where a store notification goes (the owner's phone, the webhook, the members' devices), and whether the store still wants it;
- the store's customer notification settings;
- the contract link's access token, minted by the sender;
- templates.

**New effect kinds**, since `reservation.storeNotification` has no e-mail channel, no `quote_declined` event and no payment amounts (`packages/api/src/platform/effects.ts:140`):

- the store's e-mail notification;
- quote declined;
- payment received, with its amount and currency;
- `customer_quote_accepted` and `customer_reservation_confirmed` in `reservation.customerMessage`.

**Ordering and supersession.** An explicit transition × message matrix (`SUPERSEDED_CUSTOMER_MESSAGES`, extended) says which unsent customer status messages a later change makes false; only rows `pending` or `failed` are superseded, a claimed message finishes before the next of its key. A payment-received message is never superseded by a status change. Today the matrix holds the first column only (`packages/api/src/services/reservation-effects.ts:81`), applied by the store's path (`packages/api/src/services/reservation-status.ts:554`) through `supersedeEffects` (`packages/api/src/platform/effects.ts:382`).

| Later change                          | `customer_request_accepted` | `customer_quote_accepted` (new) | `customer_reservation_confirmed` (new) |
| ------------------------------------- | --------------------------- | ------------------------------- | -------------------------------------- |
| → `cancelled`                         | superseded (today)          | superseded                      | superseded                             |
| → `rejected`                          | superseded (today)          | — (cannot precede it)           | — (cannot precede it)                  |
| → `declined`                          | — (cannot precede it)       | — (cannot precede it)           | — (cannot precede it)                  |
| → `confirmed`, `ongoing`, `completed` | kept                        | kept                            | kept                                   |

"Cannot precede it" follows the transition graph: `rejected` comes only from `pending` and `declined` only from `quote`, so neither follows an acceptance or a confirmation. If a quote is accepted and then cancelled before dispatch, no acceptance is sent. Payment received belongs to the durable payment claim: it is queued in the claim's commit, and it goes out even when the status confirmation then fails. Delivery stays at least once.

The new booking's messages belong to the creation lot.

**Test.** For each path:

- a forced error after the change rolls the transaction back and leaves no row;
- a commit leaves one row per channel, and its payload states the reservation's currency;
- a dispatch failure leaves the row for the cron;
- accept then cancel before dispatch sends the cancellation only;
- a payment whose confirmation is refused still sends payment received.

### 6c. Insurance at the customer's and the payment's confirmations

**Proposed rule.** After the commit, the customer's acceptance and the paid confirmation attempt the Tulip contract through `ports.insurance.createContract`, as the store's confirmation does. A failure is a warning recorded on the reservation, a past start included (section 4), and it never undoes the confirmation.

**Test.** A database test first shows that neither path attempts the contract today. Then each attempts it once, and a failure leaves the reservation confirmed with `tulipContractStatus: failed`.

### 7. `updateReservation` moves to `packages/api`, behaviour preserved

**What it requires.** The function reads outside the package:

- the session (`auth`, `getStoreForUser`);
- the Tulip mode, quote and contract sync (`getDashboardTulipInsuranceMode`, `previewTulipQuoteForCheckout`, `syncTulipContractForReservation`);
- the location snapshots (`apps/web/lib/reservations/location-snapshots.ts`);
- the delivery fee (`calculateTotalDeliveryFee`, `apps/web/lib/utils/geo.ts`);
- the fingerprint and the demand comparison (`util.reservation-edit.ts`);
- the modification email (`sendReservationModificationEmail`, `actions.ts:3852`);
- analytics and `revalidatePath`.

**Proposed split.**

- **Into the package as code:** the fingerprint and the demand comparison (pure), the delivery fee (pure), the location snapshot (a read of the store's locations), and the pricing of a line.
- **Ports**, until the Tulip integration moves: `ports.insurance.quote(reservation, lines, window)` and `ports.insurance.syncContract(reservationId)`. They return typed results with warnings and take the inputs that decide validity, and they never throw (`platform/ports.ts:401`).
- **The modification email** through a compatibility adapter: the result still reports it as `sent` or `failed`, as today. Moving it to the outbox is a later decision.
- **`afterCommit`:** the revalidation.

**Preserved, each with an existing test or a new one:**

- custom lines and deleted-product lines;
- pricing modes and snapshot names;
- every existing error key;
- the Tulip mode, the past-date disabling and the premium kept on a shortened period (`actions.ts:2252`);
- the post-commit sync, the revalidation, the modification-email activity and the analytics (`:3054`);
- the edit's demand rule and the fingerprint as they are.

**Credentials.** The procedure refuses any actor but a session, in code, until slice 12. Leaving the procedure out of discovery (`meta.mcp.exclude`) is not authorization.

**Test.** `update-reservation.db.test.ts` moves to the procedure and passes unchanged. A replay with an idempotency key runs once. A key or a token is refused.

### 8a. Editable statuses

**Proposed rule.** One rule for the procedure and the edit context, checked before and under the lock:

- editable: `pending`, `quote`, `confirmed`, `ongoing`;
- not editable: `completed`, `cancelled`, `rejected`, `declined`.

**Test.** Each non-editable status is refused, including a completion or a cancellation that lands during an edit.

### 8b. A real window

**Proposed rule.**

- `endDate > startDate`.
- A local date and time must exist in the store's time zone. This check lives where a local time is typed, before it is normalised: in the dashboard form, and in any input that takes a local date and time, reusing the extension's round trip.
- An input given as an ISO instant with an offset is already an instant, and it cannot show what was typed.

**Test.** A zero-length window is refused. A nonexistent local time typed in the form is refused before it is converted.

### 9. Booking pricing facts preserved

**Proposed rule.** The facts that a line's first pricing used are kept on the line:

- the applied promotion (`AppliedProductPromotion` on `pricingBreakdown`, `packages/types/src/store.ts:531`), as percentage and amounts;
- the line's tax rate and exemption (`reservation_items.tax_rate`, `schema.ts:1954`), and the inclusion mode;
- the promo code's discount.

A fact that is missing on the line today gets an additive field. Existing rows keep null, which means "not recorded".

**Test.** A new booking stores every fact. A row with a missing fact reads as "not recorded", never as zero.

### 10. Edit totals from the tax engine, under the locks

**Proposed rule.** The edit prices from what it reads under its locks. Its totals are `calculateTaxBreakdown` of the lines, the delivery and the discount, as the checkout computes them, and they preserve:

- per-line rates and exemptions;
- the inclusion mode;
- insurance exempt from tax;
- how the discount is allocated across lines.

They do not use the reservation's aggregate rate.

External quotes and routing (insurance quote, route distance) run outside the retryable transaction. Their input basis (window, lines, addresses) is checked again under the locks, and a changed basis refuses with `RESERVATION_CHANGED_MEANWHILE`. Product and store configuration, which the fingerprint does not cover, is read under the locks.

**Test.**

- Totals equal `calculateTaxBreakdown` for prices with tax and prices before tax, with an exempt line and exempt insurance.
- Two edits at once.
- An insurance quote whose window changed meanwhile is refused.

### 11. Repricing keeps the promotion and the tax facts

**Proposed rule.**

- **An existing line** keeps its id. If the edit changes neither its dates, its quantity nor its choice, it keeps its stored price. If it does, it is repriced with its stored facts (slice 9). Its promotion is applied as recorded, and whether that promotion is still eligible is not checked again.
- **A new line** is priced by today's rules, as the checkout would price it.
- **A manual price** (`isManualPrice`) is kept as typed.
- **A line with a missing fact** is repriced by today's rules, and the answer carries a warning that names it.
- **The promo code's discount** stays the amount stored. The edit neither checks it again, nor extends it to new lines, nor counts a use (P1).

**Test.**

- A promoted line moved by one day keeps its promotion after the promotion ended.
- A change of the store's tax settings since the booking changes nothing.
- A new line gets today's price.
- A line with a missing fact warns.

### 12. The edit exposed to the API and agents

**Contract.** `reservations.update`, `POST /reservations/{id}`: `storeProcedure`, `scope: reservations write`, MCP `reservations_update` in bundle `daily`. Input:

- `id`;
- optional `startDate` and `endDate` (ISO with offset);
- `lines`;
- `removeLineIds`;
- `delivery`;
- `insurance: boolean`;
- `notifyCustomer`, `allowOverbooking`, `overrideTurnoverBuffer`.

Output:

- the reservation, as `reservations.get` returns it;
- `difference` and `previousTotal`, as decimal strings in the reservation's currency;
- `warnings`;
- `capacity: { overbooked, shortfalls }`;
- `links`.

Errors, each with a stable code:

- `RESERVATION_NOT_FOUND`
- `RESERVATION_NOT_EDITABLE`
- `RESERVATION_CHANGED_MEANWHILE` (retryable after a read)
- `RESERVATION_INSUFFICIENT_CAPACITY`
- `RESERVATION_UNITS_UNAVAILABLE`
- `RESERVATION_TURNOVER_BUFFER_CONFLICT`
- `RESERVATION_TOO_MANY_ASSIGNED_UNITS`
- `CONSUMABLE_INSUFFICIENT_STOCK`
- `RESERVATION_WINDOW_INVALID`
- `RESERVATION_LINES_UNKNOWN`
- `RESERVATION_LINES_SENT_AND_REMOVED`

**Patch semantics.** This is the rule products already follow: an agent never deletes by omission (`products_update` and `removeUnitIds`, [API and agents](../architecture/api-and-agents.md)).

| Input                                          | Meaning                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lines` absent                                 | lines unchanged                                                                                           |
| `lines: []`                                    | lines unchanged (as today's empty-list branch, `actions.ts:1898`)                                         |
| `lines` with items                             | updates the lines it names by `id`, and adds those without one; the lines left out stay, for every caller |
| `removeLineIds`                                | the only way to delete a line, for every caller, the dashboard included                                   |
| an `id` not on this reservation, or sent twice | `RESERVATION_LINES_UNKNOWN`                                                                               |
| an `id` both sent and removed                  | `RESERVATION_LINES_SENT_AND_REMOVED`                                                                      |
| a field absent on a line                       | that field unchanged                                                                                      |
| a field `null` on a line                       | cleared, where the field may be null (`depositPerUnit` may not)                                           |
| `delivery: null`                               | delivery removed                                                                                          |

Omission never deletes a line, for any caller. The dashboard's form still edits the whole list; its adapter compares the list with the reservation's lines and sends the ones it dropped as `removeLineIds`.

**Confirmation.** An edit asks for confirmation when it changes stock demand, the total, the tax, the deposit, the delivery or the insurance, when it sends a message, or when it carries an override. This holds even when the total does not change.

The preview shows:

- each line added or removed, and each quantity or choice changed;
- the old and new dates;
- the total, tax, deposit, delivery and insurance, and the difference;
- both override verdicts (capacity and buffer);
- the assignments affected;
- the message and its channels;
- a warning when a payment session or an extension checkout is outstanding (section 5).

The token is bound to:

- the actor, the store and the input;
- the reservation's revision;
- the choices and assignments;
- the computed prices and quotes;
- the current capacity verdict;
- the recipient.

A competing booking that changes the verdict without touching this reservation invalidates the token, as in slice 4.

**Test.**

- A read-only connection is refused.
- A token is refused after a competing booking changes the shortfalls.
- A partial `lines` list deletes nothing.
- Each row of the patch table behaves as stated.

### 13. Storefront availability on the allocator

**Defect.** `getStorefrontAvailability` gives each combination `min(units of the combination − reserved on it, units of the product − reserved on the product)` (`packages/api/src/services/availability.ts:783`). Another booking that left a size open counts on the product, not on the sizes that can serve it. So a size it needs can show free, and the checkout refuses it. Four other places count the same way, per product, and the filter sums the combinations' figures (`apps/web/lib/storefront/catalog.queries.ts:514`):

- the marketplace (`marketplace-availability.ts:596`);
- the MCP calendar (`packages/mcp/src/tools/calendar.ts:110`);
- the assistant (`apps/web/lib/ai/tools.ts:1036`);
- the catalogue's filter.

**Proposed rule.**

- **Per combination.** A combination shows free the largest `q` such that a checkout line `{ candidates: [combination], quantity: q, single: true }` fits next to the other bookings at every instant. The per-combination maxima are alternatives, not quantities that add up. With two units A and B and one open booking, A shows 1 and B shows 1, and only one unit is free.
- **Per product and per filter.** The quantity for a product, or for a filter over several combinations, comes from its own allocator query, a line whose candidates are the matching combinations. It never comes from a sum.
- **Required accessories** remain a joint constraint on the parent's figure (`availability.ts:835`).
- **"Available only" filtering.** Exact filtering and counts before pagination need every candidate considered, as the catalogue does today (`catalog.queries.ts:812`). An exact filtered total is never claimed from the visible cards alone.

**What it takes.** The display loads what the write loads (`reserveInventory`), and shares that loading with it instead of copying it (ADR 0006). Prepared demands are reused across products and windows.

**Before choosing the implementation, measure:**

- a large listing;
- a multi-window calendar;
- with an upper bound on queries per request, and a latency bound.

**Test** (`packages/api/src/services/availability.db.test.ts`):

- A booking that chose size M alone, with two colours of M and one other size: the M colour it needs shows taken, and the other size shows free.
- The two-unit example above shows a product quantity of 1.
- For each combination, the quantity shown is accepted by the checkout, and one more is refused.

---

## Related

- [Reservation invariants](reservation-invariants.md) — the rules every writer holds; S1, S2, S3, S4, M1, M3, T3, T5, C1, E1 are the ones this lot moves
- [Glossary](glossary.md) — the domain's words
- [ADR 0006](../adr/0006-canonical-availability-semantics.md) — the availability rule, the buffer override, who owns them
- [Data layer](../code-review/04-data-layer.md) — DL-12 (status and inserts), DL-13 (billing marks), lock order
- [API and agents](../architecture/api-and-agents.md) — writing a procedure, contract conventions, sensitive operations, the outbox
