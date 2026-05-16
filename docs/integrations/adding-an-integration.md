# Adding a New Integration (OSS Guide)

This document explains the integration architecture and the exact steps contributors should follow to add a new integration.

## Overview

The integrations feature is built around a **typed registry + adapter** model.

An integration is composed of:

1. A **manifest** (display metadata used by catalog/detail pages)
2. An **adapter** (runtime status and optional configuration panel)
3. Optional workflow records and services for durable business behavior
4. Optional backend procedures for provider-specific actions
5. Translations and static assets

Read [Integrations Architecture](./architecture.md) before adding a provider. The core rule is:

- **Category** is catalog UX.
- **Provider** is the connectable service.
- **Workflow** owns shared business behavior and persistence.
- The provider catalog lives in code; store-specific integrations live in the database.
- Categories are declared in code. Add a new category only when no existing catalog grouping fits.

## Source of Truth

- Registry types: `apps/web/lib/integrations/registry/types.ts`
- Registry helpers: `apps/web/lib/integrations/registry/index.ts`
- Provider registrations: `apps/web/lib/integrations/providers/index.ts`
- Architecture guide: `docs/integrations/architecture.md`
- Dashboard routes:
  - `/dashboard/settings/integrations`
  - `/dashboard/settings/integrations/[integrationId]`

## Data Model

New providers should use the common integration core plus workflow-specific records:

- `store_integrations` for provider activation, status, and health
- `integration_credentials` for encrypted OAuth/API credentials
- workflow tables for durable business state, such as calendar destinations or reservation event mappings

Rules:

- Enable/disable is product intent and should **not** delete provider credentials.
- Connection state is technical provider access and is separate from enablement.
- Configuration state means the minimum business settings are complete.
- Do not store provider credentials in `stores.settings`.
- Provider-specific disconnect logic can still clear credentials/mappings.
- Legacy providers can keep existing storage until a separate migration is justified.

## Quick Start Checklist

When adding a provider `my-provider`:

1. Create folder:
   - `apps/web/lib/integrations/providers/my-provider/`
2. Add manifest:
   - `manifest.ts` implementing `IntegrationManifest`
3. Add adapter:
   - `adapter.ts` implementing `IntegrationAdapter`
4. (Optional) Add config panel component:
   - `my-provider-configuration-panel.tsx`
5. Register provider entry in:
   - `apps/web/lib/integrations/providers/index.ts`
6. Choose or document a workflow:
   - reuse an existing workflow from `docs/integrations/architecture.md`
   - or document a new workflow before adding provider-specific persistence
7. Add assets:
   - `apps/web/public/integrations/my-provider/logo.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-1.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-2.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-3.(svg|webp|png)`
8. Add i18n keys in:
   - `apps/web/messages/en.json`
   - `apps/web/messages/fr.json`
9. If the provider persists durable state, add Drizzle schema and migrations
10. If provider requires API actions, wire oRPC (see below)
11. Run validation commands (see bottom)

Keep provider clients narrow. A provider client should wrap only the external API operations Louez actually uses. Do not introduce a broad SDK or generic abstraction unless the provider or workflow needs it.

## Manifest Contract

`IntegrationManifest` (from `registry/types.ts`) requires:

- `id`
- `category`
- `nameKey`
- `descriptionKey`
- `logoPath`
- `galleryPaths`
- `providerName`
- `pricingLabel`
- `resourceLinks`
- `featureKeys`
- `aboutKey`
- `websiteUrl`
- `status`

Use translation keys under:

- `dashboard.settings.integrationsHub.categories.*`
- `dashboard.settings.integrationsHub.providers.<providerId>.*`

## Adapter Contract

`IntegrationAdapter` requires:

- `getStatus(...)`
  - Returns `{ enabled, connected, configured, connectionIssue }`
- enable/disable behavior through the integration service or provider action

Optional:

- `getConfigurationPanel()`
  - Returns a React component rendered on the integration detail page when enabled

The current TypeScript interface still accepts `StoreSettings` because legacy Tulip state is stored there. Do not copy that storage model for new providers that need durable integration state.

## Optional Backend Wiring (oRPC)

If your provider needs backend actions (connect/sync/etc), update:

1. `packages/validations/src/api.ts`
   - Add Zod schemas and inferred types
2. `packages/api/src/context.ts`
   - Extend `dashboardIntegrationActions` contract
3. `packages/api/src/routers/dashboard/integrations.ts`
   - Add procedures (`dashboardProcedure`/`requirePermission('write')`)
4. `apps/web/app/api/rpc/[...path]/route.ts`
   - Inject concrete server action functions
5. `apps/web/app/(dashboard)/dashboard/settings/integrations/actions.ts`
   - Implement server actions (auth, validation, store-scoped DB filtering)

## UI Behavior Requirements

- Catalog page should list categories and integration cards.
- Detail page should include:
  - Hero (logo/name/description)
  - Tabs (`Features`, `Configuration`, `About`)
  - Side metadata/resources panel
- Configuration tab must be gated behind enable state.

## Security and Multi-Tenancy

For any backend/provider action:

- Authenticate using store context (`getCurrentStore()`)
- Require store owner access for connect, disconnect, enable, disable, resync, and configuration changes
- Validate input with Zod
- Scope queries by `storeId`
- Keep provider credentials server-only and encrypted at rest with the integration encryption helper
- Keep provider OAuth flows separate from Louez sign-in unless the provider is explicitly an identity provider
- Return typed error keys (for i18n)

## Contributor Template

Start from:

- `apps/web/lib/integrations/providers/_template/manifest.ts`
- `apps/web/lib/integrations/providers/_template/adapter.ts`
- `apps/web/lib/integrations/providers/_template/README.md`

## Validation Commands

Run before opening a PR:

```bash
pnpm type-check:web
pnpm build --filter=@louez/web
pnpm lint
```

Note: if `pnpm lint` fails on existing unrelated repo warnings/errors, include that context in your PR description and confirm your touched files pass targeted lint checks.
