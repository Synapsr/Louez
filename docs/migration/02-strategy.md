# Migration — Strategy

## Incremental migration (default approach)

Big-bang rewrites fail. Migrate incrementally — one module at a time, keeping the app functional throughout.

### Principles

1. **Never break main** — every intermediate state must build and work
2. **One concern per PR** — don't mix refactoring with feature work
3. **Strangler fig pattern** — new code follows conventions, old code migrates gradually
4. **Tests protect you** — if tests exist, run them after every change. If they don't, add them for the module you're migrating before you touch it.

### Migration order

```
1. Tooling & config       → OXC (oxlint + oxfmt) replacing ESLint + Prettier, tsconfig, path aliases
2. Type safety            → Enable strict mode, eliminate `any`
3. Packages extraction    → Move shared code to packages/
4. Data layer             → React Query adoption, remove state-as-cache
5. Component restructuring → Reorganize into `components/<domain>/` folders
6. Component patterns     → Apply component conventions
7. Naming cleanup         → File and variable naming consistency
```

Why this order:
- **Tooling first** because it catches future violations automatically
- **Types second** because strict mode reveals hidden bugs
- **Data layer before UI** because component refactoring is easier when data flow is clean

## When big-bang is acceptable

Only when:
- The app is small (< 20 files)
- There are no users yet (no production traffic)
- The entire team agrees and can dedicate a sprint to it

## Branch strategy

- Create a long-lived `refactor/<scope>` branch only if the migration touches many files at once
- Prefer small PRs merged to main over long-lived branches
- If a migration PR is large, split it: move files first (no logic changes), then refactor logic

---

## Related

- [01-audit.md](01-audit.md) — Run this before defining a strategy
- [03-extraction-patterns.md](03-extraction-patterns.md) — Patterns that match each migration step
- [04-checklist.md](04-checklist.md) — Conformance targets when the strategy is executed
- [from-scratch/06-tooling.md](../from-scratch/06-tooling.md) — Target tooling (step 1: tooling first)
