# Provider Template

Copy this folder to `apps/web/lib/integrations/providers/<integration-id>/` and rename files.

## Files

- `manifest.ts`: static metadata used by catalog/detail pages
- `adapter.ts`: runtime behavior (status + enable/disable + optional configuration panel)

## Minimum Implementation

1. Fill manifest keys and asset paths.
2. Implement `getStatus()` and `setEnabled()`.
3. Register provider in `apps/web/lib/integrations/providers/index.ts`.
4. Add translations and assets.
