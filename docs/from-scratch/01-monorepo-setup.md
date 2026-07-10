# From Scratch — Monorepo Setup

## Structure

Every project starts as a Turborepo + pnpm monorepo:

```
<project>/
├── apps/
│   └── <app>/          # Main application
├── packages/
│   ├── database/       # Drizzle ORM schemas + connection
│   ├── ui/             # Shared React components (@base-ui/react)
│   ├── env/            # Centralized env validation (t3-env + Zod)
│   ├── utils/          # Shared utilities
│   ├── email/          # Email templates (when needed)
│   └── typescript-config/ # Shared tsconfig
├── .eslintrc*            # ESLint config (root level)
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── .env
```

## Workspace config

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root package.json

```json
{
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "oxlint && turbo lint",
    "format": "oxfmt --write",
    "format:check": "oxfmt --check",
    "check-types": "turbo check-types"
  },
  "devDependencies": {
    "oxfmt": "latest",
    "oxlint": "latest",
    "turbo": "latest"
  },
  "packageManager": "pnpm@latest"
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "lint": { "dependsOn": ["^build"] },
    "check-types": { "dependsOn": ["^build"] }
  }
}
```

## Package naming

All internal packages use the `@louez/` scope:

- `@louez/db`
- `@louez/ui`
- `@louez/utils`
- `@louez/config`
- `@louez/auth`
- `@louez/api`
- `@louez/types`
- `@louez/validations`
- `@louez/email`
- `@louez/pdf`
- `@louez/mcp`

## Environment variables

- `.env` at the root, loaded by the app framework (Next.js, Vite, etc.)
- Never commit `.env` — use `.env.example` as a template
- Server-only variables have no prefix
- Client variables use the framework's prefix (`NEXT_PUBLIC_`, `VITE_`, etc.)

### Env validation — decentralized per-package

Each package validates its own env vars using `@t3-oss/env-core` + Zod. The app composes them via `extends`:

```typescript
// In a package (e.g., @louez/db)
import { env } from "@louez/db/env";

// In the Next.js app (composes all package envs)
import { env } from "@/env";
```

Rules:

- Never read `process.env` directly in business logic — always import `env` from the package or app
- Each package owns its own env vars — add new vars to the package that uses them
- All env variables are declared with Zod schemas that enforce format (URLs, prefixes, min length, etc.)
- App crashes fast at startup if env is misconfigured — no silent failures at runtime
- See [03-packages.md — Environment validation](03-packages.md#environment-validation-decentralized) for full structure and conventions

---

## Related

- [03-packages.md](03-packages.md) — All shared packages (`@louez/db`, `@louez/ui`, `@louez/auth`, etc.)
- [06-tooling.md](06-tooling.md) — Linting, formatting, TypeScript config
- [02-framework-decision.md](02-framework-decision.md) — Picking Next.js vs TanStack Start for apps inside this monorepo
- [code-review/00-general.md](../code-review/00-general.md) — General rules (env vars, imposed stack)
