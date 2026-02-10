# Louez - AI Agent Context

> Universal context file for AI coding assistants. See also: [CLAUDE.md](./CLAUDE.md) for Claude-specific context.

## Overview

**Louez** is a multi-tenant, self-hosted equipment rental management platform. It provides rental businesses with inventory management, reservation handling, customer databases, and branded storefronts.

- **License**: MIT (open-source)
- **Monorepo**: Turborepo + pnpm workspaces
- **Language**: TypeScript (strict mode)
- **Framework**: Next.js 16 with App Router

## Architecture

### Multi-Tenant Model

Each `store` operates independently with its own:

- Products, categories, pricing tiers
- Customers and reservations
- Settings, branding, legal pages
- Team members (owner/member roles)

**Subdomain routing**:

- `app.domain.com` → Admin dashboard
- `{store-slug}.domain.com` → Public storefront

### Route Groups

| Group          | Path                            | Auth      | Purpose          |
| -------------- | ------------------------------- | --------- | ---------------- |
| `(auth)`       | `/login`, `/verify-request`     | Public    | Authentication   |
| `(dashboard)`  | `/dashboard/*`, `/onboarding/*` | Protected | Store management |
| `(storefront)` | `/{slug}/*`                     | Public    | Customer-facing  |

### Data Flow

**Server Actions (mutations)**:

```
Request → Middleware (subdomain detection) → Layout (auth check) → Page/Action
                                                     ↓
                                            getCurrentStore()
                                                     ↓
                                            Database (storeId filter)
```

**oRPC (queries/mutations)**:

```
Client Component → orpc.dashboard.*.queryOptions() → /api/rpc/[...path]
                                                           ↓
                                                    RPCHandler → Procedure middleware
                                                           ↓
                                                    getCurrentStore() / getCustomerSession()
                                                           ↓
                                                    Database (storeId filter)
```

## Tech Stack

| Layer         | Technology                           |
| ------------- | ------------------------------------ |
| Monorepo      | Turborepo + pnpm workspaces          |
| Runtime       | Node.js, Next.js 16, React 19        |
| Language      | TypeScript 5                         |
| Database      | MySQL 8, Drizzle ORM                 |
| Auth          | Better Auth (OAuth, Magic Link, OTP) |
| API           | oRPC (type-safe RPC)                 |
| Data Fetching | TanStack Query                       |
| Validation    | Zod                                  |
| UI            | Tailwind CSS 4, shadcn/ui, Base UI   |
| Forms         | TanStack Form                        |
| Payments      | Stripe Connect                       |
| Email         | React Email, Nodemailer              |
| PDF           | @react-pdf/renderer                  |
| i18n          | next-intl (fr, en)                   |

## Monorepo Architecture

This project uses **Turborepo** with **pnpm workspaces** for monorepo management.

### Workspaces

| Workspace    | Package Prefix | Purpose                      |
| ------------ | -------------- | ---------------------------- |
| `apps/*`     | `@louez/`      | Deployable applications      |
| `packages/*` | `@louez/`      | Shared libraries and configs |

### Task Pipeline

Turborepo manages task execution with automatic dependency resolution and caching.

**Cached tasks** (outputs stored for replay):

- `build` - Production builds (outputs: `dist/**`, `.next/**`)
- `lint` - ESLint checks
- `type-check` - TypeScript validation

**Non-cached tasks** (always run):

- `dev` - Development server (persistent)
- `db:*` - Database operations (side effects)
- `clean` - Cleanup

### Filtering

Run tasks for specific packages using `--filter`:

```bash
# Run dev for web app only
pnpm dev --filter=@louez/web

# Build a specific package
pnpm build --filter=@louez/db

# Type-check web and its dependencies
pnpm type-check --filter=@louez/web...

# Run for all packages except one
pnpm build --filter=!@louez/config
```

### Adding a New Package

1. Create directory in `packages/` or `apps/`
2. Add `package.json` with `"name": "@louez/package-name"`
3. Run `pnpm install` to link workspaces
4. Import in other packages: `import { x } from '@louez/package-name'`

## Directory Structure

