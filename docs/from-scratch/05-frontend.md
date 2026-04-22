# From Scratch — Frontend

## Component architecture

### Hierarchy

```
app/              → Pages and layouts (routing concern)
components/
├── shared/       → Cross-cutting: providers, headers, layouts, error boundaries
├── ui/           → Custom UI components not from the @louez/ui package
├── podcast/      → Domain-specific components (podcast-card, podcast-list, etc.)
├── channel/      → Domain-specific components
└── ...
hooks/            → App-wide hooks
lib/              → Utilities, clients, configs
```

- `components/shared/` — things used everywhere but not UI primitives: providers, headers, footers, navigation, error boundaries
- `components/ui/` — custom UI components specific to this app that don't belong in `@louez/ui`
- `components/<domain>/` — domain-specific components grouped by concern. Each domain folder can contain its own sub-components, hooks, and utils (prefixed `util.*`)

### Component rules

- `const` arrow functions for components
- Props destructured in the signature
- One component per file — no helper components in the same file. If it's reusable, extract it to its own file. If it's a small utility (formatting, mapping), put it in a utils file.
- File name matches the component name in kebab-case

```typescript
// Good
export const PodcastCard = ({ title, author }: PodcastCardProps) => {
  return <div>{title}</div>;
};
```

### Server vs Client Components (Next.js)

- Default to Server Components
- Add `"use client"` only when you need: event handlers, hooks, browser APIs
- Keep client components small — push data fetching to server components and pass data down as props

## State management

### React Query — Server state

All data from the API goes through React Query. Never store API data in local state or Zustand.

#### Query options factories (not wrapper hooks)

Don't wrap `useQuery` in custom hooks — it hides options, breaks type inference, and prevents per-call overrides. Instead, export **query options factories** that return typed options objects. Components consume them directly with `useQuery`.

```typescript
// lib/queries/podcast.queries.ts
import { queryOptions } from "@tanstack/react-query";

export const podcastQueries = {
  list: (channelId: string) =>
    orpc.studio.podcast.list.queryOptions({
      input: { channelId },
    }),
  detail: (podcastId: string) =>
    orpc.studio.podcast.find.queryOptions({
      input: { podcastId },
    }),
};
```

Usage in components:

```typescript
// Direct usage — no wrapper hook needed
const { data: podcasts } = useQuery(podcastQueries.list(channelId));

// Prefetching
queryClient.prefetchQuery(podcastQueries.detail(podcastId));

// Targeted invalidation
queryClient.invalidateQueries({ queryKey: orpc.studio.podcast.key() });
```

#### Mutation options factories

Same pattern for mutations:

```typescript
// lib/queries/podcast.queries.ts
export const podcastMutations = {
  create: () =>
    orpc.studio.podcast.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.studio.podcast.key() });
      },
    }),
};
```

```typescript
// In component
const mutation = useMutation(podcastMutations.create());
```

#### Rules

- **No wrapper hooks around `useQuery` / `useMutation`** — use options factories instead
- Options factories live in `lib/queries/<domain>.queries.ts`
- Query keys are auto-managed by oRPC — never define them manually
- Keep invalidation scoped and deterministic (invalidate the domain, not the whole cache)
- Use `select` for consumer-specific data slices
- Optimistic updates only when UX demands it, with rollback-safe patterns

