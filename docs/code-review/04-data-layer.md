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

| Pattern | Convention |
|---------|-----------|
| Query options factory | `lib/queries/<domain>.queries.ts` — exports typed options |
| Query options | `orpc.<domain>.<action>.queryOptions({ input })` — keys are auto-managed |
| Mutation options | `orpc.<domain>.<action>.mutationOptions()` |
| Broad invalidation | `queryClient.invalidateQueries({ queryKey: orpc.<domain>.key() })` |
| Specific cache | `orpc.<domain>.<action>.queryKey({ input })` |

Never define manual query keys — oRPC generates them automatically.

### [DL-08] Options factories, not wrapper hooks

Don't wrap `useQuery`/`useMutation` in custom hooks. Export **query/mutation options factories** from `lib/queries/<domain>.queries.ts`. Components call `useQuery(podcastQueries.list(channelId))` directly. This preserves type inference, allows per-call overrides, and keeps options reusable for prefetching and testing.

### [DL-09] Optimistic updates only when UX demands it

Don't add optimistic updates by default. Use them only when the perceived latency is a real UX problem (e.g., toggling a like, reordering a list). Simple CRUD can wait for the server response.

### [DL-10] Always define `.output()` on procedures

Every oRPC procedure must have an `.output()` Zod schema. This enables OpenAPI generation later without touching procedure code.

### [DL-11] Error handling at route boundaries

oRPC routes handle errors and return typed error responses. Don't let raw database errors bubble up to the client.

---

## Related

- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Full Drizzle + oRPC + React Query setup
- [03-react-patterns.md](03-react-patterns.md) — Using queries/mutations inside components
- [06-security.md](06-security.md) — Auth middleware on procedures, input validation
- [02-typescript.md](02-typescript.md) — Inferring types from Zod schemas (`z.infer<>`)
