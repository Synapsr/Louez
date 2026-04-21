# Agent Instructions

Turborepo + pnpm monorepo. All conventions live in `docs/` — read them before writing code.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack, core principles, and framework decision tree.

## Step 1 — Classify the task

Before writing any code, classify what you are about to do:

- **from-scratch** — creating something new: a net-new app, a new shared package, initial monorepo setup, scaffolding a backend or frontend module that doesn't exist yet
- **migration** — moving or cleaning existing code: extracting a package, swapping a framework, aligning a legacy module with current conventions
- **development** — modifying existing, already-established code (the default)

State the mode explicitly at the start of your response, then load the docs for that mode (Step 2).

If the user hasn't stated the task explicitly, these signals help:

- "set up", "init", "create new app/package", no existing files → **from-scratch**
- "refactor", "migrate", "clean up", "extract", "align with conventions" → **migration**
- Anything else (new feature, bug fix, edit to existing code) → **development**

When truly ambiguous, ask the user before writing code.

## Step 2 — Load docs by mode

### From-scratch mode

| Creating / scaffolding | Read first |
|------------------------|------------|
| New monorepo / env setup | [docs/from-scratch/01-monorepo-setup.md](docs/from-scratch/01-monorepo-setup.md) |
| Choosing a framework (Next.js vs TanStack Start) | [docs/from-scratch/02-framework-decision.md](docs/from-scratch/02-framework-decision.md) |
| New shared package | [docs/from-scratch/03-packages.md](docs/from-scratch/03-packages.md) |
| Backend (oRPC, Drizzle, auth, Directus) | [docs/from-scratch/04-backend.md](docs/from-scratch/04-backend.md) |
| Frontend (components, state, forms) | [docs/from-scratch/05-frontend.md](docs/from-scratch/05-frontend.md) |
| Linting, formatting, TS config | [docs/from-scratch/06-tooling.md](docs/from-scratch/06-tooling.md) |

> **Note:** This project currently uses ESLint + Prettier. The docs describe OXC (oxlint + oxfmt) as the target tooling. See [docs/migration/02-strategy.md](docs/migration/02-strategy.md).

### Migration mode

Always follow the order **audit → strategy → patterns → checklist**.

| Phase | Doc |
|-------|-----|
| 1. Audit the codebase | [docs/migration/01-audit.md](docs/migration/01-audit.md) |
| 2. Plan the strategy | [docs/migration/02-strategy.md](docs/migration/02-strategy.md) |
| 3. Apply extraction patterns | [docs/migration/03-extraction-patterns.md](docs/migration/03-extraction-patterns.md) |
| 4. Run final conformance check | [docs/migration/04-checklist.md](docs/migration/04-checklist.md) |

A migration task usually means bringing existing code up to our from-scratch conventions — pair the migration doc with the relevant from-scratch doc (e.g., extracting a package → also read [docs/from-scratch/03-packages.md](docs/from-scratch/03-packages.md)).

### Development mode (default)

Load only the `code-review/` docs that match what you're touching — not the full set.

| Editing | Read first |
|---------|-----------|
| Any change | [docs/code-review/00-general.md](docs/code-review/00-general.md) |
| Creating / moving / renaming files | [docs/code-review/01-structure.md](docs/code-review/01-structure.md) |
| TypeScript | [docs/code-review/02-typescript.md](docs/code-review/02-typescript.md) |
| React components or hooks | [docs/code-review/03-react-patterns.md](docs/code-review/03-react-patterns.md) + [docs/from-scratch/05-frontend.md](docs/from-scratch/05-frontend.md) |
| Forms (TanStack Form, `useAppForm`) | [docs/from-scratch/05-frontend.md](docs/from-scratch/05-frontend.md) (Forms section) |
| DB queries, oRPC routes, React Query | [docs/code-review/04-data-layer.md](docs/code-review/04-data-layer.md) + [docs/from-scratch/04-backend.md](docs/from-scratch/04-backend.md) |
| Tailwind / styling | [docs/code-review/05-styling.md](docs/code-review/05-styling.md) |
| Translations / i18n | [docs/from-scratch/05-frontend.md](docs/from-scratch/05-frontend.md) (Internationalization section) |
| Auth, security, user input | [docs/code-review/06-security.md](docs/code-review/06-security.md) |
| New or modified shared package | [docs/from-scratch/03-packages.md](docs/from-scratch/03-packages.md) + [docs/architecture/module-ownership.md](docs/architecture/module-ownership.md) |
| Env variables | [docs/from-scratch/01-monorepo-setup.md](docs/from-scratch/01-monorepo-setup.md#environment-variables) |

## Step 3 — Final pass before every commit

Run [docs/code-review/07-checklist.md](docs/code-review/07-checklist.md) against the diff — it's the condensed version of every code-review rule.

## Cross-linking convention

Every doc in `docs/` ends with a **Related** section pointing at adjacent docs you may need. If you open a doc and the Related block doesn't cover something you need, check the other two directories (`code-review/`, `from-scratch/`, `migration/`) manually — they're meant to complement each other.

## Agent hooks (Claude Code + Codex)

This repo ships automated reminders that inject context when an agent edits specific files. They live in [.agents/](.agents/) as shell scripts, wired from [.claude/settings.json](.claude/settings.json) and [.codex/hooks.json](.codex/hooks.json) — same scripts, both tools.

**Claude Code** — hooks are active by default. If you add/modify hooks mid-session, open `/hooks` once to reload.

**Codex** — enable once per user in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

Note: as of April 2026, Codex `PreToolUse`/`PostToolUse` only emit the `Bash` tool name — the `Write`/`Edit`/`Update` matchers are kept for when Codex ships that support. Today, the reliably-firing Codex hooks are `pre-commit` (Bash) and `session-start`.