```
louez/
├── apps/
│   └── web/                        # Next.js application
│       ├── app/                    # Next.js App Router
│       │   ├── (auth)/            # Login pages
│       │   ├── (dashboard)/       # Protected admin routes
│       │   ├── (storefront)/      # Public store routes [slug]/
│       │   └── api/               # API endpoints (including /api/rpc)
│       ├── components/
│       │   ├── ui/                # Base components (shadcn/ui)
│       │   ├── dashboard/         # Admin-specific
│       │   └── storefront/        # Customer-facing
│       ├── lib/
│       │   ├── auth.ts            # Better Auth config + backward-compatible auth() wrapper
│       │   ├── auth-client.ts     # Better Auth React client (signIn, signOut, OTP)
│       │   ├── store-context.ts   # Multi-tenant utilities
│       │   └── orpc/              # oRPC client utilities
│       ├── contexts/              # React contexts
│       └── messages/              # i18n JSON files
│
├── packages/
│   ├── api/                       # @louez/api - oRPC router & procedures
│   │   └── src/
│   │       ├── router.ts          # Root router
│   │       ├── procedures.ts      # Base procedures (public, dashboard, storefront)
│   │       ├── context.ts         # Context type definitions
│   │       └── routers/           # Feature routers
│   │           ├── dashboard/     # Admin procedures
│   │           └── storefront/    # Customer procedures
│   ├── db/                        # @louez/db - Drizzle schema & connection
│   ├── validations/               # @louez/validations - Zod schemas
│   ├── types/                     # @louez/types - Shared TypeScript types
│   ├── utils/                     # @louez/utils - Shared utilities
│   └── ui/                        # @louez/ui - shadcn/ui components
```

## Commands

All commands run through Turborepo. Use `--filter` to target specific packages.

| Command                          | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `pnpm dev`                       | Start all dev servers (Turbo TUI)     |
| `pnpm dev:web`                   | Start web app only                    |
| `pnpm build`                     | Production build (all packages)       |
| `pnpm build --filter=@louez/web` | Build web app only                    |
| `pnpm type-check`                | TypeScript check (all packages)       |
| `pnpm type-check:web`            | Type-check web only                   |
| `pnpm lint`                      | Run ESLint + duplicate audit          |
| `pnpm audit:duplicates`          | Detect exact duplicate files          |
| `pnpm format`                    | Run Prettier                          |
| `pnpm clean`                     | Remove build artifacts & node_modules |
| `pnpm db:push`                   | Sync schema to DB                     |
| `pnpm db:studio`                 | Open Drizzle Studio                   |
| `pnpm db:generate`               | Generate migrations                   |
| `pnpm db:migrate`                | Apply migrations                      |

## Coding Conventions

### Server Actions

Located in `actions.ts` files. Always:

1. Authenticate via `getCurrentStore()`
2. Validate input with Zod
3. Filter database queries by `storeId`
4. Return `{ success: true }` or `{ error: 'i18n.key' }`
5. Call `revalidatePath()` after mutations

### oRPC (Type-Safe API)

For new API calls, use oRPC instead of REST for end-to-end type safety.
When touching existing app-owned REST endpoints or page-local API logic, prefer migrating that logic into `@louez/api` procedures/services and consume it via `orpc.*` from the web app.
Keep route handlers for integration-style endpoints where oRPC is not a fit (for example webhooks, third-party callbacks, or transport-specific streaming handlers).

**Defining procedures** (`packages/api/src/routers/`):

```typescript
import { z } from 'zod';

import { dashboardProcedure } from '../../procedures';

export const myRouter = {
  getItems: dashboardProcedure
    .input(z.object({ status: z.string().optional() }))
    .handler(async ({ input, context }) => {
      // context.store is available (multi-tenant isolated)
      return db.query.items.findMany({
        where: eq(items.storeId, context.store.id),
      });
    }),
};
```

**Client usage** (in React components):

```typescript
import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/lib/orpc/react';

function MyComponent() {
  const { data, isLoading } = useQuery(
    orpc.dashboard.myRouter.getItems.queryOptions({
      input: { status: 'active' },
    }),
  );
}
```

**Base procedures**:

- `publicProcedure` - No auth required
- `dashboardProcedure` - Requires authenticated user + store access
- `storefrontProcedure` - Public but requires store context (via header)
- `storefrontAuthProcedure` - Requires authenticated customer
- `requirePermission('write')` - Requires specific permission

### Components

- Use `cn()` for conditional classes (from `src/lib/utils.ts`)
- Prefer shared primitives from `@louez/ui` first
- Use `apps/web/components/ui/` only for app-specific composition/wrappers
- Use CVA for variant-based styling
- Keep components in appropriate domain folder