See [04-backend.md](04-backend.md#tanstack-query-integration) for the oRPC + TanStack Query setup.

### Zustand — Client state

For UI state that needs to be shared across components (modals, sidebar state, selections).

```typescript
// lib/stores/use-player-store.ts
export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  currentTrack: null,
  play: (track) => set({ isPlaying: true, currentTrack: track }),
  pause: () => set({ isPlaying: false }),
}));
```

Rules:
- One store per domain/concern
- Keep stores flat — no deep nesting
- Derive computed values with selectors, not extra state

### Local state — useState

For component-specific, ephemeral state: form inputs, toggle states, temporary UI state.

## Forms — TanStack Form

Forms use [TanStack Form](https://tanstack.com/form) with a layered architecture:

1. **`@tanstack/react-form`** — headless form state, validation, submission
2. **`useAppForm` hook** — project-level wrapper that registers reusable field/form components
3. **Field components** (`components/form/*`) — UI components wired to form context
4. **Zod** — schema-based validation

### File structure

```
hooks/form/
  form.tsx            # useAppForm, withForm, SubscribeButton
  form-context.tsx    # fieldContext, formContext (from createFormHookContexts)

components/form/
  form-input.tsx      # Input field with label + error display
  form-form.tsx       # <form> wrapper routing submit to form.handleSubmit()
```

### Setup

```typescript
// hooks/form/form-context.tsx
import { createFormHookContexts } from "@tanstack/react-form";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
```

```typescript
// hooks/form/form.tsx
import { createFormHook } from "@tanstack/react-form";
import { FormForm } from "@/components/form/form-form";
import { fieldContext, formContext } from "./form-context";

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    // Register field components here: Input: FormInput, etc.
  },
  formComponents: {
    Form: FormForm,
    SubscribeButton,
  },
  fieldContext,
  formContext,
});
```

### Validation

Use Zod schemas with TanStack Form's `validators` option. Default to `revalidateLogic` for the best UX: quiet before first submit, real-time feedback after.

```typescript
import { revalidateLogic } from "@tanstack/react-form";

const form = useAppForm({
  defaultValues: { email: "", password: "" },
  validators: { onSubmit: schema },
  validationLogic: revalidateLogic({
    mode: "submit",              // before first submit: validate on submit only
    modeAfterSubmission: "change", // after first submit: validate on every change
  }),
  onSubmit: async ({ value }) => {
    await mutation.mutateAsync(value);
  },
});
```

Where to put schemas:
- Simple forms: inline schema is fine
- Shared or complex schemas: extract to `lib/validators/validator.<name>.ts`

### Full example

```tsx
const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const LoginForm = () => {
  const mutation = useMutation(authMutations.login());

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: schema },
  });

  return (
    <form.AppForm>
      <form.Form>
        <form.AppField name="email">
          {(field) => <field.Input label="Email" placeholder="johndoe@email.com" />}
        </form.AppField>

        <form.AppField name="password">
          {(field) => <field.Input label="Password" type="password" />}
        </form.AppField>

        <form.SubscribeButton type="submit">Sign in</form.SubscribeButton>
      </form.Form>
    </form.AppForm>
  );
};
```

### Conventions

- `form.AppField` + registered field components for standard fields
- `form.Field` + render props only when custom markup is needed
- `form.SubscribeButton` for submit buttons (handles loading/disabled states)
- Always wrap async operations in `useMutation` — never put async logic directly in `onSubmit`
- Prefer `onChange` validation for instant feedback; `onSubmit` for expensive checks
- Server errors displayed via `form.setFieldMeta()` with `errorMap.onSubmit`

### Adding a new field component

1. Create `components/form/form-<type>.tsx` following the pattern in `form-input.tsx`
2. Register it in `hooks/form/form.tsx` under `fieldComponents`

## Internationalization — next-intl

Translations live in `messages/{locale}.json` at the app root.

### Usage rules

- Prefer one `useTranslations()` call per file/component and reuse that single translator across the file
- Allow exceptions only when Next.js boundaries require it (e.g., separate server/client translation APIs)
- Call `useTranslations()` inside each component file instead of passing translator functions through props — this preserves i18n Ally key inference and local type safety
- For feature-local client hooks that own UI copy, call `useTranslations()` inside the hook instead of passing a translator callback from parents
- Keep related keys grouped in the same message namespace so i18n Ally can detect and manage them consistently
- Reuse existing translation keys before creating new ones
- Error keys follow the pattern: `errors.{errorType}`

## Styling

See [code-review/05-styling.md](../code-review/05-styling.md) for Tailwind conventions.

---

## Related

- [04-backend.md](04-backend.md) — oRPC + TanStack Query integration (where component data comes from)
- [03-packages.md](03-packages.md) — `@louez/ui` (primitives, icons, component library)
- [code-review/03-react-patterns.md](../code-review/03-react-patterns.md) — React component rules (rationale)
- [code-review/04-data-layer.md](../code-review/04-data-layer.md) — React Query usage rules in components
- [code-review/05-styling.md](../code-review/05-styling.md) — Tailwind conventions
