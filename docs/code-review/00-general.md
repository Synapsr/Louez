# Code Review — General Rules

> Applies when: any change is made, regardless of file type.

## Rules

### [GN-01] Environment variables

Never read `process.env` directly — always import `env` from the owning package (`@louez/db/env`, `@louez/auth/env`, etc.) or the app's `env.ts`. See [from-scratch/01-monorepo-setup.md](../from-scratch/01-monorepo-setup.md) for the env validation pattern.

### [GN-02] Imposed stack

Do not introduce libraries outside the imposed stack defined in [ARCHITECTURE.md](../ARCHITECTURE.md#imposed-stack) without explicit approval.

---

## Related

- [07-checklist.md](07-checklist.md) — Condensed pre-commit checklist (run on every commit)
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — Package structure (`@louez/db`, `@louez/auth`, `@louez/api`, etc.)
- [from-scratch/01-monorepo-setup.md](../from-scratch/01-monorepo-setup.md) — Env validation (decentralized per-package)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Imposed stack reference
