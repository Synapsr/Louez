---
description: Adapt the pasted starter docs to the actual tech stack of the current project by asking the user about each divergence and rewriting the docs in place.
---

# /adapt-docs

You are adapting a copy of the **synapsr-starter** documentation set to a new host project. The docs currently describe the starter's imposed stack, but the host project may use different choices. Your job: detect divergences, ask the user how to resolve each one, then **rewrite the docs in place** so they match the host project's reality.

Work in phases. Do not skip a phase, do not batch the questions.

---

## Phase 1 — Detect the host project's stack

Read these inputs (in parallel):

1. Root `package.json` — dependencies + devDependencies
2. `pnpm-workspace.yaml` / `package.json#workspaces` — is this a monorepo?
3. Every workspace `package.json` (`apps/*/package.json`, `packages/*/package.json`) — per-app deps
4. Root configs: `next.config.*`, `tanstack.config.*`, `drizzle.config.*`, `turbo.json`, `vite.config.*`, `.oxlintrc.json`, `biome.json`, `.eslintrc*`, `prettier.config.*`, `.prettierrc*`
5. Presence of directories: `apps/`, `packages/`, `app/`, `src/app/`, `src/routes/`

Build a **detected stack table** covering these axes:

| Axis | Starter-imposed | Detected in host |
|------|-----------------|------------------|
| Monorepo tool | Turborepo + pnpm | ? |
| Framework (web) | Next.js App Router **or** TanStack Start | ? |
| Database | MySQL | ? |
| ORM | Drizzle | ? |
| Auth | Better Auth | ? |
| API layer | ORPC | ? |
| Server state | TanStack React Query | ? |
| Client state | Zustand | ? |
| Forms | TanStack Form + Zod | ? |
| Styling | Tailwind CSS | ? |
| HTTP server | Hono | ? |
| Linter | Oxlint | ? |
| Formatter | Oxfmt | ? |
| UI primitives | shadcn/ui in `packages/design-system` | ? |

Detection rules:
- If a dep is present in any workspace `package.json`, it counts as "in use"
- If multiple options coexist (e.g., both `react-hook-form` and `@tanstack/react-form`), flag as ambiguous — the user must disambiguate in Phase 2
- If nothing matches an axis (e.g., no form lib at all), mark "none detected"

Show the detected table to the user before moving on. Keep it short — no commentary, just the table.

---

## Phase 2 — Ask the user about each divergence

For **every row where detected ≠ starter-imposed**, ask one question. One divergence, one question, sequentially. Do not batch.

For each divergence, present exactly three choices:

```
[Axis: Forms] Starter says TanStack Form + Zod. Detected: react-hook-form.

(a) adapt — rewrite all docs to describe react-hook-form as the project standard
(b) migrate — keep TanStack Form in docs, add a migration note flagging react-hook-form as legacy to replace
(c) both — document react-hook-form as current + TanStack Form as the target, noting when each applies

Which? (a/b/c)
```

Wait for the user's answer before asking the next question. Record each decision in a running log you will show at the end of Phase 3.

Special cases:
- **"none detected"** → ask: *"No form library detected. (a) keep starter default (TanStack Form) in docs, (b) remove form section entirely, (c) specify one now?"*
- **Ambiguous (multiple libs)** → ask the user which one is actually canonical, then apply the three-choice flow against that canonical answer
- If the user answers "skip" for a row, leave that row untouched and note it in the log

---

## Phase 3 — Rewrite the docs in place

Once all questions are answered, apply the edits. Files in scope:

- `AGENTS.md` (root)
- `README.md` (root) — only the tech-description sections, not project-specific setup steps
- Every file under `docs/` (recursive)
- `CLAUDE.md` only if it contains tech-specific content (it usually just points at `AGENTS.md`)

For each decision:

- **adapt** — find every mention of the starter tech in the files above (use Grep first to enumerate, then Edit file-by-file with `replace_all` where the string is unambiguous, or per-occurrence Edit where context matters). Replace with the host tech. Update tables, code examples, import paths, file-naming conventions. Do not leave stale "TanStack Form" strings behind.
- **migrate** — keep the starter tech as the documented standard. Add a **Migration note** block at the top of each relevant doc:
  ```md
  > **Migration note:** this project currently uses `{detected}`. Target state per these docs is `{starter}`. See [docs/migration/02-strategy.md](migration/02-strategy.md) for the approach.
  ```
- **both** — document both. Pattern: a short "Current state" paragraph describing `{detected}`, then the existing `{starter}` content reframed as "Target state". Use a clear header separator.

After applying edits, update `docs/ARCHITECTURE.md`'s **Imposed Stack** table so it reflects the final resolved state (what the docs now describe as the project's actual standard).

---

## Phase 4 — Report

Show a compact summary:

```
Adapted docs for <N> divergences:
- Forms: TanStack Form → react-hook-form (adapt)
- Database: MySQL → PostgreSQL (adapt)
- Auth: Better Auth → NextAuth (migrate — kept Better Auth as target)
- ...

Files changed: <list>
Skipped: <any skipped rows>
```

Then stop. Do not run the dev server, do not commit, do not open a PR. The user reviews the diff themselves.

---

## Guardrails

- **Never** modify files under `apps/` or `packages/` source code. This command only touches docs.
- **Never** delete a doc file wholesale. If a section becomes irrelevant (e.g., "Forms" when the project has no forms), remove the section but keep the file.
- **Never** invent a tech the user didn't confirm. If detection is ambiguous and the user hasn't answered, ask — don't guess.
- **Never** change the starter's own imposed-stack philosophy in comments ("we always use X because Y") — only swap the concrete tech names the user has decided to swap.
- If the host project *is* the synapsr-starter itself (detect by checking `package.json#name === "synapsr-starter"` or similar), abort with a message: *"This looks like the starter repo itself — `/adapt-docs` is meant to run in a downstream project that copied the docs. Aborting."*
