# API and agents

Every action a store user can take in the dashboard is one oRPC procedure in `packages/api`. The same procedure serves three transports:

| Transport | Endpoint   | Credential                     | Caller                                |
| --------- | ---------- | ------------------------------ | ------------------------------------- |
| RPC       | `/api/rpc` | dashboard session cookie       | the dashboard, through TanStack Query |
| OpenAPI   | `/api/v1`  | API key (`Bearer lz_…`)        | scripts, n8n, integrations            |
| MCP       | `/api/mcp` | OAuth access token, or API key | Claude, ChatGPT and other agents      |

`/api/rpc` also requires the header `x-csrf-token: orpc` on every call (oRPC's simple CSRF protection, `apps/web/lib/orpc/csrf.ts`): only script on the app's origin can add it, so no other site, same-site ones included, can call a procedure with the user's cookie. The app's link sends it; a call without it gets 403 `CSRF_TOKEN_MISMATCH`.

No transport holds business logic. Validation, authorization, the logic itself and the audit record live in the procedure, so the dashboard, the API and the agents cannot drift apart.

The migration plan, lot by lot, is in `.agent-docs/plan-api-agents-2026-11-07.md` (local). The list of every capability and where it stands is `packages/api/src/platform/inventory.ts`.

## Writing a procedure

Build store procedures on `storeProcedure` from `packages/api/src/platform/procedures.ts`, never on `dashboardProcedure` (legacy, removed at the end of the migration).

```ts
const create = storeProcedure
  .meta({
    capability: "categories.create", // id in platform/inventory.ts
    scope: { domain: "categories", level: "write" }, // what the connection must grant
    mcp: {
      name: "categories_create",
      description:
        "Create a product category. Returns the category; an existing one with the same name is returned as is.",
      bundle: "catalog",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/categories" }) // its OpenAPI path
  .input(createCategoryInput) // contracts/categories.ts
  .output(createCategoryOutput)
  .handler(({ context, input }) => createCategory(context.actor.storeId, input)); // services/categories.ts
```

The package has four layers. `contracts/<domain>.ts` holds the input and output schemas and the domain's errors, with no database. `services/<domain>.ts` holds the business logic and takes the store id from the actor. `routers/dashboard/<domain>.ts` holds the procedures: contract, rights, confirmation, and a call to the service. `platform/` holds what every procedure shares. Categories (`routers/dashboard/categories.ts`) are the reference.

`storeProcedure` does this before the handler runs, on every call:

1. It checks that the credential is one the transport accepts and that it is still valid. A credential that is present but invalid fails. The procedure never falls back to another credential: a bad token never falls back to the cookie.
2. It checks `meta.actors`. `["session"]` refuses every key and token. Use it for anything that creates, changes or revokes a credential, changes a connection's confirmation setting, or invites or promotes a member, so an agent can never give itself more rights.
3. It checks `meta.platformAdmin`: platform staff, from a session only.
4. It resolves the store and reads the role the user holds there now. A removed or demoted member loses access on their next call.
5. It checks `meta.scope`. The right that applies is the member's role cut down to the connection's scopes. A session has its role only. A procedure without a scope is refused. A domain missing from a key's permissions is `none`.
6. For a key or a token, it checks that the store's plan has `apiAccess`, through `ports.planFeatures`, and applies the rate limit: 120 calls per minute per connection, counted in the database so every instance shares it.
7. It runs every write (`scope.level: "write"`) through `runOperation` (see below).

The handler reads `context.actor` (user, credential, transport, store id and role), `context.store` (the store row) and `context.ports`.

`accountProcedure` is for calls made before any store is chosen, such as listing or creating stores. It runs steps 1 to 3, and a key or a token counts on the connection's rate limit. An account procedure that is exposed declares `meta.account: true` instead of a scope: every connection may call it, and it answers for the connection's own account and stores only (`stores_list`).

## Contract conventions

These apply to every procedure listed in the exposure registry, which means every procedure an agent or the API can reach.

- **Schemas.** Declare an input schema and an output schema. Output schemas validate and drop fields; they do not transform, because a replayed result goes through them a second time. A procedure does not return `{ error }` as a success: it throws.
- **Errors.** Throw with `apiError` or `platformErrors` from `platform/errors.ts`:
  - `message` is plain English, written for a model or a developer;
  - `data.code` is stable (`CATEGORY_NOT_FOUND`), and it is what callers branch on;
  - `data.retryable` says whether the same call can succeed later;
  - `data.i18nKey` is the dashboard's translation key;
  - `data.details` holds structured facts.

  In the dashboard, `apiErrorKey(error)` from `apps/web/lib/orpc/errors.ts` gives the key to translate.

- **Lists.** Paginate with a cursor, sort in a stable order, and cap the page size.
- **Money and dates.** Money is a decimal string plus a currency. Dates are ISO 8601 with a time zone.
- **Partial updates.** An absent field is left unchanged; `null` clears it.
- **Tool names.** MCP tool names are `domain_action` and stable. A breaking change gets a new name.
- **Exposure.** Every procedure declares `meta.mcp`: either an exposure, or `{ exclude: "<reason>" }`. Nothing is left out silently. OpenAPI and MCP serve a procedure only once it is in the exposure registry (see below).

## Writes: audit, idempotency, receipts

`runOperation` (`platform/operations.ts`) writes one `api_operations` row per write. It records who made it (user, connection, verified client name), how (transport), what (procedure, target id) and how it ended. That row is the audit trail behind "done by Claude".

A caller may send an `Idempotency-Key` header. MCP tools take an `idempotencyKey` argument and map it onto that header.

- The same key with the same input returns the stored result without running again.
- The same key with a different input fails with `IDEMPOTENCY_KEY_REUSED`.
- A call that arrives while the first one is still running gets `OPERATION_IN_PROGRESS`, which is retryable.
- A key whose call failed may run again.
- A key whose outcome was lost never runs again: either the call went through but could not be recorded, or it stayed `running` past its five-minute lease. It fails with `OPERATION_OUTCOME_UNKNOWN`, and the caller checks the current state.

Keys are scoped per store and per connection. Results are stored only when a key is given, and only as the output schema returns them. A procedure whose output holds a secret declares `meta.secretOutput`: its result is never stored and the key is ignored.

A transport reads `context.receipt.operationId` after the call to give the caller a receipt.

A procedure that calls a provider (Stripe) before its own transaction passes the idempotency key on to the provider. An effect after the commit (e-mail, notification, sync) must never fail the operation once it has committed.

### The outbox

An effect that must not be lost (a customer's email, a store notification, an analytics event) goes through the outbox, `api_effects` (`platform/effects.ts`), not through `afterCommit`:

- The service adds one row per effect in the write's own transaction (`enqueueEffects`), with everything the effect needs: recipients, dates, amounts, lines, language. A rollback leaves no row, and an edit after the commit changes no message.
- Once committed, the service hands the ids to `ports.dispatchEffects`. The app sends them after the answer, with one sender per effect type (`apps/web/lib/api/effects.ts`).
- A sender claims its row atomically before sending (`pending`, a due `failed`, or a `running` row whose five-minute claim expired), so two dispatchers never both send it, then records `sent`, or `failed` with the error and the next attempt: 1, 2, 4… minutes, at most 6 hours. After 8 attempts the row is `abandoned`.
- The unified cron (`/api/cron`, every minute) retries the due rows, the rows the first dispatch never took, and the expired claims (`retryDueEffects`).
- An effect is sent at least once: a sender that dies between sending and recording leaves its claim to expire, and the row runs again. A sender fails its row only when nothing went out; an email sent and an SMS failed counts as sent.
- An idempotent replay returns the stored result: the rows of the first run are already there, and the cron finishes them.

An effect type is the type and its payload in `ApiEffectPayloads`, and a sender in the app. Reservation status changes and an agent's notes change use it; the products' notifications and analytics still go through `afterCommit` (lot 9 moves them).

## Sensitive operations

A procedure that moves money, deletes, sends to a customer or spends credits declares `meta.sensitive`. In its handler, after its checks and before its first write, it calls `requireConfirmation` (`platform/confirmation.ts`). It passes a one-sentence preview and the business `state` the preview shows, such as the amount, the recipients or the record's version.

- A dashboard session, or a connection whose confirmation is turned off (`api_keys.confirm_sensitive = false`), runs directly. The dashboard keeps its own confirmation dialogs.
- Otherwise, the first call does nothing. It fails with `CONFIRMATION_REQUIRED`, which carries the preview and a token valid for ten minutes. The caller sends the same input again with the token in the `Louez-Confirmation` header (`confirmationToken` for MCP tools).
- The token is bound to the actor, the connection, the store, the procedure, the input and the state. It can be used once. If any of these change, the token fails with `CONFIRMATION_INVALID`.

This proves the caller saw the preview. It does not prove that a human approved, because the same agent can make both calls. Human approval, through MCP elicitation or an approval link, comes with the first money procedures.

## Ports

The app lends the API only what is bound to Next.js or owned by the billing service, as one `ApiPorts` object (`platform/ports.ts`). The app builds it in `apps/web/lib/api/ports.ts`, and every handler passes it as `context.ports`. Stripe, e-mail and the other providers are adapters inside the package, not ports.

The effects of a write that the app still owns go through one port, `ports.afterCommit(event)`, called once the transaction has committed: page revalidation (`revalidatePath`), the platform notifications (Discord, fromHello) and the product analytics (PostHog). The service emits a typed `ApiEvent` (`product.created`, `product.updated`, …); the app maps it to its effects in `apps/web/lib/api/after-commit.ts`, revalidating at once and running the rest in `after()`. The port never throws and the answer never waits for it. A domain adds its events to `ApiEvent`.

Two more ports serve the reservation status changes (`services/reservation-status.ts`): `ports.runReservationEffects` records or voids the pay-as-you-go fee right after the commit (billing), and `ports.insurance` creates or cancels the Tulip insurance contract, a port until the integration moves into the package (lot 7). Both run before the answer and never throw; a failed contract is a warning in the answer, as the dashboard shows it. The customer's message, the store's and the platform's notifications and the analytics event go to the outbox (below); `ports.dispatchEffects` sends them. `reservation.statusChanged` only revalidates the pages.

Image storage is a port for now (`ports.storage`, built in `apps/web/lib/storage/api-storage.ts`). The storage client is configured from the app's environment and shared with the dashboard's file routes and the `/files` route. Categories and products upload through it; it moves into the package as an adapter in a later lot. The port only stores, reads and publishes; the upload service in the package decides which keys a store owns.

## Exposure registry

The RPC endpoint serves the whole router to the dashboard. OpenAPI and MCP serve only the procedures listed in `EXPOSED_PROCEDURES` (`platform/exposure.ts`), by router path, such as `dashboard.categories.create`. Each line is reviewed. A procedure enters the list when its contract follows the conventions above.

`createExposure(router, paths)` builds what the two transports serve: the list of procedures, and the same procedures as a router. It throws when a listed procedure:

- is missing, or the path is a sub-router;
- has no `meta.scope`, no input schema or no output schema;
- has no `meta.mcp`, or `meta.mcp` excludes it;
- takes or returns something other than an object;
- uses `idempotencyKey` or `confirmationToken` in its input (the MCP bridge adds them);
- is reserved to a session or to platform staff;
- shares its path or its tool name with another one.

A test checks the app's list against the app's router. Tests build their own exposure from the fixture router in `platform/testing.ts`.

## OpenAPI

`/api/v1` (`apps/web/app/api/v1/[[...path]]/route.ts`) serves the exposed router with oRPC's `OpenAPIHandler`. The handler and the document options live in `platform/openapi.ts`.

- A procedure declares a short REST route with `.route()`: `GET /categories`, `GET /categories/{id}`, `POST /categories`, `PATCH /categories/{id}`, `DELETE /categories/{id}`, `POST /categories/reorder`. Path parameters fill the input fields of the same name. A GET takes the rest of its input from the query string, so a number in it is `z.coerce.number()`. Any other method takes it from the JSON body.
- A procedure without a route is `POST /api/v1/<path with slashes>`, such as `POST /api/v1/dashboard/categories/create`. The body is the input.
- The credential is an API key: `Authorization: Bearer lz_…`.
- A write answers with `Louez-Operation-Id`, its receipt. A replayed write also sends `Louez-Replayed: true`.
- An error keeps oRPC's JSON shape (`defined`, `code`, `status`, `message`) with our `data`: `code`, `retryable`, `i18nKey`, `details`.

The spec (`/api/v1/openapi.json`) and a Scalar reference (`/api/v1/docs`) are generated by oRPC, in development only. In production these paths answer 404. The spec documents the bearer API key scheme, the `Idempotency-Key` header on writes, the `Louez-Confirmation` header on sensitive procedures and the receipt headers. Its `operationId` is the tool name.

## Uploads

A file goes up in three calls, the same on OpenAPI and MCP. The upload service (`services/uploads.ts`) serves every store-owned kind of image; `API_UPLOAD_KINDS` lists the kinds open to the API. Categories expose it as `categories_create_image_upload` and `categories_complete_image_upload`, products as `products_create_image_upload` and `products_complete_image_upload`.

1. The create-upload procedure takes the type and the size. It refuses another type, a size over the kind's limit and a kind the API does not take. It mints a key in the store's folder for the kind (`<storeId>/categories/<id>.png`) and returns it with one HTTP request to send the bytes, valid ten minutes:
   - a public bucket gives a presigned upload straight to the bucket (`PUT` with headers, or a multipart `POST` with fields), bound to the type and the size limit;
   - a private bucket served through the app (`S3_PUBLIC_URL` is a path) gives `PUT /api/v1/uploads/<token>` (`platform/uploads.ts`). The signed token is the credential, as a presigned URL is: it names the key, the type, the limit and the expiry. The endpoint refuses another `Content-Type`, a body over the limit, and bytes that are not the declared image type.

   Its output holds a credential, so it declares `meta.secretOutput`: it is never stored for a replay.

2. The caller sends the bytes, without its API key.
3. The complete procedure takes the key. It refuses a key outside the store's folder for the kind. It then checks what arrived: the size, the stored type, and the first bytes against the declared type, since a presigned upload never passed through the app. A file that fails is deleted. A good one is made public, and the procedure returns its URL.

The record then takes that URL (`imageUrl`), and its service checks it with `isOwnedImageUrl` against the same folder. The dashboard still uploads through its own file route (`/api/files/<kind>`), which streams with progress.

Importing a file from a public URL is not here yet: it needs a guard against server-side request forgery, and comes with products (lot 3).

## Migrating a domain

The steps a domain lot follows, as categories did (lot 0c):

1. **Inventory.** List the domain's capabilities in `platform/inventory.ts`: every server action, route, procedure and hand-written tool that does one. A capability the plan adds gets its line too.
2. **Contract.** Write `contracts/<domain>.ts`: input and output schemas (no transform in an output), a list with a cursor and a cap, partial updates (absent leaves, `null` clears), and the domain's errors with stable codes and the dashboard's `i18nKey`.
3. **Service.** Move the logic to `services/<domain>.ts`. Every query filters on the actor's store. Every write that reads then writes takes the same lock, deletions included: the store row (`SELECT … FOR UPDATE`) serializes the domain's writes of one store. A sensitive write computes its preview and asks for the confirmation under that lock, so what the preview shows is what happens. The confirmation's state also binds what the preview may not show, such as where a message goes (a hash of each channel and its address), so a change there voids the token. A write whose checks read what reservation writers change (stock, units, assignments) also takes the rows they lock, in the codebase's order (store, products, reservations, units; [DL-12](../code-review/04-data-layer.md)), before its first plain read: InnoDB reads at the snapshot of that first read, so a lock taken after it would hide a reservation committed while waiting. Keep every effect of the old code, and list them in the PR.
4. **Procedures.** One `storeProcedure` per capability in `routers/dashboard/<domain>.ts`: `meta` (capability, scope with the member permission, MCP name `domain_action`, a description for a model, bundle, annotations), `.route()`, schemas, and the service call. A procedure that also shows another domain's records (the product timeline shows reservations and customers) checks those domains too, with `allows()` on the actor's role and scopes, and its description says what it needs. A deletion or another sensitive action declares `meta.sensitive` and calls `requireConfirmation` with a preview that says what will happen and a `state` bound to what the preview shows.
   A domain whose records show another domain's data decides, for a caller without that domain's read, between leaving the data out and refusing. Reservations leave the customer out: a connection with reservations but not customers gets every reservation answer (list, detail, counters, calendar, planning, agenda, search) with the customer, the billing identity, the delivery and return addresses, and every free text that may name them (the team's and the customer's notes, the activity descriptions and details, payment notes) null or empty, and a search by name matches the number only. Payments are left out the same way: without payments read, a reservation comes with no payment rows, no Stripe ids, and no details of its payment and deposit activity; it keeps `rentalPaid`, what was paid toward the rental, as the dashboard's list shows a paid status to anyone who reads reservations. A cancellation's preview also shows what was paid, for the same reason. The product timeline and history refuse instead (`PERMISSION_DENIED`), as each of their rows is a booking.
5. **Exposure.** Add the paths to `EXPOSED_PROCEDURES` and mark the capabilities `migrated: true`. The exposure test then checks that every migrated capability is served and that every served procedure is in the inventory.
6. **Old paths.** Delete the hand-written MCP tools and the server actions of the domain. Other callers go through the procedures too, never the service: the in-app AI assistant calls them with a server-side client bound to the user's session (`AIChatContext.api`, built in `apps/web/app/api/chat/route.ts`), so its rights are the dashboard's. A migrated capability may keep only a route that serves the browser.
7. **Dashboard.** Call the procedures through the options factories of `apps/web/lib/queries/<domain>.queries.ts`. Show errors with `apiErrorKey`. Keep the dashboard's own confirmation dialogs: a session never gets `CONFIRMATION_REQUIRED`.
8. **Tests.** On the database: each procedure from a session and from a key, the partial update, the confirmation (preview, token, a state change that voids it), another store's ids (not found), a member without the permission, idempotent retries. Through the real handlers: the same calls give the same results and error codes on RPC, OpenAPI and MCP (`packages/mcp/src/categories.db.test.ts`). The OpenAPI test checks the routes.
9. **Agents.** A hand-written tool the procedure replaces keeps its name as an alias (`meta.mcp.aliases`, with `renamedArgs` for renamed arguments, `fixedArgs` for arguments the old tool implied, such as `archive_product`, which is `products_update_status` with `status: "archived"`): callable, never listed, removed at the end of the migration. A former tool no alias can express stays its own procedure with `meta.mcp.listed: false`: callable on MCP, never listed, not on OpenAPI. `list_products` is one, for its offset paging: one read, bounded to the first 10,000 products. The PR names the tools that changed for MCP users: old name, new name, what differs.

## MCP

`/api/mcp` (`apps/web/app/api/mcp/route.ts`) serves Streamable HTTP with the official SDK v2, statelessly. No session is kept between requests.

- Every request resolves its own context (`packages/mcp/src/auth/resolve.ts`): the key or the access token and its grant, the store and the role held there now, and the plan's API access. A revoked key or grant, a removed member or a lower role applies on the next request.
- A request that fails there never reaches MCP. It gets the platform's error as JSON, with its HTTP status. A 401 carries `WWW-Authenticate: Bearer` with `resource_metadata`, where an MCP client starts OAuth, and `error="invalid_token"` when a token was sent.
- Each request gets a server built for it. GET and DELETE answer 405: there is no session to stream on or to close.
- Rate limiting is the shared limiter. A tool call counts once, where it runs. Every other request counts at the door.

### The bridge

`packages/mcp/src/bridge.ts` makes one tool per exposed procedure.

- The name, description and annotations come from `meta.mcp`. The arguments are the input's JSON Schema.
- A write (`scope.level: "write"`) takes an optional `idempotencyKey`. A sensitive procedure takes an optional `confirmationToken`.
- The tool calls the procedure with `transport: "mcp"` and new headers: the request's `Authorization`, `Louez-Store` set to the request's store, `idempotency-key` from `idempotencyKey`, and `louez-confirmation` from `confirmationToken`. The procedure validates the input, so a bad input fails as it does on the other transports.
- On success, `structuredContent` is the output as JSON (dates as ISO strings). A text block says it is done and repeats the JSON. A write puts its receipt in `_meta`: `io.louez/operationId` and `io.louez/replayed`.
- On failure, the result has `isError: true`. Its text gives the message, `code`, `retryable` and the details; `structuredContent.error` holds the same facts. `CONFIRMATION_REQUIRED` spells out the preview and the token, and tells the model to ask the user, then call again with the same arguments and `confirmationToken`.

`tools/list` shows only the tools of the connection's bundles that it may call: the member's role cut down to the connection's scopes. The list only shows. Every exposed tool can still be called, and the procedure authorizes the call, so a refusal says `PERMISSION_DENIED` instead of "not found". `packages/mcp/src/tool-registry.ts` serves the list and the calls, because the SDK cannot show a subset of what may be called.

### Stores, tool bundles and instructions

- **Stores.** A connection over several stores (an OAuth grant) names the store of each request: the `Louez-Store` header, or the `storeId` argument every store tool then takes. The handler reads `storeId` from the tool call before the context is resolved, so hand-written tools get it too. Without one, the tools are listed, a call that needs a store answers `STORE_REQUIRED`, and resources and prompts are not served. A `storeId` the connection does not reach answers `NO_STORE_ACCESS` from the tool, not from the door. `stores_list` (an account procedure) needs no store.
- **Bundles.** `meta.mcp.bundle` says which bundle a tool is in (`daily`, `catalog`, `settings`, `integrations`, `team`, `billing`); a hand-written tool's bundle follows its domain. `tools/list` shows only the bundles of an OAuth grant; an API key lists every bundle. A tool outside the bundles is still callable: the bundles only show, the scope authorizes.
- **Instructions.** The server's instructions name the store, the bundles listed and those that are not, and say that the user enables a bundle in Louez (Settings > Integrations > MCP > Connected agents), never the agent.

### Hand-written tools

The tools, resources and prompts written before the bridge stay until their domain moves to procedures. They already sit behind the same boundary: the per-request context, `requirePermission` with the role cut down to the scopes (a missing domain is `none`), the plan check and the shared rate limit. Their platform errors answer in the bridge's format. Those that move money or delete (`record_payment`, `delete_payment`, `return_deposit`) declare `sensitive` on `legacyTool`: they take `confirmationToken` and run through `requireConfirmation` before their handler, with a preview of the call and a state read from the record (its status, the amounts, the counts it would delete), under the procedure name `mcp.<tool>`. A call that takes none of a tool's sensitive paths runs directly.

Known limit, accepted until these tools become procedures (lot 2c for payments): the confirmation's state is read and its token checked before the handler, outside the transaction it writes in, so a change landing between the check and the write is not caught. A procedure asks for its confirmation under its domain's lock, inside the write. The store settings tools also need the `manage_settings` permission, as in the dashboard.

## OAuth for agents

Claude.ai, ChatGPT and other MCP clients connect by signing in to Louez, without a key. Louez is the authorization server (Better Auth's `@better-auth/mcp` plugin over its OAuth 2.1 provider) and `/api/mcp` the protected resource. The plugins are set in `packages/auth/src/oauth.ts`.

### The flow

1. The client calls `/api/mcp` without a token. The answer is a 401 with `WWW-Authenticate: Bearer resource_metadata="<app>/.well-known/oauth-protected-resource/api/mcp"`.
2. It reads that document (resource `<app>/api/mcp`, authorization server `<app>/api/auth`), then `<app>/.well-known/oauth-authorization-server/api/auth`. The app's `/.well-known/*` routes hand these paths to Better Auth, which answers them before routing; `/api/auth/.well-known/openid-configuration` is served too.
3. It identifies itself. A Client ID Metadata Document (CIMD, the `cimd()` plugin, MCP 2026-07-28 profile) is the preferred way: the `client_id` is an HTTPS URL that Louez fetches with a resolve-once, private-address-refusing transport. Dynamic client registration (`/api/auth/oauth2/register`) stays open for clients that only know it, restricted: the standard scopes and the MCP resource only, no client-credentials grant, rate limited. No session may manage clients or resources (`clientPrivileges` and `resourcePrivileges` refuse), and the session JWT endpoint of the JWT plugin is off.
4. The browser goes to `/api/auth/oauth2/authorize`. Signed out, it lands on the usual `/login` with a signed query; every sign-in method then goes back to the authorization endpoint (`util.oauth-authorize-url.ts`). Signed in, it lands on the consent page, `/oauth/consent`.
5. The consent page shows who asks without vouching for it: the name the client declared, who declared it (the host serving its metadata document, or "registered dynamically"), and the host of this request's `redirect_uri`, the one Better Auth checked and signed, where the code goes; a loopback redirect gets a warning, as any local program can receive it. "Vérifié" is only for a client id on `VERIFIED_CLIENT_IDS` (`services/agent-grants.ts`), empty for now. A client from a metadata document shows the website icon of its client id's origin (`/favicon.ico`, else the home page's icon links), fetched by Louez through the CIMD transport within 10 seconds, 8 lookups at most at once, with a 100 KB cap, raster only, kept in memory a day (a missing one an hour) and served from `/api/agent-connections/client-icon` to signed-in users; a client that registered itself keeps a generic tile, as the logo it declares could copy another client's. Then the terms below. Accepting calls `dashboard.agentConnections.authorize`: the grant is saved first, then Better Auth records its consent and issues the code. Refusing sends `access_denied` back.
6. The client exchanges the code (PKCE) for an access token bound to the resource, a JWT signed by the JWT plugin (`at+jwt`, one hour), and a refresh token (`offline_access`).

The issuer and the resource come from `AUTH_URL`'s origin, even where the development base URL follows the request host: a token names one issuer. OAuth needs HTTPS (plain HTTP on a loopback host only); an instance on plain HTTP serves no OAuth and keeps API keys.

### Grants

A grant (`api_agent_grants`, one per user and client, linked to the client and the user like Better Auth's consent) holds what the user accepted:

- **Stores**: one, several (`api_agent_grant_stores`), or all of the user's stores, current and future ones.
- **Rights preset**: `read` ("Lecture seule": read on every domain) or `write` ("Lecture et modification": write on every domain, analytics staying read-only). The member's role still cuts it down.
- **Confirmation**: "Demander une confirmation avant les actions sensibles", on by default (`confirmSensitive`).
- **Tool bundles**: `daily` by default; the others are opted in.

Creating, changing and revoking a grant are session-only procedures (`dashboard.agentConnections.*`, `actors: ["session"]`), recorded in `api_operations` on the dashboard's current store. "Agents connectés" on Settings > Integrations > MCP lists the grants with their stores, preset, bundles, last action (the last write in `api_operations`) and creation date. Revoking deletes the grant; its consent and its tokens go with it (see below), so the next authorization asks again.

### The access token on each call

`resolveAccountActor` takes a bearer that is not `lz_…` as an access token, on MCP only (OpenAPI takes keys, RPC sessions). It is verified in full: signature against the JWT plugin's keys (read in process, cached five minutes), issuer, audience (the MCP resource), expiry, type `at+jwt`, `azp`; a DPoP-bound token is refused. Then the grant of that user and client is read again, with its client, which must not be disabled. Each access token names the grant it was issued under (`louez_grant`), and the grant read must be that one.

A token lineage is bound to its grant, not to the user's current one. The grant id is Better Auth's consent reference (`postLogin.consentReferenceId`, read when the authorization starts): the provider stores it on the consent, the code and every refresh token, and carries it to each token refreshed from them. The claim is that reference; issuing a token for a reference whose grant is gone fails with `invalid_grant`, and for JWT access tokens the claims are made before the refresh token rotates, so a refused refresh leaves nothing behind. In the database, `reference_id` on `oauth_consents`, `oauth_refresh_tokens` and `oauth_access_tokens` is a foreign key to `api_agent_grants.id` with `ON DELETE CASCADE`: revoking (deleting the grant) deletes its consent and its whole token lineage in the same statement, and a rotation that inserts its new row after the revoke fails on the key (InnoDB locks the parent row for the child insert, so the two serialize). An unused code from before a revoke is refused at the exchange. A replayed old refresh token no longer exists, so it never triggers the provider's family invalidation, which would otherwise delete every refresh token of the user and client, the new grant's included. Grant ids are never reused, so a deleted grant is its own tombstone. Anything that fails is `UNAUTHENTICATED`; nothing falls back to another credential.

Known limit, in Better Auth 1.7.18 itself: a refresh replay already in flight when the grant is revoked (read before the revoke, sent after a reconnect, outside the provider's 30-second reuse window) reaches the provider's family invalidation, which deletes every refresh token of the user and client, the new grant's included. It grants nothing, and the agent signs in again; it needs a stolen, already-revoked refresh token. Fix upstream: scope `invalidateRefreshFamily` to the token's `referenceId`. A refresh that loses the race against a revoke also answers 500 with an empty body instead of `invalid_grant`.

The credential is `kind: "oauth"`, its id the grant id, its client name the OAuth client's, its scopes the preset's, `confirmSensitive` the grant's. `storeId` is set when the grant covers one store; otherwise `stores` lists the granted ones (null for all) and the caller names one, as in [Stores, tool bundles and instructions](#stores-tool-bundles-and-instructions). The member's role in that store is read on every call, so a removed member is refused. A platform admin gets no staff powers through a token.

---

## Related

- [module-ownership.md](module-ownership.md)
- [../code-review/04-data-layer.md](../code-review/04-data-layer.md)
- [../code-review/06-security.md](../code-review/06-security.md)
- [../from-scratch/04-backend.md](../from-scratch/04-backend.md)
