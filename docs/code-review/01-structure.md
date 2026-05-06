# Code Review — File Structure & Organization

> Applies when: any file is created, moved, or renamed.

## Rules

### [ST-01] App folder structure

Apps follow this layout:

```
apps/<app-name>/src/
├── app/              # Routes (Next.js App Router) or pages
├── components/
│   ├── shared/       # Cross-cutting: providers, headers, layouts, error boundaries
│   ├── ui/           # Custom UI (not from @louez/ui)
│   ├── form/         # Form field components (TanStack Form)
│   ├── podcast/      # Domain-specific components
│   └── channel/      # Domain-specific components
├── hooks/
│   └── form/         # useAppForm, form context
├── lib/
│   ├── queries/      # Query/mutation options factories (<domain>.queries.ts)
│   ├── stores/       # Zustand stores
│   └── validators/   # Shared Zod schemas (validator.<name>.ts)
├── server/           # Server-only logic (RPC, auth, middleware)
└── styles/           # Global styles
```

### [ST-02] Domain components are grouped in `components/<domain>/`

Domain-specific components live in `components/<domain>/` (e.g., `components/podcast/`, `components/channel/`). Each domain folder can contain its own hooks and utils. If something is used across multiple domains, move it up to `components/shared/`, `hooks/`, or `lib/`.

### [ST-03] File naming

| Type | Convention | Example |
|------|-----------|---------|
| Components | `kebab-case.tsx` | `podcast-card.tsx` |
| Hooks | `use-<name>.ts` | `use-podcast-list.ts` |
| Utils | `util.<name>.ts` | `util.format-date.ts` |
| Types | `<domain>.types.ts` | `podcast.types.ts` |
| Constants | `<domain>.constants.ts` | `podcast.constants.ts` |
| Query options | `<domain>.queries.ts` | `podcast.queries.ts` |
| Validators | `validator.<name>.ts` | `validator.podcast.ts` |
| Server routes | `route.<domain>.ts` | `route.podcast.ts` |

### [ST-04] No barrel files unless necessary

Don't create `index.ts` files that just re-export. Only use them for:
- Package entry points (`packages/*/src/index.ts`)

### [ST-05] Imports use path aliases

Use `@/` for app-internal imports. Use `@louez/<package>` for shared packages. Never use relative paths that go up more than one level (`../../`).

### [ST-06] Shared code goes in packages

If code is used across multiple apps, it belongs in `packages/`. Don't duplicate utils between apps.

### [ST-07] Colocation over separation

Keep related files close together. A component's types, constants, and tests live next to it — not in a top-level `types/` or `constants/` folder.

---

## Related

- [from-scratch/05-frontend.md](../from-scratch/05-frontend.md) — Full `components/`, `hooks/`, `lib/` layout with examples
- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — `server/` folder and oRPC route organization
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — Shared package structure (`packages/<name>/src/...`)
- [migration/03-extraction-patterns.md](../migration/03-extraction-patterns.md) — Reorganizing legacy code into this structure
