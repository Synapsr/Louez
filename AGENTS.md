# Louez - AI Agent Context

> Universal context file for AI coding assistants. See also: [CLAUDE.md](./CLAUDE.md) for Claude-specific context.

## Overview

**Louez** is a multi-tenant, self-hosted equipment rental management platform. It provides rental businesses with inventory management, reservation handling, customer databases, and branded storefronts.

- **License**: MIT (open-source)
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

| Group | Path | Auth | Purpose |
|-------|------|------|---------|
| `(auth)` | `/login`, `/verify-request` | Public | Authentication |
| `(dashboard)` | `/dashboard/*`, `/onboarding/*` | Protected | Store management |
| `(storefront)` | `/{slug}/*` | Public | Customer-facing |

### Data Flow

```
Request → Middleware (subdomain detection) → Layout (auth check) → Page/Action
                                                     ↓
                                            getCurrentStore()
                                                     ↓
                                            Database (storeId filter)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js, Next.js 16, React 19 |
| Language | TypeScript 5 |
| Database | MySQL 8, Drizzle ORM |
| Auth | NextAuth v5 (OAuth, Email) |
| Validation | Zod |
| UI | Tailwind CSS 4, shadcn/ui, Radix UI |
| Forms | React Hook Form |
| Payments | Stripe Connect |
| Email | React Email, Nodemailer |
| PDF | @react-pdf/renderer |
| i18n | next-intl (fr, en) |

## Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Login pages
│   ├── (dashboard)/       # Protected admin routes
│   ├── (storefront)/      # Public store routes [slug]/
│   └── api/               # REST endpoints
├── components/
│   ├── ui/                # Base components (shadcn/ui)
│   ├── dashboard/         # Admin-specific
│   └── storefront/        # Customer-facing
├── lib/
│   ├── db/schema.ts       # Drizzle schema (20+ tables)
│   ├── auth.ts            # NextAuth config
│   ├── store-context.ts   # Multi-tenant utilities
│   ├── validations/       # Zod schemas
│   ├── email/templates/   # Email components
│   ├── pdf/               # Contract generation
│   └── pricing/           # Price calculations
├── contexts/              # React contexts
├── messages/              # i18n JSON files
└── types/                 # TypeScript definitions
```

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Run Prettier |
| `pnpm db:push` | Sync schema to DB |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:generate` | Generate migrations |
| `pnpm db:migrate` | Apply migrations |

## Coding Conventions

### Server Actions

Located in `actions.ts` files. Always:
1. Authenticate via `getCurrentStore()`
2. Validate input with Zod
3. Filter database queries by `storeId`
4. Return `{ success: true }` or `{ error: 'i18n.key' }`
5. Call `revalidatePath()` after mutations

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

- React Hook Form with Zod resolver
- Validation schemas in `src/lib/validations/`
- Error messages via i18n keys

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

- Database schema: `src/lib/db/schema.ts`
- Auth configuration: `src/lib/auth.ts`
- Multi-tenant context: `src/lib/store-context.ts`
- Middleware routing: `src/middleware.ts`
- Email templates: `src/lib/email/templates/`
- Pricing logic: `src/lib/pricing/`
