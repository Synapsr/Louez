# Migration — Extraction Patterns

Concrete patterns for moving from spaghetti to structured code.

## Pattern 1: Extract a shared package

**When:** The same logic exists in multiple places (or will soon).

Steps:
1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `src/index.ts`
2. Move the code there
3. Export from `src/index.ts`
4. Update imports in apps to use `@louez/<name>`
5. Run `pnpm install` to link the workspace package
6. Verify with `pnpm check-types` and `pnpm build`

## Pattern 2: Group into domain component folders

**When:** Related components, hooks, and utils are scattered across flat directories.

Before:
```
src/components/podcast-card.tsx
src/components/podcast-list.tsx
src/components/podcast-form.tsx
src/hooks/use-podcast-query.ts
src/utils/podcast-helpers.ts
```

After:
```
src/components/podcast/
├── podcast-card.tsx
├── podcast-list.tsx
├── podcast-form.tsx
├── use-podcast-query.ts
└── util.podcast-helpers.ts
```

Steps:
1. Create the domain folder in `components/`
2. Move files (git mv to preserve history)
3. Update imports across the app
4. Verify nothing breaks

## Pattern 3: Replace state-as-cache with React Query

**When:** Components use `useState` + `useEffect` + `fetch()` to load and cache server data.

Before:
```typescript
const [podcasts, setPodcasts] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetch("/api/podcasts")
    .then(res => res.json())
    .then(data => { setPodcasts(data); setLoading(false); });
}, []);
```

After:
```typescript
// lib/queries/podcast.queries.ts
export const podcastQueries = {
  list: (channelId: string) =>
    orpc.studio.podcast.list.queryOptions({ input: { channelId } }),
};

// In component
const { data: podcasts, isLoading } = useQuery(podcastQueries.list(channelId));
```

Steps:
1. Create a query options factory in `lib/queries/<domain>.queries.ts`
2. Replace the `useState` + `useEffect` + `fetch` with `useQuery(factory())`
3. Remove manual loading/error state
4. Query keys are auto-managed by oRPC — no manual keys needed

## Pattern 4: Eliminate prop drilling with composition

**When:** Props are passed through 3+ levels of components.

Don't reach for context/global state. First try:
1. **Composition** — render children directly instead of passing data down
2. **Query options factories** — if the data comes from React Query, call `useQuery(factory())` where needed
3. **Zustand** — only for truly cross-cutting UI state

## Pattern 5: Break up god components

**When:** A component is > 200 lines and handles multiple concerns.

Steps:
1. Identify the concerns (rendering, data fetching, state logic, event handlers)
2. Extract data/state logic into a custom hook
3. Extract sub-sections into child components
4. The parent becomes a composition of hook + child components

---

## Related

- [02-strategy.md](02-strategy.md) — When to apply each pattern (migration order)
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — Target package structure (Pattern 1)
- [from-scratch/05-frontend.md](../from-scratch/05-frontend.md) — Target component/hook organization (Patterns 2 & 5)
- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Target data layer (Pattern 3)
- [code-review/01-structure.md](../code-review/01-structure.md) — File organization rules
