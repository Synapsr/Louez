# Code Review — TypeScript

> Applies when: any `.ts` or `.tsx` file is changed.

## Rules

### [TS-01] No `any`

Never use `any`. Use `unknown` when the type is truly unknown, then narrow with type guards. The only exception is third-party library workarounds — and those must have a `// TODO: remove when types are fixed` comment.

### [TS-02] Prefer inference over annotation

Don't annotate what TypeScript can infer. Explicit types are for:
- Function parameters
- Function return types on exported/public functions
- Complex objects where inference is ambiguous

```typescript
// Bad
const count: number = items.length;

// Good
const count = items.length;
```

### [TS-03] Use `satisfies` over `as`

Prefer `satisfies` to validate a value matches a type without widening:

```typescript
// Bad
const config = { ... } as Config;

// Good
const config = { ... } satisfies Config;
```

### [TS-04] Discriminated unions over optional fields

When a type has variants, use discriminated unions instead of optional fields:

```typescript
// Bad
type Result = { data?: Data; error?: Error };

// Good
type Result = { status: "success"; data: Data } | { status: "error"; error: Error };
```

### [TS-05] Enums → union types

Use string union types instead of enums:

```typescript
// Bad
enum Status { Active = "active", Inactive = "inactive" }

// Good
type Status = "active" | "inactive";
```

### [TS-06] Zod for runtime validation

Use Zod schemas at system boundaries (API inputs, form data, external API responses). Infer TypeScript types from Zod schemas with `z.infer<>` — don't maintain parallel type definitions.

### [TS-07] No non-null assertions in business logic

`!` is only acceptable in test files or immediately after a narrowing check that TypeScript can't follow. In business logic, handle the null case explicitly.

---

## Related

- [04-data-layer.md](04-data-layer.md) — Zod schemas at API boundaries, `.output()` on every procedure
- [06-security.md](06-security.md) — Input validation with Zod (SE-03)
- [from-scratch/06-tooling.md](../from-scratch/06-tooling.md) — TypeScript strict mode + `@louez/config`
- [from-scratch/04-backend.md](../from-scratch/04-backend.md) — Inferring types from Drizzle schemas (`$inferSelect`)
