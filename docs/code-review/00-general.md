# Code Review — General Rules

> Applies when: any change is made, regardless of file type.

## Rules

### [GN-01] Environment variables

Never read `process.env` directly — always import `env` from the owning package (`@louez/db/env`, `@louez/auth/env`, etc.) or the app's `env.ts`. See [from-scratch/01-monorepo-setup.md](../from-scratch/01-monorepo-setup.md) for the env validation pattern.

### [GN-02] Imposed stack

Do not introduce libraries outside the imposed stack defined in [ARCHITECTURE.md](../ARCHITECTURE.md#imposed-stack) without explicit approval.

### [GN-03] Application logging

Use Evlog for application logs that matter for operations, debugging, support, or business-critical flows. Avoid `console.*` for important logs in production code because it bypasses structured context, local drains, request correlation, and structured errors.

Use the appropriate Evlog entrypoint for the runtime:

- Server route handlers and server-side application code: import from the app logging module (`@/lib/evlog`) and prefer `withEvlog()`, `useLogger().set()`, `useLogger().error()`, and `createError()`.
- Client components: import from `evlog/next/client` and emit structured events with `log.info()`, `log.warn()`, or `log.error()`.

`console.*` is acceptable only for temporary local debugging or build/tooling scripts where Evlog is not available. Remove temporary debug logs before merging.

---

## Related

- [07-checklist.md](07-checklist.md) — Condensed pre-commit checklist (run on every commit)
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — Package structure (`@louez/db`, `@louez/auth`, `@louez/api`, etc.)
- [from-scratch/01-monorepo-setup.md](../from-scratch/01-monorepo-setup.md) — Env validation (decentralized per-package)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Imposed stack reference
