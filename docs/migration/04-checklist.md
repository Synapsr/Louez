# Migration — Post-Migration Checklist

Run this checklist after completing a migration pass. Items are split into **required** (must be done — impacts correctness, safety, or maintainability) and **recommended** (ideal target — can be deferred if the project already works with its current tooling).

---

## Required

These must be addressed during migration. They prevent bugs, security issues, or unmaintainable code.

### Type safety

- [ ] TypeScript strict mode enabled
- [ ] Zero `any` types (or documented exceptions)
- [ ] No `@ts-ignore` / `@ts-expect-error`
- [ ] Zod schemas for all API inputs
- [ ] Types inferred from schemas, not manually duplicated

### Structure

- [ ] Domain components organized in `components/<domain>/` folders
- [ ] Shared components in `components/shared/`
- [ ] Custom UI in `components/ui/`
- [ ] No files with `../../..` imports
- [ ] No circular dependencies
- [ ] Shared code extracted to `packages/`

### Data layer

- [ ] All server data managed by React Query via query options factories
- [ ] No `useState` + `useEffect` fetch patterns remaining
- [ ] No wrapper hooks around `useQuery`/`useMutation`
- [ ] Options factories in `lib/queries/<domain>.queries.ts`
- [ ] Mutations invalidate relevant query keys
- [ ] API routes have Zod input validation

### Components

- [ ] Components use `const` arrow functions
- [ ] One component per file — no inline helpers
- [ ] No business logic in render bodies
- [ ] Interactive elements use an accessible component library
- [ ] List keys use stable IDs

### Security

- [ ] All API routes check authentication
- [ ] Authorization is resource-level
- [ ] No secrets in client code
- [ ] File uploads validated

### Naming

- [ ] Files: kebab-case
- [ ] Hooks: `use-<name>.ts`
- [ ] Utils: `util.<name>.ts`
- [ ] Components: PascalCase exports, kebab-case files

---

## Recommended

These align the project with our full stack conventions. They improve consistency but don't block a working app. Adopt them when it makes sense — don't force a tool swap just for conformance.

### Tooling

- [ ] OXC (oxlint + oxfmt) replaces ESLint + Prettier (currently using ESLint + Prettier)
- [ ] `.oxlintrc.json` present at monorepo root (replacing `.eslintrc*` + `prettier.config.*`)
- [ ] `pnpm lint` passes with zero warnings

### Stack alignment

- [ ] oRPC for type-safe API (if migrating from tRPC, REST, etc.)
- [ ] TanStack Form + `useAppForm` for forms (if migrating from React Hook Form, Formik, etc.)
- [ ] Better Auth for authentication (if migrating from NextAuth, custom auth, etc.)
- [ ] Query keys managed by oRPC (`orpc.<domain>.key()`)

### Build & CI

- [ ] Path aliases configured (`@/` for app, `@louez/` for packages)
- [ ] `pnpm check-types` passes
- [ ] `pnpm build` succeeds

### Naming (extended)

- [ ] DB tables: `<name>Table` (singular)
- [ ] DB schemas: `schema.<domain>.ts`
- [ ] DB constants: `constant.<domain>.ts`
- [ ] Query options: `<domain>.queries.ts` in `lib/queries/`

---

## Related

- [01-audit.md](01-audit.md) — Audit before migrating
- [02-strategy.md](02-strategy.md) — Migration approach and order
- [03-extraction-patterns.md](03-extraction-patterns.md) — Concrete patterns for each checklist section
- [code-review/07-checklist.md](../code-review/07-checklist.md) — Per-commit checklist (use after migration is complete)
