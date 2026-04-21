# From Scratch — Backend

## Database — Drizzle + MySQL

### Schema conventions

```typescript
import { mysqlTable, varchar, char, timestamp } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";

export const podcastTable = mysqlTable("podcast", {
  id: char("id", { length: 21 }).primaryKey().$defaultFn(() => nanoid()),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
```

Rules:
- Table variable: `<name>Table` (singular)
- Column names: `snake_case` in SQL, `camelCase` in TypeScript
- Every table has `createdAt` and `updatedAt`
- Use `varchar` with explicit length, not `text`, unless unbounded content
- Foreign keys reference the column explicitly
- All primary keys: 21-char nanoid (not auto-increment integers)
- All monetary values: `DECIMAL(10,2)`
- Always include `storeId` in queries (multi-tenant isolation)
- Use relations defined in schema for joins
- Migrations and snapshots live in `packages/db/src/migrations` only

### Migrations

- `pnpm db:generate` to generate migrations from schema changes
- `pnpm db:push` for development (direct push)
- Migrations are committed to the repo

## API — oRPC

[oRPC](https://orpc.dev/) provides type-safe RPC with OpenAPI spec generation built in.

### Procedures

Define procedures with the `os` builder, Zod input/output validation, and handlers:

```typescript
// server/routes/route.podcast.ts
import { os, ORPCError } from "@orpc/server";
import { z } from "zod";

const listPodcasts = os
  .input(z.object({
    channelId: z.string(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.number().int().min(0).default(0),
  }))
  .handler(async ({ input }) => {
    // ...
  });
```

### Middleware & auth

Use middleware to enrich context (e.g., auth check):

```typescript
const authed = os
  .$context<{ headers: Headers }>()
  .use(({ context, next }) => {
    const user = await getSession(context.headers);
    if (!user) throw new ORPCError("UNAUTHORIZED");
    return next({ context: { user } });
  });

const createPodcast = authed
  .input(podcastCreateSchema)
  .handler(async ({ input, context }) => {
    // context.user is typed and guaranteed
  });
```

### Router structure

Routers are plain nested objects grouping procedures by domain:

```typescript
export const router = {
  studio: {
    podcast: {
      list: listPodcasts,
      create: createPodcast,
    },
    channel: {
      // ...
    },
  },
  user: {
    // ...
  },
};
```

### Server handler

Use `RPCHandler` to serve the router (Next.js route handler, etc.):

```typescript
import { RPCHandler } from "@orpc/server/node";

const handler = new RPCHandler(router);
```

### OpenAPI spec (optional, opt-in)

OpenAPI generation is not enabled by default, but procedures should be written so it can be turned on later with minimal effort. The key: always define `.output()` schemas on your procedures — that's the main thing needed for spec generation.

When you need to activate OpenAPI, add `.route()` to expose HTTP methods/paths and set up the generator:

```typescript
const listPodcasts = os
  .route({ method: "GET", path: "/podcasts" })
  .input(z.object({ channelId: z.string() }))
  .output(z.array(podcastSchema))
  .handler(async ({ input }) => {
    // ...
  });
```

Generate and serve the spec:

```typescript
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/openapi";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

const spec = await generator.generate(router, {
  info: { title: "My API", version: "1.0.0" },
});
```

### TanStack Query integration

Create a typed query utils from the oRPC client:

```typescript
// lib/orpc.ts
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

export const orpc = createTanstackQueryUtils(client);
```

Usage via query options factories (not wrapper hooks):

```typescript
// lib/queries/podcast.queries.ts
export const podcastQueries = {
  list: (channelId: string) =>
    orpc.studio.podcast.list.queryOptions({
      input: { channelId },
    }),
  detail: (podcastId: string) =>
    orpc.studio.podcast.find.queryOptions({
      input: { podcastId },
    }),
};

export const podcastMutations = {
  create: () =>
    orpc.studio.podcast.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.studio.podcast.key(),
        });
      },
    }),
};
```

```typescript
// In a component — direct usage, no wrapper hook
const { data } = useQuery(podcastQueries.list(channelId));
const mutation = useMutation(podcastMutations.create());
```

Key patterns:
- Options factories in `lib/queries/<domain>.queries.ts`
- `orpc.<domain>.<action>.queryOptions()` for queries
- `orpc.<domain>.<action>.mutationOptions()` for mutations
- `orpc.<domain>.key()` for broad cache invalidation
- `orpc.<domain>.<action>.queryKey({ input })` for specific cache entries
- Components call `useQuery(factory())` directly — no wrapper hooks

### Rules

- Every procedure has Zod input validation
- Public procedures use base `os`, authenticated ones go through `authed` middleware
- Group procedures by domain in the router object
- Always add `.output()` so OpenAPI can be enabled later. Add `.route()` only when OpenAPI is activated
- Business logic can be extracted to service functions if complex
- No wrapper hooks around `useQuery`/`useMutation` — use options factories

## Authentication — Better Auth

- Session-based auth with Better Auth
- Social/SSO providers configured per project
- Session check via middleware or `protectedProcedure`
- Roles and permissions managed via Permix (when granular access is needed)

## Asset Management — Directus

Most projects use [Directus](https://directus.io/) as a DAM (Digital Asset Management) and headless CMS for file storage (images, audio, etc.).

### Schema integration

Directus manages its own tables (`directus_files`, `directus_folders`, etc.). In Drizzle, we mirror the `directus_files` table as `directusFilesTable` in `schema.directus.ts` so we can define relations from our app tables to Directus files.

```typescript
// schema.directus.ts — read-only mirror of the Directus files table
export const directusFilesTable = mysqlTable("directus_files", {
  id: char({ length: 36 }).notNull(),
  storage: varchar({ length: 255 }).notNull(),
  filenameDisk: varchar("filename_disk", { length: 255 }),
  filenameDownload: varchar("filename_download", { length: 255 }).notNull(),
  title: varchar({ length: 255 }),
  type: varchar({ length: 255 }),
  // ...
});
```

App tables reference Directus files via `char({ length: 36 }).references(() => directusFilesTable.id)`.

### Directus migrations

When the Drizzle schema introduces new collections or fields that need to be visible/editable in Directus, you must also configure them in Directus. This is a separate step from `db:push`.

#### What to configure in Directus after a schema change

1. **Collection registration** — Register the new table as a Directus collection so it appears in the admin UI
2. **Fields configuration** — For each column:
   - Set the correct **interface** (input, select-dropdown, file-image, etc.)
   - Set the correct **display** for list views
   - Add **translations** (French labels for field names and descriptions)
   - Set an **icon** for the collection (Material Icons)
3. **Relations** — Configure M2O / O2M / M2M relations so they're navigable in the Directus UI
4. **Layout & grouping** — Order fields logically, group related fields together

#### Checklist for new collections

- [ ] Collection created in Directus with a French display name
- [ ] Collection has an icon (Material Icons)
- [ ] All fields have French translations (label + description when useful)
- [ ] Relations are configured and navigable in the UI
- [ ] File/image fields use the correct Directus interface (`file-image`, `file`)
- [ ] Status fields use a dropdown with translated options
- [ ] Fields are ordered logically (not alphabetically)
- [ ] Collection is accessible via the correct Directus role permissions

#### Checklist for new fields on existing collections

- [ ] Field has a French translation
- [ ] Interface and display type are set
- [ ] If it's a relation, the relation is configured in Directus
- [ ] Field is positioned in the right group/order

---

## Related

- [03-packages.md](03-packages.md) — `@louez/db`, `@louez/auth`, `@louez/api`
- [05-frontend.md](05-frontend.md) — Frontend integration (React Query, options factories)
- [code-review/04-data-layer.md](../code-review/04-data-layer.md) — Drizzle + oRPC + React Query rules (rationale)
- [code-review/06-security.md](../code-review/06-security.md) — Auth checks, input validation at route boundaries
- [code-review/02-typescript.md](../code-review/02-typescript.md) — Type inference from schemas
