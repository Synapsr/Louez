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

Change a reservation's status with `changeReservationStatus` and insert a reservation with `insertReservation`, both from `@louez/db`, in the caller's transaction. The status helper locks the row, checks the transition, moves consumable stock, sets `billableAt` and `withdrawnAt`, and writes the activity row. Both helpers return fee effects. Run them with `runReservationEffects` after the commit. packages/api receives the runner as an argument. packages/mcp receives a status change function from apps/web, which runs them.

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

### [DL-13] Writes that change a billing snapshot mark it

With the billing service on, Louez sends it snapshots of stores, reservations and legacy billing (louez-billing `docs/api`). A write that can change a snapshot marks its aggregate in the same transaction, with `markReservation`, `markReservationIds`, `markStoreReservations`, `markStore`, `markLegacyStore`, `markSubscriptionRow` (a `subscriptions` row), `markLegacyMonth` or `markBillingDirty` from `@louez/db`, or `billingMarkStatement` on a raw mysql2 connection. A write with no transaction gets one, with its mark; Stripe calls, emails and fetches stay outside it. `changeReservationStatus` and `insertReservation` mark the reservation themselves. With the service off, the marks write nothing.

Mark only when a field the builders read can change (`apps/web/lib/billing-sync/snapshots`): notes, signatures and Tulip ids need none. The nightly sweep catches a missed mark within a day.

`scripts/billing-marks.test.mjs` enforces this rule in `pnpm test`. A file that writes payments, disputes, platform fees, pay-as-you-go invoices, subscriptions, legal profiles, members, marketplace channels, referral rewards or reservation items, or updates a column the builders read on stores, reservations or reservation items, must reference a mark helper. It checks the file, not the transaction. A write that changes no snapshot field goes on the test's allowlist with its reason.

---

## Related

- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Full Drizzle + oRPC + React Query setup
- [03-react-patterns.md](03-react-patterns.md) — Using queries/mutations inside components
- [06-security.md](06-security.md) — Auth middleware on procedures, input validation
- [02-typescript.md](02-typescript.md) — Inferring types from Zod schemas (`z.infer<>`)
