# Module Ownership

Single source of truth for shared modules:

- UI primitives and base design tokens: `packages/ui`
- Shared domain types and supported language registry: `packages/types` (`src/locale.ts`)
- Shared Zod validations: `packages/validations`
- Shared pricing logic and helpers: `packages/utils/src/pricing`
- Database schema and DB runtime exports: `packages/db`
- Voice transport contracts, authentication and public GPT-Live presets: `packages/voice` (compiled for the standalone worker; no DB or app dependencies)
- The `louez` command-line client of the REST API: `packages/cli` (standalone and compiled; its commands are generated from the API's OpenAPI document, no runtime dependency)

App-level modules in `apps/web` should only contain app-specific composition and feature code.
Do not recreate shared package modules under `apps/web/lib/*` or `apps/web/types/*`.
