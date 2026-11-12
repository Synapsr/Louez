# Code Review — Data Layer

> Applies when: Drizzle queries, oRPC routes, or React Query options/usage is changed.

## Rules

### [DL-01] Drizzle queries use the query builder

Prefer Drizzle's query builder over raw SQL. Use `db.select()`, `db.insert()`, etc. Raw SQL is acceptable only for complex queries that can't be expressed with the builder.

### [DL-02] Select only what you need

Don't use `select()` without specifying columns when the table has many columns. Pick the columns you need to keep payloads small.

```typescript
// Bad — fetches everything
const podcasts = await db.select().from(podcastTable);

// Good — fetches only what's needed
const podcasts = await db
  .select({ id: podcastTable.id, title: podcastTable.title })
  .from(podcastTable);
```

### [DL-03] Transactions for multi-step writes

Any operation that inserts/updates multiple tables must be wrapped in a transaction. Use `db.transaction()`.

### [DL-04] Idempotent inserts for user-generated content

When inserting data that may collide (tags, slugs, etc.), use `onDuplicateKeyUpdate` instead of catching errors. This avoids race conditions and collation mismatches.

### [DL-05] ORPC routes follow domain grouping

Routes are organized by domain: `studio.podcast`, `studio.channel`, `user`, etc. A new route must belong to an existing domain or justify creating a new one.

### [DL-06] ORPC input validation with Zod

Every ORPC route defines its input schema with Zod. No unvalidated inputs reach business logic.

### [DL-07] React Query conventions

| Pattern               | Convention                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| Query options factory | `lib/queries/<domain>.queries.ts` — exports typed options                |
| Query options         | `orpc.<domain>.<action>.queryOptions({ input })` — keys are auto-managed |
| Mutation options      | `orpc.<domain>.<action>.mutationOptions()`                               |
| Broad invalidation    | `queryClient.invalidateQueries({ queryKey: orpc.<domain>.key() })`       |
| Specific cache        | `orpc.<domain>.<action>.queryKey({ input })`                             |

Never define manual query keys — oRPC generates them automatically.

### [DL-08] Options factories, not wrapper hooks

Don't wrap `useQuery`/`useMutation` in custom hooks. Export **query/mutation options factories** from `lib/queries/<domain>.queries.ts`. Components call `useQuery(podcastQueries.list(channelId))` directly. This preserves type inference, allows per-call overrides, and keeps options reusable for prefetching and testing.

### [DL-09] Optimistic updates only when UX demands it

Don't add optimistic updates by default. Use them only when the perceived latency is a real UX problem (e.g., toggling a like, reordering a list). Simple CRUD can wait for the server response.

### [DL-10] Always define `.output()` on procedures

Every oRPC procedure must have an `.output()` Zod schema. This enables OpenAPI generation later without touching procedure code.

### [DL-11] Error handling at route boundaries

oRPC routes handle errors and return typed error responses. Don't let raw database errors bubble up to the client.

### [DL-12] Reservation status and inserts go through the helpers

Change a reservation's status with `changeReservationStatus` and insert a reservation with `insertReservation`, both from `@louez/db`, in the caller's transaction. The status helper locks the row, checks the transition, moves consumable stock, sets `billableAt` and `withdrawnAt`, and writes the activity row. It runs only under the reservation's lock token, which the owner entry `runReservationChange` (or `runReservationOnlyChange`) gives its work, in a transaction it opened itself (see [Lock order](#lock-order)). Both helpers return fee effects. Run them with `runReservationEffects` after the commit. packages/api receives the runner from the app as a port (`ApiPorts.runReservationEffects`).

