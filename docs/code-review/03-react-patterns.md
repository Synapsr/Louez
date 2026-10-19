# Code Review — React Patterns

> Applies when: React components or hooks are changed.

## Rules

### [RC-01] Components are const arrow functions

```typescript
// Bad
function PodcastCard() { ... }

// Good
export const PodcastCard = ({ title, author }: PodcastCardProps) => {
  return <div>{title}</div>;
};
```

### [RC-02] Props are destructured in the signature

```typescript
// Bad
export const PodcastCard = (props: PodcastCardProps) => {
  return <div>{props.title}</div>;
};

// Good
export const PodcastCard = ({ title, author }: PodcastCardProps) => {
  return <div>{title}</div>;
};
```

### [RC-03] One component per file, no inline helpers

Every component gets its own file. Don't define helper components in the same file. If logic is reusable, extract it to a utils file. If it's a sub-component, give it its own file.

### [RC-04] No business logic in components

Components handle rendering and user interaction. Business logic (data transformation, validation, complex conditions) lives in:

- Hooks (if it involves React state/effects)
- Utils (if it's pure logic)
- Server functions (if it's data fetching/mutation)

### [RC-05] Custom hooks extract reusable logic

If a component has complex state logic or effects, extract them into a custom hook named `use-<purpose>.ts`. Don't extract single-use trivial logic just for the sake of it.

### [RC-06] State management hierarchy

1. **Local state** (`useState`) — component-specific, ephemeral
2. **Server state** (React Query) — anything from the API
3. **Global client state** (Zustand) — cross-component UI state that isn't server data

Never store server data in Zustand. That's React Query's job.

### [RC-07] Avoid `useEffect` for derived state

If a value can be computed from props or other state, compute it inline or with `useMemo`. Don't sync it with `useEffect` + `setState`.

```typescript
// Bad
const [fullName, setFullName] = useState("");
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// Good
const fullName = `${firstName} ${lastName}`;
```

### [RC-08] Keys must be stable and unique

Use database IDs or unique identifiers as keys. Never use array indices for lists that can be reordered, filtered, or mutated.

### [RC-09] Accessible by default

Use @base-ui/react for interactive elements (buttons, dialogs, menus, etc.). Native HTML semantics first, ARIA attributes only when native elements aren't enough.

### [RC-10] Effect cleanups never destroy data the state still points to

`apps/web` runs with Cache Components: leaving a page hides it in an `<Activity>` boundary instead of unmounting it. React runs every effect cleanup but keeps the state, and the page comes back as it was. A cleanup that deletes uploaded files, cancels a draft or discards a server result therefore breaks the state the user returns to and saves later (Gleap #847: product photos deleted from storage, then saved into the product).

Delete or discard only on an explicit user action (remove, replace, reset). Accept orphaned files from abandoned forms rather than deleting them on unmount. Effect cleanups are for subscriptions, timers and transient UI such as an open dropdown (see `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`).

---

## Related

- [04-data-layer.md](04-data-layer.md) — Query/mutation options factories (never wrap `useQuery`)
- [from-scratch/05-frontend.md](../from-scratch/05-frontend.md) — Component hierarchy, state management, forms (TanStack Form)
- [from-scratch/03-packages.md](../from-scratch/03-packages.md) — Component library, icon registry, `@louez/ui`
- [05-styling.md](05-styling.md) — Tailwind rules inside components
