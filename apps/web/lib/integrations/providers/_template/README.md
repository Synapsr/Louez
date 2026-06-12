# Provider Template

Copy this folder to `apps/web/lib/integrations/providers/<integration-id>/` and rename files.

Read `docs/integrations/architecture.md` before adding a provider. Categories are only catalog UX; durable behavior belongs to a workflow.

## Files

- `manifest.ts`: static metadata used by catalog/detail pages
- `adapter.ts`: runtime behavior (status + enable/disable + optional configuration panel)

## Minimum Implementation

1. Fill manifest keys and asset paths.
2. Choose an existing workflow or document a new one.
3. Implement `getStatus()` and enable/disable behavior.
4. Register provider in `apps/web/lib/integrations/providers/index.ts`.
5. Add translations and assets.
6. Add oRPC actions and workflow tables when the provider needs durable backend state.

Do not store new provider credentials in `stores.settings`. Legacy providers may still read settings until they are migrated.