Both helpers also ask the card gate (louez-billing `docs/api`, README §8.4) before a write that makes a reservation billable: an insert as `confirmed`, or a change into `confirmed`, `ongoing` or `completed` from outside them, unless the actor is `payment`. When the store's policy refuses, they throw `StoreNotAcceptingReservationsError` and the transaction rolls back. Catch it where you answer the user, with `isStoreNotAcceptingReservationsError`, and answer with `STORE_NOT_ACCEPTING_RESERVATIONS_ERROR` from `@louez/types`, which says nothing about billing. To a renter, pass `renterGateRefusalParams(store)` from `apps/web/lib/billing/reservation-gate-error.ts` as its params: the message shows the store's phone and email, and does not render without them. A write that starts a booking as `pending` and expects a later confirmation (the checkout's `createReservation`) asks first, with `checkReservationGate` from `apps/web/lib/billing/reservation-gate.ts`. So does a caller that writes or calls out before its transaction (`createManualReservation` creates the customer and asks the routing API); the helper's answer under the transaction still counts. With billing off, or without the billing service, the gate is always open and reads nothing.

Don't write `status`, `billableAt` or `withdrawnAt` in your own `update(reservations).set(…)`, and don't call `insert(reservations)` yourself. A write that skips the helpers skips the pay-as-you-go fee.

```typescript
// Bad — no fee, no activity, no stock
await tx.update(reservations).set({ status: "confirmed" }).where(eq(reservations.id, id));

// Good
const change = await runReservationChange({ reservationId, storeId }, (tx, lock) =>
  changeReservationStatus(tx, {
    lock,
    reservationId,
    storeId,
    to: "confirmed",
    actor,
    actorUserId,
  }),
);
if (change.changed) await runReservationEffects(change.effects);
```

`scripts/reservation-writes.test.mjs` enforces this rule in `pnpm test`. It reads syntax only, so it also asks for forms it can check: `update(reservations).set(…)` takes an object literal with no spread and no computed key, every Drizzle insert and update names a schema table (an import, an alias of one, or `schema.<table>`), raw SQL never inserts or updates `reservations`, a file that calls a helper also calls `runReservationEffects`, and a call of `changeReservationStatus` names `lock` in its input, as a call of `consumeReservationStock` or `restoreReservationStock` passes its lock (R6). The types already require the lock in TypeScript and the helpers refuse a missing or forged one at run time; R6 covers JavaScript files and casts. A write that cannot take these forms goes on the test's allowlist with its reason, and the test fails when an entry no longer matches.

Seeds that insert backdated rows set `billableAt` with `initialBillableAt` and stay on the allowlist. `packages/db/src/scripts/reservations-backfill-billable-at.ts` reruns the backfill of migration 0083 with the SQL of the migration file: it writes `billable_at` and `withdrawn_at` outside the helpers, and the test cannot see it.

#### Lock order

A write of the store row's JSON columns (`settings`, `theme`, `notificationSettings`, `customerNotificationSettings`, `reviewBoosterSettings`) reads them under the store row's lock: `mergeStoreRow` from `@louez/db` locks, reads, merges and writes in one transaction, and `lockStoreRow` takes the lock first inside a transaction of its own. Reading the row, then writing it back whole, loses any section another writer committed in between.

New code that locks rows of several of these tables takes them in one order: the store row (a domain's write lock, `SELECT … FOR UPDATE` on `stores`), then products by id, then reservations, then product units by id. Take the locks before the transaction's first plain read, or run it READ COMMITTED: under REPEATABLE READ that first read fixes the snapshot, and a row committed while the transaction waited for a lock is not seen. Never lock a row of an earlier table once you hold a later one: if a product turns up after its reservation is locked, roll back and start over. Checkout (`lockReservationProducts` before the booking), the product writes of packages/api and every status change follow it.

Every status change takes its locks through one owner entry of `@louez/db` (`packages/db/src/reservation-change.ts`). `runReservationTransaction(work)` opens the transaction itself, READ COMMITTED whatever the session's default, and gives `work` an owner token. `runReservationChange(scope, work)` adds the lock: the reservation's products by id, then the reservation, then a second read of its products (`lockReservationInTransaction`, `packages/db/src/reservation-lock.ts`); a product that joined meanwhile throws `ReservationProductsChangedError`. On that error or a lost deadlock the owner rolls back and runs the whole transaction again, three runs in all, then throws `ReservationChangeBusyError`. `runReservationOnlyChange(scope, work)` locks the reservation alone, for a change that takes or gives back no stock: its token refuses a stock move and a `beforeWrite`. Take the products' lock only for a change that moves stock or runs a stock check, and the reservation's alone for any other: a transaction that holds another row while it waits on a transaction of its own (the marketplace's hold retry holds the attempt row while its checkout locks the products) deadlocks with no error MySQL can see against a change that holds those products. A caller that moves stock from some statuses only reads the status first with `runReservationChangeByStatus(scope, needsProducts, work)`, which takes the lock that status needs and starts over when the status under the reservation's lock is another. A transaction that composes a change with other writes, as the checkout replacing its own pending booking does, opens with `runReservationTransaction` and takes the token inside with `lockReservationInTransaction` or `lockReservationOnlyInTransaction`, which accept only the owner's token. `changeReservationStatus`, `consumeReservationStock` and `restoreReservationStock` take the token and check, from what the module recorded when it issued it and never from the token's fields, that it is the one of this transaction, store and reservation, still open; an issued token is frozen. `insertReservation` returns the token of the row it inserted, which only `consumeReservationStock` accepts, once. Issued in a transaction of the owner entry, it ends with it; issued in a transaction the owner entry did not open (the dashboard's creation), it is valid there by convention only. Each caller answers the busy error in its own way: the store's procedures with `RESERVATION_BUSY` (retryable), the customer's actions with `errors.tryAgain`, the paid confirmation by throwing (the webhook answers non-2xx, Stripe's redelivery runs it again, and the payment's claim, committed before, stays). Swallow it only where something really runs the change again: the marketplace's expiry skips a busy booking because the next quote, read or list runs it again. Anywhere else, let it propagate, as a lost deadlock did; the checkout's failed-session cleanup and the abandoned checkout throw, and nothing runs them again ([Reservation changes](../domain/reservation-changes.md), slice 1).

`changeStoreReservationStatus` (packages/api `services/reservation-status.ts`, behind `reservations.updateStatus` and `reservations.cancel`) runs in `runReservationChange`: under the reservation's products and the reservation, it checks the card gate and the stock (for a change that takes stock, it locks the units the reservation holds, last, and checks each by id) and asks for its confirmation before the first write. A product added meanwhile, or a lost deadlock against a path below, starts it over, and after three runs it answers `RESERVATION_BUSY` (retryable). Its messages and notifications are outbox rows written in the same transaction, so a run that rolls back leaves none. It reads the customer and the store once, as plain reads after its locks, and builds its preview, its confirmation's binding and its outbox rows from that one read: they cannot disagree, and a change after it voids the confirmation. Customers are not in the lock order; a write that must lock one takes it after the reservations, before the units. `apps/web/lib/reservations/status-change-races.db.test.ts` races it against every other status writer with the owner entry's restart count at zero, starts a customer's acceptance over when a product joins the quote, and checks each caller's answer once three runs are lost; `packages/db/src/reservation-change.db.test.ts` checks the isolation, the lock order and the tokens.

The dashboard's reservation edit (`updateReservation`) follows the order too. It prices the edit from a plain read, then runs READ COMMITTED: it locks the products of the existing and the submitted lines, then the reservation, then its units, and compares the reservation and its items with what it read (`fingerprintReservationEdit` in `apps/web/lib/reservations/util.reservation-edit.ts`). Any difference, a line added meanwhile included, writes nothing and answers `errors.reservationChangedMeanwhile`: the caller reloads and edits again, so the product of a line it never read is never locked after the reservation. Its stock check runs under those locks before its first write (`reserveInventory` with `onShortfall: "collect"`), and its activity row is written in the transaction. The transaction holds no effect, so it runs inside `retryTransactionOnDeadlock`; the insurance contract, the email and the analytics event run after it. `apps/web/app/(dashboard)/dashboard/reservations/update-reservation.db.test.ts` races two edits of one reservation, and an edit against a manual creation for the last unit.

The dashboard's creation (`createManualReservation`) prices the booking from plain reads, then locks its products as the first statement of its transaction. What its stock decision reads comes after those locks: the products, the store's availability rules, the other bookings (`reserveInventory` with `onShortfall: "collect"`). Its activity row, which carries the capacity verdict, is written in the transaction; the fee, the insurance contract, the messages and the analytics event run after it. `apps/web/app/(dashboard)/dashboard/reservations/create-manual-reservation.db.test.ts` races two creations, and a creation against a marketplace checkout, for the last unit.

Until their own lots align them, two paths lock the reservation before its products, and run the whole transaction again once on a lost deadlock (`retryOnceOnDeadlock` from `@louez/db`): the extension (`apps/web/lib/reservations/extension-quote.ts`, `extension-service.ts`) and the unit assignment (`assignUnitsToReservationItem` in the dashboard's reservation actions, and the product page's move to another unit). The product writes of packages/api, on the other side of that lock pair, retry once too. No status change is among them. A transaction that may run again holds no effect: fees, emails, notifications and provider calls run after it returns, once, and a payment is recorded outside it, so a new run cannot record it twice.

### [DL-13] Writes that change a billing snapshot mark it

With the billing service on, Louez sends it snapshots of stores, reservations and legacy billing (louez-billing `docs/api`). A write that can change a snapshot marks its aggregate in the same transaction, with `markReservation`, `markReservationIds`, `markStoreReservations`, `markStore`, `markLegacyStore`, `markSubscriptionRow` (a `subscriptions` row), `markLegacyMonth` or `markBillingDirty` from `@louez/db`, or `billingMarkStatement` on a raw mysql2 connection. A write with no transaction gets one, with its mark; Stripe calls, emails and fetches stay outside it. `changeReservationStatus` and `insertReservation` mark the reservation themselves. With the service off, the marks write nothing.

Mark only when a field the builders read can change (`apps/web/lib/billing-sync/snapshots`): notes, signatures and Tulip ids need none. The nightly sweep catches a missed mark within a day.

A write through `mergeStoreRow` (`@louez/db`) marks in its `merge` callback, which receives the transaction; the test below does not see writes made inside `packages/db`.

`scripts/billing-marks.test.mjs` enforces this rule in `pnpm test`. A file that writes payments, disputes, platform fees, pay-as-you-go invoices, subscriptions, legal profiles, members, marketplace channels, referral rewards or reservation items, or updates a column the builders read on stores, reservations or reservation items, must reference a mark helper. It checks the file, not the transaction. A write that changes no snapshot field goes on the test's allowlist with its reason.

A write that starts, changes or ends the plan in force on a `subscriptions` row (`planInForceSlug` in `apps/web/lib/plan-limits.ts`) also calls `syncPlanSoon` from `apps/web/lib/billing-sync/plan-sync-soon.ts` once it has committed. For a store the billing service bills, the plan then reaches the service and its policy version comes back within seconds, not the cron's 1 to 3 minutes, during which a payment keeps the old fee (louez-billing `docs/plans/plans-for-new-stores.md` decision 8). Any other write, such as a renewal or a status change that keeps the plan in force, does not call it: the service issues no version for it, and each call costs a relay and four heartbeats. To tell them apart, read `lockPlanInForce` before and after the write in its transaction. `updateStoreSubscription` and `updateSubscriptionRow` in `apps/web/lib/stripe/subscriptions.ts` do it for every write that goes through them.

### [DL-14] Dates reach MySQL in UTC

Drizzle writes a `Date` into a timestamp column as a UTC string. A `Date` bound to a raw SQL expression has no column to encode it (`gt(someSqlExpression, date)`, or `${date}` inside a `sql` template): mysql2 writes it itself. The pool in `packages/db/src/index.ts` sets `timezone: "Z"`, so mysql2 writes it in UTC too, whatever the time zone of the process. Before that option, a server whose `TZ` was not UTC compared the two an offset apart: the overlap predicate missed a booking ending within the offset, or kept one that was over.

Keep it so:

- A connection that reads or writes application rows comes from that pool, or sets `timezone: "Z"` itself: the billing relay's snapshot pool, the store-cloning script and `createTestDatabase` do. The one-off scripts under `apps/web/scripts` and `packages/db/src/scripts` open their own connections without it; one that binds a `Date` must set it.
- The database session runs in UTC: MySQL stores a timestamp column from the session's time zone, and `NOW()` answers in it. The pool does not set the session's time zone, because changing it on an instance that ran otherwise would shift how its existing rows read.
- A comparison with the database's clock stays in SQL (`NOW(3)`), as the outbox and the jobs do; do not compare a column with `new Date()` from an application server to decide a lease.

`packages/db/src/raw-date-bindings.db.test.ts` runs the overlap predicate with the process in four time zones.

---

## Related

- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Full Drizzle + oRPC + React Query setup
- [03-react-patterns.md](03-react-patterns.md) — Using queries/mutations inside components
- [06-security.md](06-security.md) — Auth middleware on procedures, input validation
- [02-typescript.md](02-typescript.md) — Inferring types from Zod schemas (`z.infer<>`)
