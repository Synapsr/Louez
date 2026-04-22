# Code Review — Pre-Commit Checklist

> This file is always loaded before a commit. It is the condensed, actionable version of all code-review rules.

## How to use

1. Look at the diff (staged or unstaged).
2. Identify which **domains** are touched based on file types and content.
3. Check **only** the relevant sections below.
4. If a rule is violated, fix it before committing.
5. If everything passes, commit. No summary needed.

## Domain detection

| If the diff contains... | Check section |
|------------------------|---------------|
| New/renamed/moved files | **Structure** |
| Any `.ts` / `.tsx` changes | **TypeScript** |
| React components or hooks | **React** |
| Drizzle queries, oRPC routes, query options factories | **Data Layer** |
| TanStack Form, `useAppForm`, form components | **Forms** |
| Tailwind classes, style changes | **Styling** |
| Auth, API routes, user input | **Security** |

---

## Structure

- [ ] Files follow naming convention (kebab-case, `use-` for hooks, `util.` for utils)
- [ ] Domain components are in `components/<domain>/`, not scattered
- [ ] Query options in `lib/queries/<domain>.queries.ts`
- [ ] No unnecessary barrel files (`index.ts`)
- [ ] Imports use `@/` or `@louez/`, no deep relative paths (`../../..`)
- [ ] Shared code lives in `packages/`, not duplicated

## TypeScript

- [ ] No `any` — use `unknown` + type guards
- [ ] No `as` casting — prefer `satisfies`
- [ ] Zod schemas at system boundaries, types inferred with `z.infer<>`
- [ ] No non-null assertions (`!`) in business logic

## React

- [ ] Components are `const` arrow functions
- [ ] One component per file — no inline helpers
- [ ] No business logic in components (extract to hooks/utils)
- [ ] Server data uses React Query, not Zustand
- [ ] No `useEffect` for derived state — compute inline
- [ ] List keys use stable IDs, not array indices
- [ ] Interactive elements use @base-ui/react (from `@louez/ui`)

## Data Layer

- [ ] Drizzle queries select only needed columns
- [ ] Multi-table writes use transactions
- [ ] oRPC inputs validated with Zod, `.output()` defined on every procedure
- [ ] Query/mutation options come from factories in `lib/queries/`, not wrapper hooks
- [ ] Components use `useQuery(factory())` directly — no custom hooks around `useQuery`
- [ ] Errors handled at route level, not raw DB errors to client

## Forms

- [ ] Forms use TanStack Form via `useAppForm`
- [ ] Validation with Zod schemas (inline or in `lib/validators/`)
- [ ] Async operations wrapped in `useMutation`, not directly in `onSubmit`
- [ ] Field components registered in `hooks/form/form.tsx`
- [ ] `revalidateLogic` configured (submit → change after first attempt)

## Styling

- [ ] Tailwind only, no custom CSS (unless justified)
- [ ] No `style={{ }}` — use Tailwind classes
- [ ] Conditional classes use `cn()` / `clsx()`
- [ ] No hardcoded colors — use design tokens

## Security

- [ ] API routes check authentication
- [ ] Authorization is resource-level (not just "is logged in")
- [ ] All external input validated with Zod
- [ ] No secrets in client code
- [ ] Queries filter by `storeId` (multi-tenant isolation)
- [ ] No `dangerouslySetInnerHTML` without sanitization

---

## Related

This checklist is the condensed version of the full `code-review/` rules. Open the matching file when you need the rationale or examples behind a checkbox:

- [00-general.md](00-general.md) — General rules (env vars, imposed stack)
- [01-structure.md](01-structure.md) — File & folder organization
- [02-typescript.md](02-typescript.md) — TypeScript rules
- [03-react-patterns.md](03-react-patterns.md) — React component rules
- [04-data-layer.md](04-data-layer.md) — Drizzle, oRPC, React Query
- [05-styling.md](05-styling.md) — Tailwind rules
- [06-security.md](06-security.md) — Auth, input validation, secrets

For migrations, use [migration/04-checklist.md](../migration/04-checklist.md) instead — it covers both required items and alignment targets.
