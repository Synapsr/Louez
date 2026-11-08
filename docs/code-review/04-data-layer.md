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

Change a reservation's status with `changeReservationStatus` and insert a reservation with `insertReservation`, both from `@louez/db`, in the caller's transaction. The status helper locks the row, checks the transition, moves consumable stock, sets `billableAt` and `withdrawnAt`, and writes the activity row. Both helpers return fee effects. Run them with `runReservationEffects` after the commit. packages/api receives the runner from the app as a port (`ApiPorts.runReservationEffects`).

Both helpers also ask the card gate (louez-billing `docs/api`, README §8.4) before a write that makes a reservation billable: an insert as `confirmed`, or a change into `confirmed`, `ongoing` or `completed` from outside them, unless the actor is `payment`. When the store's policy refuses, they throw `StoreNotAcceptingReservationsError` and the transaction rolls back. Catch it where you answer the user, with `isStoreNotAcceptingReservationsError`, and answer with `STORE_NOT_ACCEPTING_RESERVATIONS_ERROR` from `@louez/types`, which says nothing about billing. To a renter, pass `renterGateRefusalParams(store)` from `apps/web/lib/billing/reservation-gate-error.ts` as its params: the message shows the store's phone and email, and does not render without them. A write that starts a booking as `pending` and expects a later confirmation (the checkout's `createReservation`) asks first, with `checkReservationGate` from `apps/web/lib/billing/reservation-gate.ts`. So does a caller that writes or calls out before its transaction (`createManualReservation` creates the customer and asks the routing API); the helper's answer under the transaction still counts. With billing off, or without the billing service, the gate is always open and reads nothing.

Don't write `status`, `billableAt` or `withdrawnAt` in your own `update(reservations).set(…)`, and don't call `insert(reservations)` yourself. A write that skips the helpers skips the pay-as-you-go fee.

```typescript
// Bad — no fee, no activity, no stock
await tx.update(reservations).set({ status: "confirmed" }).where(eq(reservations.id, id));

// Good
const change = await db.transaction((tx) =>
  changeReservationStatus(tx, { reservationId, storeId, to: "confirmed", actor, actorUserId }),
);
if (change.changed) await runReservationEffects(change.effects);
```

`scripts/reservation-writes.test.mjs` enforces this rule in `pnpm test`. It reads syntax only, so it also asks for forms it can check: `update(reservations).set(…)` takes an object literal with no spread and no computed key, every Drizzle insert and update names a schema table (an import, an alias of one, or `schema.<table>`), raw SQL never inserts or updates `reservations`, and a file that calls a helper also calls `runReservationEffects`. A write that cannot take these forms goes on the test's allowlist with its reason, and the test fails when an entry no longer matches.

Seeds that insert backdated rows set `billableAt` with `initialBillableAt` and stay on the allowlist. `packages/db/src/scripts/reservations-backfill-billable-at.ts` reruns the backfill of migration 0083 with the SQL of the migration file: it writes `billable_at` and `withdrawn_at` outside the helpers, and the test cannot see it.

#### Lock order

A write of the store row's JSON columns (`settings`, `theme`) reads them under the store row's lock: `mergeStoreRow` from `@louez/db` locks, reads, merges and writes in one transaction, and `lockStoreRow` takes the lock first inside a transaction of its own. Reading the row, then writing it back whole, loses any section another writer committed in between.

New code that locks rows of several of these tables takes them in one order: the store row (a domain's write lock, `SELECT … FOR UPDATE` on `stores`), then products by id, then reservations, then product units by id. Take the locks before the transaction's first plain read, or run it READ COMMITTED: under REPEATABLE READ that first read fixes the snapshot, and a row committed while the transaction waited for a lock is not seen. Never lock a row of an earlier table once you hold a later one: if a product turns up after its reservation is locked, roll back and start over. Checkout (`lockReservationProducts` before the booking), the product writes of packages/api and the store's status changes follow it. `changeStoreReservationStatus` (packages/api `services/reservation-status.ts`, behind `reservations.updateStatus` and `reservations.cancel`) runs READ COMMITTED: it locks the reservation's products, then the reservation, checks under those locks that no product was added meanwhile, then checks the card gate and the stock and asks for its confirmation before the first write. A product added meanwhile, or a lost deadlock against a path below, rolls it back and starts it over, up to three runs in all, then it answers `RESERVATION_BUSY` (retryable). Its messages and notifications are outbox rows written in the same transaction, so a run that rolls back leaves none. It reads the customer and the store once, as plain reads after its locks, and builds its preview, its confirmation's binding and its outbox rows from that one read: they cannot disagree, and a change after it voids the confirmation. Customers are not in the lock order; a write that must lock one takes it after the reservations, before the units. `apps/web/lib/reservations/status-change-races.db.test.ts` races it against a paid checkout's confirmation and a customer's quote acceptance.

Until the reservations lots align them, these paths call `changeReservationStatus` directly and lock the reservation before its products: the customer's quote acceptance, decline and cancellation, the paid confirmation of checkout and the Stripe webhooks (`confirmPaidReservationOrThrow`), the marketplace cancellation. Either side of that lock pair may lose a deadlock, so each of those transactions runs inside `retryTransactionOnDeadlock` from `@louez/db`: the whole transaction runs again, up to three runs in all (the product update, on the other side, retries once with `retryOnceOnDeadlock`). Cancelling a pending checkout locks no product and needs none. A transaction run this way holds no effect: fees, emails, notifications and provider calls run after it returns, once, and a payment is recorded outside it, so a new run cannot record it twice.

### [DL-13] Writes that change a billing snapshot mark it

With the billing service on, Louez sends it snapshots of stores, reservations and legacy billing (louez-billing `docs/api`). A write that can change a snapshot marks its aggregate in the same transaction, with `markReservation`, `markReservationIds`, `markStoreReservations`, `markStore`, `markLegacyStore`, `markSubscriptionRow` (a `subscriptions` row), `markLegacyMonth` or `markBillingDirty` from `@louez/db`, or `billingMarkStatement` on a raw mysql2 connection. A write with no transaction gets one, with its mark; Stripe calls, emails and fetches stay outside it. `changeReservationStatus` and `insertReservation` mark the reservation themselves. With the service off, the marks write nothing.

Mark only when a field the builders read can change (`apps/web/lib/billing-sync/snapshots`): notes, signatures and Tulip ids need none. The nightly sweep catches a missed mark within a day.

A write through `mergeStoreRow` (`@louez/db`) marks in its `merge` callback, which receives the transaction; the test below does not see writes made inside `packages/db`.

`scripts/billing-marks.test.mjs` enforces this rule in `pnpm test`. A file that writes payments, disputes, platform fees, pay-as-you-go invoices, subscriptions, legal profiles, members, marketplace channels, referral rewards or reservation items, or updates a column the builders read on stores, reservations or reservation items, must reference a mark helper. It checks the file, not the transaction. A write that changes no snapshot field goes on the test's allowlist with its reason.

A write that starts, changes or ends the plan in force on a `subscriptions` row (`planInForceSlug` in `apps/web/lib/plan-limits.ts`) also calls `syncPlanSoon` from `apps/web/lib/billing-sync/plan-sync-soon.ts` once it has committed. For a store the billing service bills, the plan then reaches the service and its policy version comes back within seconds, not the cron's 1 to 3 minutes, during which a payment keeps the old fee (louez-billing `docs/plans/plans-for-new-stores.md` decision 8). Any other write, such as a renewal or a status change that keeps the plan in force, does not call it: the service issues no version for it, and each call costs a relay and four heartbeats. To tell them apart, read `lockPlanInForce` before and after the write in its transaction. `updateStoreSubscription` and `updateSubscriptionRow` in `apps/web/lib/stripe/subscriptions.ts` do it for every write that goes through them.

---

## Related

- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Full Drizzle + oRPC + React Query setup
- [03-react-patterns.md](03-react-patterns.md) — Using queries/mutations inside components
- [06-security.md](06-security.md) — Auth middleware on procedures, input validation
- [02-typescript.md](02-typescript.md) — Inferring types from Zod schemas (`z.infer<>`)
