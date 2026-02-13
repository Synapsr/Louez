# Module Ownership

Single source of truth for shared modules:

- UI primitives and base design tokens: `packages/ui`
- Shared domain types: `packages/types`
- Shared Zod validations: `packages/validations`
- Shared pricing logic and helpers: `packages/utils/src/pricing`
- Database schema and DB runtime exports: `packages/db`

App-level modules in `apps/web` should only contain app-specific composition and feature code.
Do not recreate shared package modules under `apps/web/lib/*` or `apps/web/types/*`.
