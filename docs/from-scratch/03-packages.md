# From Scratch — Shared Packages

> **Module ownership:** see [docs/architecture/module-ownership.md](../architecture/module-ownership.md) for the canonical list of what lives where. Never recreate shared modules under `apps/web/lib/` or `apps/web/types/` — legacy code in those locations should be migrated to the owning package.

## Required packages

Every monorepo starts with these packages. Add more only when justified.

### `@louez/db`

Drizzle ORM schemas, constants, database connection, and env validation.

```
packages/db/
├── src/
│   ├── index.ts              # DB client (connection pool, drizzle instance)
│   ├── env.ts                # DB-specific env validation (DATABASE_URL, etc.)
│   ├── schema/
│   │   ├── index.ts          # Re-exports all schema files
│   │   ├── schema.auth.ts
│   │   ├── schema.content.ts
│   │   ├── schema.notification.ts
│   │   └── schema.<domain>.ts
│   └── constants/
│       ├── constant.channel.ts
│       ├── constant.podcast.ts
│       └── constant.<domain>.ts
├── drizzle.config.ts
└── package.json
```

#### Schema file conventions

- **One file per domain** — `schema.auth.ts`, `schema.content.ts`, `schema.notification.ts`, etc.
- **File naming**: `schema.<domain>.ts` (kebab-case for multi-word domains: `schema.comment-like.ts`)
- **Table variable naming**: always suffixed with `Table` — `userTable`, `podcastTable`, `channelTable`
- **Table names in SQL**: singular, snake_case — `user`, `podcast`, `channel`
- **Relations defined in the same file** as their tables
- **`schema/index.ts`** re-exports everything: `export * from "./schema.auth"`

#### Constants file conventions

- **One file per domain** — `constant.channel.ts`, `constant.podcast.ts`, etc.
- Contains enums, status values, and domain-specific constants used by both schema and app code
- Example: `PODCAST_STATUS`, `CHANNEL_USER_ROLE`, `PodcastVisibility`

#### DB client conventions

- Single connection pool via `mysql2/promise`
- Global singleton pattern to prevent multiple connections in dev (hot reload)
- Export `db`, `schema`, and the `Transaction` type

#### Type inference

Infer types from schemas — never maintain parallel type definitions:

```typescript
// Infer from the table
type User = typeof userTable.$inferSelect;
type NewUser = typeof userTable.$inferInsert;
```

### `@louez/ui`

Shared React components and hooks. Built on **@base-ui/react** for accessible, unstyled primitives styled with Tailwind.

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── ui/               # Primitive UI components
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   └── ...
│   │   ├── podcast-card.tsx  # Domain-specific shared components
│   │   └── ...
│   ├── icons/
│   │   └── index.tsx         # Central icon registry (re-exports)
│   ├── hooks/
│   └── index.ts
└── package.json
```

#### Component library

This project uses **@base-ui/react** — accessible, unstyled primitives from the Base UI team, styled with Tailwind. All interactive components (buttons, dialogs, menus, etc.) are built on Base UI primitives.

#### Icons

All icons used across apps **must** be imported from the `@louez/ui` package, never directly from `lucide-react` or any other icon library.

The icon registry lives in `icons/index.tsx`. Each icon is exported individually with an `Icon` suffix. Icons from the same source are grouped on a single line:

```ts
// icons/index.tsx
export { Heart as HeartIcon, Plus as PlusIcon, Trash as TrashIcon } from "lucide-react";
```

In app code:

```ts
// Good
import { HeartIcon } from "@louez/ui/icons";

// Bad — bypasses the central icon registry
import { Heart } from "lucide-react";
```

The goal is to have a single place where we can swap any icon (e.g. replace `HeartIcon` from Lucide with one from our own library) and have the change propagate to every app automatically.

When adding a new icon:
1. Add a named export with the `Icon` suffix in `packages/ui/src/icons/index.tsx`.
2. Import it from `@louez/ui/icons` in app code.

#### Conventions

- Primitive UI components live in `components/ui/` (buttons, inputs, dialogs, etc.)
- Domain-specific shared components live in `components/` directly (e.g., `podcast-card.tsx`)
- Components use Tailwind for styling — no CSS-in-JS
- All interactive components must be accessible (keyboard nav, ARIA attributes, focus management)
- Export from `index.ts` for clean imports

### `@louez/utils`

Pure utility functions shared across apps and packages.

```
packages/utils/
├── src/
│   ├── util.format-date.ts
│   ├── util.slug.ts
│   └── index.ts
└── package.json
```

Conventions:
- Pure functions only, no side effects
- No React dependencies (that goes in `@louez/ui`)

### Environment validation (decentralized)

Each package validates its own env vars using `@t3-oss/env-core` + Zod. The app then composes them via `extends`.

#### Per-package `env.ts`

Each package that needs env vars exports an `env.ts` using `@t3-oss/env-core`:

```typescript
// packages/db/src/env.ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

Packages with their own env: `@louez/db`, `@louez/auth`, `@louez/email`, `@louez/validations`.

