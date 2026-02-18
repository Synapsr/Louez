# Adding a New Integration (OSS Guide)

This document explains the integration architecture and the exact steps contributors should follow to add a new integration.

## Overview

The integrations feature is built around a **typed registry + adapter** model.

An integration is composed of:

1. A **manifest** (display metadata used by catalog/detail pages)
2. An **adapter** (runtime behavior: enabled state, connectivity status, optional config panel)
3. Optional backend procedures for provider-specific actions
4. Translations and static assets

## Source of Truth

- Registry types: `apps/web/lib/integrations/registry/types.ts`
- Registry helpers: `apps/web/lib/integrations/registry/index.ts`
- Integration state helpers: `apps/web/lib/integrations/registry/state.ts`
- Provider registrations: `apps/web/lib/integrations/providers/index.ts`
- Dashboard routes:
  - `/dashboard/settings/integrations`
  - `/dashboard/settings/integrations/categories/[category]`
  - `/dashboard/settings/integrations/[integrationId]`

## Data Model

The generic enabled state is stored in store settings JSON:

- `stores.settings.integrationData.states[integrationId].enabled`

Rules:

- Enable/disable should **not** delete provider credentials.
- Provider-specific disconnect logic can still clear credentials/mappings.
- Legacy providers can use fallback logic when no explicit state exists yet.

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
6. Add assets:
   - `apps/web/public/integrations/my-provider/logo.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-1.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-2.(svg|webp|png)`
   - `apps/web/public/integrations/my-provider/screen-3.(svg|webp|png)`
7. Add i18n keys in:
   - `apps/web/messages/en.json`
   - `apps/web/messages/fr.json`
8. If provider requires API actions, wire oRPC (see below)
9. Run validation commands (see bottom)

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

- `getStatus(settings)`
  - Returns `{ enabled, connected, configured, connectionIssue }`
- `setEnabled(settings, enabled)`
  - Must return updated `StoreSettings`

Optional:

- `getConfigurationPanel()`
  - Returns a React component rendered on the integration detail page when enabled

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
- Category page should show only integrations for that category.
- Detail page should include:
  - Hero (logo/name/description)
  - Tabs (`Features`, `Configuration`, `About`)
  - Side metadata/resources panel
- Configuration tab must be gated behind enable state.

## Security and Multi-Tenancy

For any backend/provider action:

- Authenticate using store context (`getCurrentStore()`)
- Validate input with Zod
- Scope queries by `storeId`
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
