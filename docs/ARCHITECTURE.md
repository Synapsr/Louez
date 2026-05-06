# Architecture Reference

This document is the entry point for all architecture and convention decisions across our projects. It serves as a reference for both AI agents and human developers.

## Core Principles

1. **Always monorepo** — Every project uses Turborepo + pnpm workspaces.
2. **Type-safe end-to-end** — TypeScript strict mode, from DB schema to UI props.
3. **Shared packages over copy-paste** — Common logic lives in `packages/`, never duplicated across apps.
4. **Minimal abstraction** — No premature helpers or wrappers. Three similar lines > one clever abstraction.
5. **Convention over configuration** — File naming, folder structure, and patterns are standardized so any team member (or agent) can navigate any project instantly.

## Imposed Stack

| Layer | Technology | Non-negotiable |
|-------|-----------|----------------|
| Monorepo | Turborepo + pnpm | Yes |
| Language | TypeScript (strict) | Yes |
| Database | MySQL + Drizzle ORM | Yes |
| Auth | Better Auth | Yes |
| API | ORPC | Yes |
| Server state | TanStack React Query | Yes |
| Client state | Zustand | Yes |
| Forms | TanStack Form + Zod | Yes |
| Styling | Tailwind CSS | Yes |
| UI primitives | @base-ui/react in `packages/ui` | Yes |

## Multi-Tenant Model

Each `store` operates independently with its own:

- Products, categories, pricing tiers
- Customers and reservations
- Settings, branding, legal pages
- Team members (owner/member roles)

**Subdomain routing:**

- `app.domain.com` → Admin dashboard
- `{store-slug}.domain.com` → Public storefront

## Domain Model

### Reservation flow

```
pending → confirmed → ongoing → completed
    ↓         ↓
 rejected  cancelled
```

### Pricing modes

- `hour` — Hourly rental
- `day` — Daily rental
- `week` — Weekly rental

### Payment methods

`stripe` | `cash` | `card` | `transfer` | `check` | `other`

### User roles

- `owner` — Full access including settings and team management
- `member` — Read and write access only

## Framework Decision

Pick the framework based on the project's rendering needs:

| If the project is... | Use |
|----------------------|-----|
| Server-rendered / content site / SEO-heavy | **Next.js** (App Router) |
| Client-heavy SPA / dashboard / interactive-first | **TanStack Start** |

When in doubt, default to **Next.js**.

## Documents

### From Scratch — Starting a new project

| File | Topic |
|------|-------|
| [01-monorepo-setup.md](from-scratch/01-monorepo-setup.md) | Turborepo + pnpm workspace init |
| [02-framework-decision.md](from-scratch/02-framework-decision.md) | Next.js vs TanStack Start decision tree |
| [03-packages.md](from-scratch/03-packages.md) | Shared packages structure |
| [04-backend.md](from-scratch/04-backend.md) | API, DB, auth setup |
| [05-frontend.md](from-scratch/05-frontend.md) | Components, state, styling |
| [06-tooling.md](from-scratch/06-tooling.md) | Linting, formatting, TypeScript config |

### Migration — Cleaning up existing projects

| File | Topic |
|------|-------|
| [01-audit.md](migration/01-audit.md) | Diagnosing spaghetti code |
| [02-strategy.md](migration/02-strategy.md) | Incremental vs big-bang approach |
| [03-extraction-patterns.md](migration/03-extraction-patterns.md) | Extracting packages, splitting features |
| [04-checklist.md](migration/04-checklist.md) | Post-migration conformance checklist |

### Code Review — Pre-commit quality gate

Applied contextually: the agent (or reviewer) checks only the rules relevant to the files changed in the diff.

| File | Applies when... |
|------|----------------|
| [00-general.md](code-review/00-general.md) | Any change |
| [01-structure.md](code-review/01-structure.md) | Any file created, moved, or renamed |
| [02-typescript.md](code-review/02-typescript.md) | Any `.ts` / `.tsx` file changed |
| [03-react-patterns.md](code-review/03-react-patterns.md) | React components or hooks changed |
| [04-data-layer.md](code-review/04-data-layer.md) | Drizzle queries, ORPC routes, React Query hooks |
| [05-styling.md](code-review/05-styling.md) | Tailwind classes or style files changed |
| [06-security.md](code-review/06-security.md) | Auth, API routes, user input handling |
| [07-checklist.md](code-review/07-checklist.md) | **Always** — condensed pass/fail checklist |

## How to Use (for AI agents)

When asked to commit or review code:

1. Run `git diff --staged` (or `git diff` if nothing staged) to see what changed.
2. Categorize changed files by domain (structure, React, data layer, etc.).
3. Load **only** the relevant `code-review/` files for those domains.
4. Always load `code-review/07-checklist.md` as a final pass.
5. Flag violations with the rule reference (e.g., `[TS-03]`). Don't flag what's clean.
6. If everything passes, proceed with the commit. No summary needed.