#### App-level composition

The Next.js app (`apps/web/env.ts`) uses `@t3-oss/env-nextjs` and extends all package envs:

```typescript
// apps/web/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { env as authEnv } from "@louez/auth/env";
import { env as dbEnv } from "@louez/db/env";
import { env as emailEnv } from "@louez/email/env";
import { env as validationsEnv } from "@louez/validations/env";

export const env = createEnv({
  extends: [dbEnv, validationsEnv, authEnv, emailEnv],
  server: {
    // App-specific server vars (S3, Stripe, etc.)
  },
  client: {
    // NEXT_PUBLIC_* vars
  },
  runtimeEnv: { /* ... */ },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
```

#### Conventions

- **Never read `process.env` directly** in business logic — always import `env` from the package or app
- **Each package owns its own env vars** — add new vars to the package that uses them, not to the app
- **App extends all package envs** — the app's `env.ts` composes them via `extends: [...]`
- **App crashes fast at startup** if env is misconfigured — no silent failures at runtime
- Package env files are exported via `"./env": "./src/env.ts"` in `package.json` exports

### Config packages

- `@louez/config` — shared `tsconfig.json` base, ESLint config, Prettier config


These are consumed via `extends` / imports in app-level configs.

## Core packages

These packages are active and wired into `apps/web`:

| Package | Purpose | Depends on |
|---------|---------|------------|
| `@louez/db` | Drizzle ORM schemas + connection + env | — |
| `@louez/auth` | Better Auth config + env | `@louez/db`, `@louez/email` |
| `@louez/api` | oRPC routers + services | `@louez/auth`, `@louez/db`, `@louez/validations` |
| `@louez/types` | Shared TypeScript types | — |
| `@louez/validations` | Shared Zod schemas + env | `@louez/types` |

## Additional packages

| Package | Purpose |
|---------|---------|
| `@louez/email` | Transactional emails (React Email + Nodemailer) |
| `@louez/pdf` | PDF generation (@react-pdf/renderer) |
| `@louez/mcp` | Model Context Protocol server |

### `@louez/email`

Email templates (React Email) and a send wrapper (Resend).

```
packages/email/
├── components/           # Shared email building blocks
│   ├── email-footer.tsx
│   └── email-logo.tsx
├── templates/            # One file per email type
│   ├── email-verification.tsx
│   ├── forgot-password.tsx
│   └── <template-name>.tsx
├── keys.ts               # Env validation (Resend token, from address)
├── index.ts              # sendEmail wrapper + template re-exports
├── tsconfig.json
└── package.json
```

#### Templates — React Email

- Built with `@react-email/components` (Body, Container, Button, Text, etc.)
- Styled with Tailwind via React Email's `<Tailwind>` component
- Each template is a React component with typed props
- Shared layout pieces (footer, logo) live in `components/`

```tsx
// templates/forgot-password.tsx
import { Body, Container, Button, Tailwind } from "@react-email/components";
import { EmailFooter } from "../components/email-footer";

interface ForgotPasswordProps {
  url: string;
  userName: string;
}

export function ForgotPasswordTemplate({ url, userName }: ForgotPasswordProps) {
  return (
    <Tailwind>
      <Body>
        <Container>
          {/* ... */}
          <Button href={url}>Reset password</Button>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  );
}
```

#### Sending — Resend via wrapper

All email sending goes through a single `sendEmail` wrapper. Apps never import Resend directly.

```typescript
// index.ts
import { Resend } from "resend";

const resend = new Resend(env.RESEND_TOKEN);

export async function sendEmail({ to, subject, react, from }: SendEmailProps) {
  const { data, error } = await resend.emails.send({
    from: from ?? env.RESEND_FROM,
    to,
    subject,
    react,
  });

  if (error) throw new Error(`Failed to send email: ${error.message}`);
  return data;
}
```

Why a wrapper:
- **Single entry point** — all emails go through one function
- **Fallback-ready** — add a secondary provider (SES, Postmark) later without touching app code
- **Consistent error handling** — one place to log, retry, or queue
- **Env isolation** — Resend token and from address are validated in `keys.ts`, not scattered across the app

#### Environment variables

| Variable | Description |
|----------|-------------|
| `RESEND_TOKEN` | Resend API key (starts with `re_`) |
| `RESEND_FROM` | Default sender address |

See [01-monorepo-setup.md](01-monorepo-setup.md#environment-variables) for the global env validation pattern.

---

## Related

- [01-monorepo-setup.md](01-monorepo-setup.md) — Monorepo workspace config, env setup
- [04-backend.md](04-backend.md) — Using `@louez/db`, `@louez/auth`, `@louez/api` inside an app
- [05-frontend.md](05-frontend.md) — Using `@louez/ui` inside an app
- [code-review/00-general.md](../code-review/00-general.md) — General rules (env vars, imposed stack)
- [migration/03-extraction-patterns.md](../migration/03-extraction-patterns.md) — Extracting an existing module into a new shared package
