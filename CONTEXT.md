# Louez Context

This context defines the core business language for Louez so product, code, and integration decisions use the same terms.

## Language

**Store**:
A rental business workspace that owns its catalog, reservations, customers, settings, and integrations.
_Avoid_: Shop, merchant account, tenant

**Provider**:
An external service or internal module that Louez can connect to for a specific capability.
_Avoid_: Type, app, plugin

**Workflow**:
A business process that an integration participates in, such as synchronizing reservations to calendars or quoting insurance.
_Avoid_: Category, provider type

**Integration Category**:
A catalog grouping that helps stores discover providers by business purpose.
_Avoid_: Integration type

**Integration**:
The activation of a provider capability for a specific store.
_Avoid_: Provider, connection

**Connection**:
The technical link between a store integration and a provider account or credentials.
_Avoid_: Account, login

**Enabled Integration**:
An integration that the store wants Louez to use for its business workflow.
_Avoid_: Connected integration

**Connected Integration**:
An integration with valid provider credentials or account linkage.
_Avoid_: Enabled integration

**Configured Integration**:
An integration whose minimum business settings are complete.
_Avoid_: Connected integration

**Sync**:
The business process that propagates Louez data to or from a connected provider.
_Avoid_: Export, connection

**Calendar Export Sync**:
A one-way calendar sync that writes Louez reservations to a provider calendar.
_Avoid_: Calendar import, availability sync

**ICS Calendar Provider**:
A calendar provider that exposes a subscription link rather than an OAuth connection.
_Avoid_: Google Calendar sync, connected calendar

**Calendar Destination**:
A calendar target inside a calendar provider where reservation events are synchronized.
_Avoid_: Calendar integration, calendar account

**Cancelled Reservation Visibility**:
A calendar workflow setting that controls whether cancelled or rejected reservations remain visible in the calendar.
_Avoid_: Cancelled sync, cancellation export

**Reservation Logistics**:
The pickup and return route of a reservation, including whether each leg happens at a store location or at an address.
_Avoid_: Delivery option, calendar location

**Calendar Event Availability**:
A provider calendar event setting that controls whether an exported reservation blocks the provider calendar owner's time.
_Avoid_: Reservation availability, product availability, status

**Calendar Event Visibility**:
A provider calendar event setting that controls who can see exported reservation details in the provider calendar.
_Avoid_: Status, connection visibility

**Provider Event Color**:
A provider-specific visual marker used to approximate Louez reservation status colors in external calendars.
_Avoid_: Louez design token, reservation status

## Relationships

- A **Store** can have many **Integrations**
- A **Provider** can be activated by many **Stores**
- A **Provider** is declared in code and reviewed through normal project changes
- An **Integration Category** groups one or more **Providers**
- An **Integration Category** is declared in code and translated for the catalog
- A **Workflow** owns the domain behavior shared by providers that solve the same business process
- An **Integration** can have zero or one **Connection**
- A **Sync** belongs to an **Integration**
- A **Store** has at most one **Integration** per **Provider**
- A calendar **Integration** synchronizes to one primary **Calendar Destination**
- A **Calendar Export Sync** writes reservations from Louez to the provider and does not block Louez availability from provider events
- A calendar **Integration** can choose whether cancelled and rejected reservations remain visible in the **Calendar Destination**
- A **Calendar Export Sync** includes **Reservation Logistics** so staff can see where equipment is picked up and returned
- A **Calendar Export Sync** can mark provider events as available/free while Louez reservations still block rental inventory in Louez
- A **Calendar Export Sync** keeps exported reservation details private when the provider supports event visibility
- A **Provider Event Color** is derived from the Louez reservation status, but provider palettes can be less precise than Louez UI colors
- The **ICS Calendar Provider** belongs to the calendar category but does not require a provider account connection
- An **Integration** can be enabled, connected, and configured independently
- Only store owners manage **Integrations** and provider **Connections**
- Native store behavior belongs to **Store** settings; provider integration state belongs to **Integration** records
- Louez reservations are the source of truth for calendar export sync

## Example Dialogue

> **Dev:** "Should Google Calendar be an integration or a connection?"
> **Domain expert:** "Google Calendar is the provider. The store's activated Google Calendar setup is the integration. The OAuth account link is the connection."

> **Dev:** "Should we add Google Calendar tokens to the store settings?"
> **Domain expert:** "No. Store settings describe native Louez behavior. Provider state belongs to the integration."