### Module Ownership (Critical)

- Follow `docs/architecture/module-ownership.md` as the single source of truth
- Shared UI tokens/primitives: `packages/ui`
- Shared types: `packages/types`
- Shared validations: `packages/validations`
- Shared pricing logic: `packages/utils/src/pricing`
- Shared DB schema + migrations: `packages/db/src`
- Never recreate shared modules under:
  - `apps/web/lib/pricing/*`
  - `apps/web/types/*`
  - `apps/web/lib/validations/*`
  - `apps/web/lib/db/*`

### Database

- All primary keys: 21-char nanoid
- All monetary values: DECIMAL(10,2)
- Always include `storeId` in queries (multi-tenant isolation)
- Use relations defined in schema for joins
- Migrations and snapshots live in `packages/db/src/migrations` only

### Forms

- TanStack Form with Zod validation via `useAppForm` hook
- Shared validation schemas live in `packages/validations`
- Error messages via i18n keys
- For client-side async submissions (auth flows, save actions, etc.), prefer `useMutation` from TanStack Query over manual loading/error `useState`
- If `mutateAsync` is called from `onSubmit`, handle expected failures explicitly (`try/catch` or use `mutate` + `onError`) to avoid rejected submit promises leaking to logs
- Keep field values in `useAppForm` when practical; reserve `useState` for flow state (for example, step toggles)
- See details at `docs/FORM_HANDLING.md`

### Internationalization

- Translations in `src/messages/{locale}.json`
- Prefer one `useTranslations()` call per file/component and reuse that single translator across the file
- Allow exceptions only when Next.js boundaries require it (for example separate server/client translation APIs)
- Prefer calling `useTranslations()` inside each component file instead of passing translator functions through props, to preserve i18n Ally key inference and local type safety
- Keep related keys grouped in the same message namespace so i18n Ally can detect and manage them consistently
- Reuse existing translation keys before creating new ones
- Error keys follow pattern: `errors.{errorType}`

### Reuse Existing Logic

- Reuse existing helpers, UI primitives, and domain logic before introducing new abstractions
- Prefer extending current patterns over creating parallel implementations for similar behavior
- Extract helper functions when they are pure, non-UI, and add visual noise in page/component files
- Keep logic inline when it is tiny and only meaningful next to a single JSX interaction
- Prefer colocated utils first for feature-specific helpers
- Move shared helpers to `lib/utils/util.<name>` when they are reused across features

## Key Domain Concepts

### Reservation Flow

```
pending → confirmed → ongoing → completed
    ↓         ↓
 rejected  cancelled
```

### Pricing Modes

- `hour`: Hourly rental
- `day`: Daily rental
- `week`: Weekly rental

### Payment Methods

`stripe` | `cash` | `card` | `transfer` | `check` | `other`

### User Roles

- `owner`: Full access including settings and team management
- `member`: Read and write access only

## Security Requirements

- Never commit secrets or `.env` files
- Always validate user input with Zod
- Always filter by `storeId` (prevents cross-tenant access)
- Use `currentUserHasPermission()` for sensitive operations
- Customer sessions use separate auth (passwordless OTP)

## Testing Workflow

1. `pnpm lint` - Run ESLint and duplicate-audit guardrail
2. `pnpm type-check:web` - Verify TypeScript compiles
3. `pnpm build --filter=@louez/web` - Verify production build
4. Test dashboard at `localhost:3000`
5. Test storefront at `localhost:3000/{slug}` (with PREVIEW_MODE=slug)
6. Check console for runtime errors

## Documentation References

- Database schema: `packages/db/src/schema.ts`
- Auth configuration: `apps/web/lib/auth.ts` (Better Auth server + backward-compatible `auth()` wrapper)
- Auth client: `apps/web/lib/auth-client.ts` (Better Auth React client)
- Multi-tenant context: `apps/web/lib/store-context.ts`
- Middleware routing: `apps/web/middleware.ts`
- oRPC router: `packages/api/src/router.ts`
- oRPC procedures: `packages/api/src/procedures.ts`
- oRPC client: `apps/web/lib/orpc/`
- Email templates: `apps/web/lib/email/templates/`
- Pricing logic: `packages/utils/src/pricing/`
- Module ownership rules: `docs/architecture/module-ownership.md`
