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

| Layer         | Technology                          |
| ------------- | ----------------------------------- |
| Monorepo      | Turborepo + pnpm workspaces         |
| Runtime       | Node.js, Next.js 16, React 19       |
| Language      | TypeScript 5                        |
| Database      | MySQL 8, Drizzle ORM                |
| Auth          | Better Auth (OAuth, Magic Link, OTP)|
| API           | oRPC (type-safe RPC)                |
| Data Fetching | TanStack Query                      |
| Validation    | Zod                                 |
| UI            | Tailwind CSS 4, shadcn/ui, Radix UI |
| Forms         | TanStack Form                       |
| Payments      | Stripe Connect                      |
| Email         | React Email, Nodemailer             |
| PDF           | @react-pdf/renderer                 |
| i18n          | next-intl (fr, en)                  |

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
| `pnpm lint`                      | Run ESLint                            |
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
- Prefer shadcn/ui components from `src/components/ui/`
- Use CVA for variant-based styling
- Keep components in appropriate domain folder

### Database

- All primary keys: 21-char nanoid
- All monetary values: DECIMAL(10,2)
- Always include `storeId` in queries (multi-tenant isolation)
- Use relations defined in schema for joins

### Forms

- TanStack Form with Zod validation via `useAppForm` hook
- Validation schemas in `src/lib/validations/`
- Error messages via i18n keys
- See details at `docs/FORM_HANDLING.md`

### Internationalization

- Translations in `src/messages/{locale}.json`
- Use `useTranslations()` hook in components
- Error keys follow pattern: `errors.{errorType}`

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

1. `pnpm build` - Verify TypeScript compiles
2. Test dashboard at `localhost:3000`
3. Test storefront at `localhost:3000/{slug}` (with PREVIEW_MODE=slug)
4. Check console for runtime errors

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
- Pricing logic: `apps/web/lib/pricing/`