## Flagged Ambiguities

- "type" was used to describe calendar, insurance, and provider-specific behavior; resolved: use **Integration Category** for catalog grouping and **Provider** for the connectable service.
- "account" can mean a Louez user, a customer, or an external provider account; resolved: use **Connection** when discussing provider credentials or OAuth state.
- Multiple Google Calendar accounts or calendars for one store are out of scope for the first integration model; resolved: keep one **Integration** per **Store** and **Provider**, and model the target calendar as a **Calendar Destination**.
- "enabled" and "connected" were easy to conflate; resolved: **Enabled Integration** is product intent, **Connected Integration** is provider access, and **Configured Integration** is business readiness.
- The existing Tulip integration stores legacy state inside **Store** settings; resolved: new integrations should use dedicated integration records, while Tulip can stay on the legacy path until a separate migration is justified.
- Calendar, insurance, and future groups should not drive persistence by themselves; resolved: **Integration Category** is for discovery UX, **Provider** is the connectable service, and **Workflow** owns shared domain behavior and persistence.
- Providers are not managed dynamically from the database; resolved: **Providers** are static code contributions, while **Integrations** are store-specific database records.
- Integration categories are not free-form provider metadata; resolved: **Integration Categories** are static catalog entries declared in code and do not determine persistence.
- Google Calendar should not ask stores to choose an existing calendar in the first version; resolved: Louez creates a dedicated **Calendar Destination** for the store.
- Cancelled and rejected reservations should not disappear unconditionally from calendar workflows; resolved: calendar integrations include **Cancelled Reservation Visibility** from the first version.
- Visible cancelled reservations should remain readable to the store; resolved: show them as marked, non-blocking events rather than relying on provider cancellation semantics that may hide them.
- Calendar provider events should not affect Louez availability in the first version; resolved: the first calendar workflow is **Calendar Export Sync**, one-way from Louez to the provider.
- The existing ICS link should stay discoverable in integrations; resolved: model it as the **ICS Calendar Provider** in the calendar category, with subscription-link behavior instead of OAuth connection behavior.
- Calendar sync retry should stay workflow-specific in the first version; resolved: use calendar event mapping records as the durable outbox instead of introducing a generic integration job queue.
- Reservation changes should enqueue calendar export through a single domain function; resolved: call the function from reservation mutations instead of using database triggers.
- Calendar event content should match the existing ICS export in the first version; resolved: Google Calendar sync uses the same reservation details unless a later product setting changes that explicitly.
- Calendar backfill should be bounded; resolved: sync ongoing reservations, future reservations for 12 months, and past reservations from the last 30 days by default.
- Provider credentials require application-level encryption; resolved: OAuth/API secrets are stored server-side encrypted with a dedicated integration encryption key and key version.
- Google Calendar authorization is not Louez authentication; resolved: provider OAuth flows for integrations are separate from sign-in flows and bind explicitly to a store owner.
- Provider clients should stay narrow; resolved: use a typed local Google Calendar client for the first implementation and defer a richer calendar provider abstraction until another provider needs it.
- Calendar disconnect should be conservative; resolved: stop sync and remove credentials while keeping existing provider events by default, with explicit optional cleanup.
- Calendar sync health should be visible in settings first and operational surfaces later; resolved: keep per-reservation sync state so dashboard calendar and reservation detail can expose it progressively.
- The dashboard calendar is a contextual entry point, not the integration owner; resolved: durable calendar provider setup lives in settings integrations.
- Managing integrations exposes external provider access and customer data; resolved: integration management is owner-only in the first permission model.
- Provider sync failures must not block reservation lifecycle changes; resolved: Louez remains the source of truth and calendar export sync runs asynchronously with retry.
- "delivery" can mean only the outbound address leg or the full pickup/return route; resolved: use **Reservation Logistics** for the complete two-leg route.
- "status" can mean Louez reservation lifecycle, provider event lifecycle, provider event availability, or provider event visibility; resolved: use **Calendar Event Availability** for free/busy and **Calendar Event Visibility** for privacy.
- Google Calendar event colors cannot use Louez design tokens directly; resolved: **Provider Event Color** maps each reservation status to the closest Google Calendar palette color.
- Exported bike rental reservations should not block a store owner's personal availability; resolved: Google Calendar export marks reservation events as available/free while keeping Louez inventory blocking inside Louez.
