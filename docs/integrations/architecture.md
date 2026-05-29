# Integrations Architecture

This document defines the integration model used by Louez. It is the reference for contributors adding a provider or a new integration workflow.

## Concepts

Louez separates integration concepts by responsibility:

- **Provider**: the external service or internal module that can be connected, such as Google Calendar, Outlook Calendar, or Tulip.
- **Integration Category**: a catalog grouping used for discovery in the dashboard, such as Calendars or Insurance.
- **Integration**: the activation of one provider for one store.
- **Connection**: the technical provider account link or credentials for an integration.
- **Workflow**: the business process that providers participate in, such as synchronizing reservations to a calendar or quoting insurance.
- **Sync**: the execution process that propagates Louez data to or from a provider.

These axes are intentionally separate. A category is UX, a provider is the service, and a workflow owns business behavior and persistence.

## Rules

- A store can have many integrations.
- A store has at most one integration per provider.
- Providers are declared in code and reviewed through normal project changes.
- Integration categories are declared in code and translated for the catalog.
- Store-specific integrations are stored in the database.
- Enablement, connection, and configuration are distinct states.
- Enable/disable is product intent and must not delete provider credentials by itself.
- Provider credentials are never stored in `stores.settings`.
- New integrations use dedicated records, not `StoreSettings` JSON.
- Legacy providers can keep their existing state until a specific migration is justified.
- Workflow tables are shared by providers that solve the same business process.
- Provider-specific tables are added only when the provider has unique operational needs.
- Integration management is owner-only unless a future permission model explicitly says otherwise.

## Persistence Model

Use a common integration core plus workflow-specific tables.

### Common Core

`store_integrations` should hold provider activation and health:

- `id`
- `store_id`
- `provider_key`
- `category`
- `enabled`
- `connected_by_user_id`
- `provider_account_email`
- `status`
- `last_health_check_at`
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`

`integration_credentials` should hold provider access material when needed:

- `integration_id`
- `credential_kind`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `expires_at`
- `scopes`
- `key_version`
- `created_at`
- `updated_at`

Secrets must be encrypted at rest with an application-level integration encryption key, server-only, and never sent to the client. Client views receive derived state only. The encryption key should be configured through a validated server-only environment variable, and credential records should include a key version so future rotation remains possible.

### Calendar Workflow

Calendar providers share reservation-to-calendar behavior.

For the first Google Calendar integration, Louez creates a dedicated secondary calendar for the store and uses it as the primary calendar destination. Choosing an existing provider calendar is an advanced option, not part of the initial workflow.

The first calendar workflow is one-way export sync: Louez writes reservations to the provider calendar. Provider calendar events do not block Louez availability. Calendar import and availability blocking are separate future workflows.

Google Calendar must use an integration-specific OAuth flow, separate from Google sign-in. The existing authentication provider identifies Louez users; it must not be expanded with calendar scopes. The integration OAuth state should bind the store, owner user, nonce, and return URL, and the callback must re-check owner access before storing credentials.

The existing ICS feed should be represented as a calendar provider in the integrations catalog. It is a subscription-link provider, not an OAuth-connected provider. Its UX should clearly communicate that refresh timing depends on the subscriber calendar client.

Calendar catalog hierarchy:

- Google Calendar is the recommended provider for reliable OAuth-backed sync.
- ICS Link is a separate provider card for Apple Calendar, Outlook, and other subscription clients.
- ICS Link should be visually secondary to OAuth-backed providers without being hidden inside another provider page.
- Future Outlook OAuth support should get its own provider card while ICS remains the universal subscription fallback.

`store_calendar_integrations` should hold calendar workflow settings:

- `integration_id`
- `calendar_id`
- `calendar_name`
- `sync_pending_reservations`
- `cancelled_reservation_behavior`
- `backfill_months`
- `backfill_past_days`
- `last_sync_at`

Default calendar sync behavior:

- Pending reservations are synchronized as tentative or non-blocking events when the provider supports it.
- Confirmed, ongoing, and completed reservations are synchronized as blocking events.
- Cancelled and rejected reservations follow `cancelled_reservation_behavior`.
- The first version must support a setting equivalent to "show cancelled reservations in the calendar" because the current ICS export already exposes cancelled reservations.

`cancelled_reservation_behavior` values:

- `show`: keep the event visible, mark it as cancelled in the summary/description, and make it non-blocking.
- `hide`: delete or remove the provider event.

The default is `show`. Do not rely only on provider cancellation semantics when the product intent is visibility, because some calendar clients hide cancelled events.

Calendar event content should match the current ICS export in the first version. Google Calendar sync should include the same operational reservation details currently published through ICS: customer identity, contact details, product list, total, customer notes, status marker, and reservation link. Any data minimization or field-level privacy setting should be a later explicit product change, not an accidental difference between providers.

Initial connection and manual resync should enqueue existing reservations in a bounded window:

- ongoing reservations
- future reservations for the next 12 months by default
- past reservations from the last 30 days by default

Do not backfill the full reservation history by default.

Reservation lifecycle changes must not depend on provider availability. Louez is the source of truth, and calendar export sync should run asynchronously after reservation changes commit. Provider failures should be retried and surfaced in integration health, not block checkout or dashboard reservation flows.

`reservation_calendar_events` should map Louez reservations to provider events and act as the calendar workflow outbox:

- `reservation_id`
- `integration_id`
- `provider_event_id`
- `payload_hash`
- `sync_status`
- `attempt_count`
- `next_attempt_at`
- `last_synced_at`
- `last_error`

The calendar workflow should use the existing cron infrastructure to process pending or failed rows whose `next_attempt_at` is due. Do not introduce a generic integration job table for the first calendar provider; extract a shared queue only if multiple workflows prove they need the same durable retry machinery.

Reservation mutations should enqueue calendar export through one domain function, for example `markReservationForCalendarSync(storeId, reservationId)`. Call it after transactions that create, edit, confirm, cancel, reject, or otherwise change reservation data that appears in calendar events. The function should upsert pending calendar event rows for active calendar integrations on the store and no-op when none exist. Do not use database triggers for the first version.

Provider-specific calendar tables are reserved for needs that are not shared by calendar providers, such as Google watch channels if calendar import is added later.

Provider clients should stay small. For the first Google Calendar implementation, prefer a typed local `fetch` client for the limited Google endpoints Louez needs instead of adding a broad SDK or a heavy provider abstraction. The calendar workflow service builds Louez calendar payloads; the Google client only translates those operations to Google Calendar API calls. Extract a richer provider interface when a second OAuth calendar provider needs it.

Disconnecting a calendar provider should stop future sync and remove stored credentials. Existing provider events should be kept by default because the destination calendar belongs to the store. The disconnect confirmation may offer an explicit destructive option to remove Louez-created events from the provider calendar.

Calendar sync health should be visible where it helps operators:

- The integration detail page is the main source for connection, configuration, last sync, and errors.
- The dashboard calendar can show a lightweight global warning when calendar sync is failing.
- Reservation detail pages can show per-reservation sync state when a calendar integration is active.

Per-reservation status can be added progressively because `reservation_calendar_events.sync_status` keeps the needed state.

The dashboard calendar should provide a contextual entry point, not own integration configuration. Replace the old "Export calendar" action with a calendar synchronization entry point that links to calendar integrations, opens Google Calendar configuration, or exposes the ICS link. Durable setup remains in Settings > Integrations.

### Insurance Workflow

Insurance providers can share common activation and workflow concepts, but product mapping, quote contracts, and provider payloads belong to the insurance workflow or provider-specific modules.

Tulip uses the common `store_integrations` record plus provider-specific insurance configuration in `store_tulip_integrations`. Product mapping remains in `products_tulip`, and reservation contract state remains on reservations because it belongs to the reservation lifecycle.

## Registry and Adapter Model

Every provider still registers a manifest and adapter:

- `manifest.ts` describes catalog metadata.
- `adapter.ts` exposes runtime status and configuration entry points.
- Optional configuration panels render provider-specific UI.
- Optional oRPC procedures expose provider actions.

The adapter should report status from the integration records or workflow service. It should not assume that `StoreSettings` owns integration state.

The provider catalog is intentionally static in code. Contributors add providers through pull requests with manifest, adapter, assets, translations, and workflow documentation. The database stores store-specific activation and runtime state, not the catalog itself.

## Category Registry

Categories are catalog UX, not persistence ownership. A provider must use an existing category unless the pull request also adds and documents a new one.

Initial categories:

- `calendar`: calendar sync and availability providers
- `insurance`: insurance quote and contract providers
- `payments`: payment and billing providers
- `reviews`: review collection and reputation providers
- `automation`: automation and notification providers
- `developer`: API, MCP, webhooks, and developer tooling

## Adding Providers

When adding a provider:

1. Choose an existing workflow when possible.
2. Create a new workflow only when the provider participates in a distinct business process.
3. Add provider metadata under `apps/web/lib/integrations/providers/<provider-key>/`.
4. Add provider actions through oRPC when backend work is needed.
5. Add workflow or provider tables only when the data has durable business meaning.
6. Document new workflows in this file before implementing them.

## Permissions

Integration management can expose provider credentials and customer data through external systems. In the initial model, only store owners can connect, disconnect, enable, disable, resynchronize, or configure integrations. Store members can see operational state where useful, but they do not manage provider connections.

## Related

- [Adding a New Integration](./adding-an-integration.md)
- [Module Ownership](../architecture/module-ownership.md)
