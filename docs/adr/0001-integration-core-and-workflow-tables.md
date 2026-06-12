# Integration Core and Workflow Tables

We will model integrations with a static provider catalog in code, store-specific integration records in the database, and workflow-specific tables for durable business state. New provider state must not be stored in `stores.settings` JSON. This keeps the catalog reviewable in open source while allowing calendar sync, insurance, payments, reviews, and future workflows to own their data explicitly.

## Considered Options

- Store all integration state in `stores.settings`, matching the legacy Tulip path.
- Create one table per provider.
- Use a common integration core with workflow-specific tables.
- Manage the provider catalog dynamically from the database.
- Introduce a generic integration job queue for the first calendar sync provider.

## Consequences

New integrations need schema work when they persist durable state, but their ownership is clearer and contributors do not have to reverse-engineer large provider-specific JSON blobs. Providers are added through normal code review with manifest, adapter, assets, translations, and workflow documentation. Tulip follows this model through `store_integrations` and `store_tulip_integrations`; existing legacy Tulip JSON in `stores.settings` is backfilled into the new tables during migration, then stops being a runtime source of truth. Legacy JSON cleanup must be a separate verified migration, not part of the backfill.

The first calendar provider will use its reservation-event mapping table as a workflow-specific durable outbox instead of introducing a generic integration job queue. A shared queue can be extracted later if multiple workflows prove they need the same retry machinery.
