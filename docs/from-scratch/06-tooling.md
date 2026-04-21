# From Scratch — Tooling

## TypeScript

- Strict mode enabled (`"strict": true`)
- Base config in `@louez/config`, extended by each app/package
- Path aliases: `@/` for app-internal, `@louez/` for packages

```json
{
  "extends": "@louez/config/base.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Linting & Formatting — OXC

> **Migration note:** this project currently uses ESLint + Prettier. Target state per these docs is OXC (oxlint + oxfmt). See [docs/migration/02-strategy.md](../migration/02-strategy.md) for the approach.

We use the [OXC toolchain](https://oxc.rs/) for linting and formatting:

- **oxlint** — fast linter, replaces ESLint
- **oxfmt** — fast formatter, replaces Prettier

### Setup

Single `.oxlintrc.json` at the monorepo root — no shared package needed.

### Key rules enforced

- No `any` types
- Import order consistency
- Unused variables/imports detection
- Consistent naming conventions

### Formatting

oxfmt runs on save (editor) and in CI. Zero config needed — it uses sensible defaults (double quotes, 2-space indent, trailing commas).

## Git

### Branch naming

```
feat/<description>     # New feature
fix/<description>      # Bug fix
refactor/<description> # Refactoring
chore/<description>    # Maintenance
```

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(podcast): add series support
fix(auth): handle expired session redirect
refactor(database): extract tag upsert logic
chore(deps): update drizzle-orm to 0.44
```

### CI checks

Every PR must pass:
1. `pnpm lint`
2. `pnpm check-types`
3. `pnpm build`

## Agentation

Every client app includes [Agentation](https://www.agentation.com/) — a visual feedback toolbar that makes it easier for AI agents to understand and interact with the running app.

### Setup

1. Install as a dev dependency:

```bash
pnpm add -D agentation
```

2. Add the component to the app's root layout, dev-only:

```tsx
import { Agentation } from "agentation";

// In the root layout / App component:
{process.env.NODE_ENV === "development" && <Agentation />}
```

The `NODE_ENV` check ensures it is stripped from production builds.

---

## Related

- [01-monorepo-setup.md](01-monorepo-setup.md) — Monorepo scripts wired into `turbo.json`
- [code-review/02-typescript.md](../code-review/02-typescript.md) — TS rules enforced by these tools
- [migration/02-strategy.md](../migration/02-strategy.md) — Migration order (tooling comes first)
