# Migration — Audit

How to diagnose a spaghetti codebase and identify what needs to change.

## Step 1: Map the current state

Before fixing anything, understand what you have.

### File structure scan

- Are components grouped by domain in `components/<domain>/`?
- Are `shared/` and `ui/` properly separated from domain components?
- Are hooks and utils mixed in with components without structure?
- Are there files over 300 lines? They likely do too much.
- Are there duplicate files or near-duplicates?

### Dependency graph

- Are there circular imports?
- Does the app import from deep internal paths of packages?
- Are there `../../..` imports everywhere?

### Type safety

- How many `any` types exist? (`grep -r ": any" --include="*.ts" --include="*.tsx"`)
- Are there `@ts-ignore` or `@ts-expect-error` comments?
- Is strict mode enabled?

### Data flow

- Is server data stored in local state or context instead of React Query?
- Are there `useEffect` chains that sync state?
- Is there direct `fetch()` in components instead of query options factories?
- Are `useQuery`/`useMutation` wrapped in custom hooks instead of using options factories?

### Naming

- Do files follow a consistent naming convention?
- Are components named after what they render?
- Are hooks prefixed with `use-`?
- Are utils prefixed with `util.*`?

## Step 2: Categorize issues

Sort findings into:

| Category | Impact | Example |
|----------|--------|---------|
| **Blocking** | Prevents scaling or causes bugs | Circular deps, `any` in API layer, missing auth checks |
| **Structural** | Makes code hard to navigate | No domain folders in `components/`, inconsistent naming |
| **Cosmetic** | Annoying but not harmful | Mixed naming styles, unused imports |

## Step 3: Prioritize

1. Fix blocking issues first (they cause bugs or prevent builds)
2. Then structural issues (they slow down development)
3. Cosmetic issues can be fixed incrementally or with automated tools

## Output

The audit produces a document listing:
- Current structure vs target structure
- List of violations by category
- Recommended migration order (see [02-strategy.md](02-strategy.md))

---

## Related

- [02-strategy.md](02-strategy.md) — Migration order and principles (incremental vs big-bang)
- [03-extraction-patterns.md](03-extraction-patterns.md) — Concrete refactor patterns for each issue category
- [04-checklist.md](04-checklist.md) — Post-migration conformance checklist
- [code-review/01-structure.md](../code-review/01-structure.md) — Target file structure to audit against
