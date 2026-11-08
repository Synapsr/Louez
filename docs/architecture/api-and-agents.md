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

`accountProcedure` is for calls made before any store is chosen: listing or creating stores, granting an agent. It runs steps 1 to 3, and a key or a token counts on the connection's rate limit. An account procedure declares `meta.account: true`. Without a scope, every connection may call it, and it answers for the connection's own account and stores only (`stores_list`). With one, there is no role to cut it down: the connection's scopes alone decide (`accountRefusal` in `platform/permissions.ts`), a session may do anything on its own account, and a write runs through `runOperation` on the account scope: `store_id` is empty (`ACCOUNT_SCOPE`) in `api_operations` and `api_confirmations`, while keys and tokens stay scoped to the connection. Adding a store (`stores` write) also needs a connection over all the user's stores, present and future: an API key or a grant over chosen stores would never reach the new store, and widening a connection is the user's call, so they get `CONNECTION_BOUND_TO_STORES`. Account procedures check no plan feature: there is no store whose plan to read.

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

- **Lists.** Paginate with a cursor, sort in a stable order, and cap the page size. A list that also takes page numbers for the dashboard bounds them for keys and tokens (`reservations.list`: the first 10,000 rows, then `PAGE_TOO_DEEP`, which points to the cursor).
- **Money and dates.** Money is a decimal string plus a currency. Dates are ISO 8601 with a time zone.
- **Partial updates.** An absent field is left unchanged; `null` clears it.
- **Links.** A procedure that returns a store, a product, a category, a reservation or a customer gives each one `links` (`contracts/links.ts`): `{ dashboard, storefront? }`, absolute URLs built by the helpers of `platform/links.ts` from `ports.urls`, never by hand. A dashboard link names its store (`?store=<id>`), on a dashboard page or a page of the online store editor (`/online-store/<section>`): both show the browser's active store, so the proxy hands such a page load to `app/api/active-store`. A GET never changes the store, as any site can make a browser follow a link: the active store itself, a store the user may not open and an unknown id all redirect to the same URL without the parameter (the answer never tells whether a store exists); another store of the user redirects to `/active-store`, a page that asks "Open in B / Stay on A". Opening posts a form back to the route, which switches only for a same-origin request (`Origin`, and `Sec-Fetch-Site` when sent; the session cookie is `SameSite=Lax`) and a store the user may open (`switchActiveStore`, the store switcher's check), then redirects (303) without the parameter. Signed out, the user goes through `/login` with the link as callback, then the same flow applies. In the in-app chat, a link to the current store drops the parameter and navigates in the app; a link to another store is a full page load, so no client state of the current store carries over. `storefront` is there only when the public can open the page: the store has finished onboarding and, for a product, it is active. Its description tells the model to give these URLs to the user. The in-app assistant's tools return the same links, and the chat opens a dashboard link in the app and a storefront link in a new tab (`components/dashboard/ai-chat/util.chat-link.ts`). Every reservation a reservations procedure returns (list, detail, counters, calendar, planning, agenda, search, status changes, notes) carries its links, and a customer shown with it the customer's; as the customer is null without customers read, so is its link. A link to another domain's record follows that domain's read right.
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

- **One row per effect and channel**, added in the write's own transaction (`enqueueEffects`) with everything it needs: recipients, dates, amounts, lines, language. A rollback leaves no row, an edit after the commit changes no message, and a failed SMS is retried without sending the email again. A reservation status change reads what its preview, its confirmation and its rows show once, under its locks, so the rows are the channels the preview announced.
- **Dispatch.** Once committed, the service hands the ids to `ports.dispatchEffects`; the app sends them after the answer, with one sender per effect type (`apps/web/lib/api/effects.ts`). A sender throws when nothing went out (the row is retried) and answers `skipped` when there is nothing to send (the channel turned off, no address, the SMS limit reached): the row is then `cancelled`.
- **Claims.** A sender claims its row in a short transaction with a fresh token: a `pending` row, a due `failed` one, or a `running` one whose five-minute lease expired, while it has attempts left. Only the token holder records the outcome, and a sender checks its claim (`assertClaim`) right before each provider call: a sender whose claim was taken over neither sends nor records. The check also fails when the sender ran out of time, before or during its query.
- **Database time.** Leases, retries, the cron's choice of rows and the retention are dated and compared with the database's clock (`NOW(3)`), never an app server's: a claim reads `NOW(3)` in its own statement once the row is locked (MySQL fixes `NOW()` when a statement starts) and dates the lease from it, and a claim check compares `locked_until > NOW(3)` in SQL. Two servers whose clocks disagree still agree on who holds a row.
- **Timeouts.** A sender gets an abort signal, which fires after two minutes or 30 seconds before its lease ends, whichever comes first, counted on a monotonic clock from just before the claim reads the database's clock, so a slow claim or commit is spent from the lease; a check of the signal (`throwIfAborted`) also fails past that deadline when a busy event loop has held the timer back. It passes the signal down to each provider call (`apps/web/lib/api/effect-signal.ts`): the SMS API, the Discord webhooks, fromHello and PostHog take it as a fetch signal, with their own 30-second limit; web push and SMTP take no signal, so under a sender they run with their own limits (30 seconds for a push; 15 seconds to connect and 45 of silence for an email), and each checks the signal last, right before it starts. The store logo an email embeds is fetched with the signal too, so preparation that stalled past the timeout never sends. A sender that times out does not release its row: its outcome is unknown, so the row and every later row of its key stay blocked until the five-minute lease ends, and only then does it run again. A provider call that cannot be cancelled can thus overlap a retry only after the full lease. Leases are computed with the database's `NOW(3)`, in the session's time zone: the database sessions must run in UTC, as Drizzle's timestamp handling already assumes, or a lease could stretch or shrink by an hour on a daylight-saving change.
- **Retries.** A failed row runs again after 1, 2, 4… minutes, at most 6 hours, and is `abandoned` after 8 attempts, takeovers included. The unified cron (`/api/cron`, every minute, beside its other tasks so none of them holds it back) retries the due rows, the rows the first dispatch never took, and the expired claims.
- **Order.** Rows of one ordering key (`reservation:<id>:<audience>:<channel>`) go out one at a time, in the order they were added: a row waits while an earlier row of its key is not done.
- **Superseding.** A status change marks as `superseded` only the unsent customer messages it makes false (`SUPERSEDED_CUSTOMER_MESSAGES` in `services/reservation-effects.ts`):

  | New status                                 | Supersedes the unsent              | Why                                                 |
  | ------------------------------------------ | ---------------------------------- | --------------------------------------------------- |
  | cancelled                                  | acceptance of a request or a quote | the booking it confirms is cancelled                |
  | rejected                                   | acceptance                         | the request was refused after all                   |
  | any other (picked up, returned, confirmed) | nothing                            | an acceptance email and its contract link stay true |

  The store's and the platform's notifications are records of each change, and all go out, in order.

- **Gone.** A row whose store or reservation no longer exists is `cancelled` and its payload cleared, never sent. Deleting an account deletes its stores' rows, and deleting a customer deletes theirs.
- **Retention.** The cron deletes done rows (sent, abandoned, cancelled, superseded) 30 days after they were added; superseded and cancelled rows lose their payload at once.
- **Delivery** is at least once: a sender that dies, or times out, between sending and recording leaves its claim to the end of the lease, and the row runs again. An idempotent replay returns the stored result; the first run's rows are already there, and the cron finishes them.
- **Truthful outcomes.** Each sender awaits the real send and throws when it did not go out: analytics go to PostHog's capture API, whose answer is checked (the SDK's flush swallowed failures); an instance without analytics skips the row.
- **One event per row.** An analytics row carries its event's identity, fixed when the row is added (`analyticsEventIdentity`): a UUID and the write's time, sent as PostHog's `uuid` and `timestamp` on every try, so a retry after a lost answer is the same event, not a second one. Reservation rows added before this carry neither and get the time of sending.

Where the store's own notifications go (the owner's phone, the webhook, the members' devices) and whether the store still wants each channel are read when they go out, not frozen: a webhook or a phone changed since is the one that counts, and the table holds no copy of them.

An effect type is a type and its payload in `ApiEffectPayloads`, and a sender in the app. Reservation status changes, an agent's notes change and a store's creation use it; the products' notifications and analytics still go through `afterCommit` (lot 9 moves them).

## Sensitive operations

A procedure that moves money, deletes, sends to a customer or spends credits declares `meta.sensitive`. In its handler, after its checks and before its first write, it calls `requireConfirmation` (`platform/confirmation.ts`). It passes a one-sentence preview and the business `state` the preview shows, such as the amount, the recipients or the record's version.

- A dashboard session, or a connection whose confirmation is turned off (`api_keys.confirm_sensitive = false`), runs directly. The dashboard keeps its own confirmation dialogs.
- Otherwise, the first call does nothing. It fails with `CONFIRMATION_REQUIRED`, which carries the preview and a token valid for ten minutes. The caller sends the same input again with the token in the `Louez-Confirmation` header (`confirmationToken` for MCP tools).
- The token is bound to the actor, the connection, the store, the procedure, the input and the state. It can be used once. If any of these change, the token fails with `CONFIRMATION_INVALID`.

This proves the caller saw the preview. It does not prove that a human approved, because the same agent can make both calls. Human approval, through MCP elicitation or an approval link, comes with the first money procedures.

## Ports

The app lends the API only what is bound to Next.js or owned by the billing service, as one `ApiPorts` object (`platform/ports.ts`). The app builds it in `apps/web/lib/api/ports.ts`, and every handler passes it as `context.ports`. Stripe, e-mail and the other providers are adapters inside the package, not ports.

The effects of a write that the app still owns go through one port, `ports.afterCommit(event)`, called once the transaction has committed: page revalidation (`revalidatePath`), the platform notifications (Discord, fromHello) and the product analytics (PostHog). The service emits a typed `ApiEvent` (`product.created`, `product.updated`, …); the app maps it to its effects in `apps/web/lib/api/after-commit.ts`, revalidating at once and running the rest in `after()`. The port never throws and the answer never waits for it. A domain adds its events to `ApiEvent`.

The deployment's addresses are a port, `ports.urls` (`apps/web/lib/api/urls.ts`): `dashboard(path)` on `NEXT_PUBLIC_APP_URL`, and `storefront(slug, path)` through the app's one storefront builder, so a store subdomain, local path routing (`/<slug>` on localhost) and standalone mode come out as the app's other links do, and a preview deployment links to itself. No domain is written in the package.

Two more ports serve the reservation status changes (`services/reservation-status.ts`): `ports.runReservationEffects` records or voids the pay-as-you-go fee right after the commit (billing), and `ports.insurance` creates or cancels the Tulip insurance contract, a port until the integration moves into the package (lot 7). Both run before the answer and never throw; a failed contract is a warning in the answer, as the dashboard shows it. The customer's message, the store's and the platform's notifications and the analytics event go to the outbox (below); `ports.dispatchEffects` sends them. `reservation.statusChanged` only revalidates the pages.

`ports.newStores` serves the creation of a store ([A new store](#a-new-store)): the pricing terms of a new store and its subscription (billing), its welcome AI credits, the standalone mode, and the referral and sign-up cookies of a dashboard request.

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

A file goes up in three calls, the same on OpenAPI and MCP. The upload service (`services/uploads.ts`) serves every store-owned kind of image; `API_UPLOAD_KINDS` lists the kinds open to the API. Categories expose it as `categories_create_image_upload` and `categories_complete_image_upload`, products as `products_create_image_upload` and `products_complete_image_upload`, the storefront's logos and banner photos as `online_store_create_image_upload` and `online_store_complete_image_upload`.

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
   A domain whose records show another domain's data decides, for a caller without that domain's read, between leaving the data out and refusing. Reservations leave the customer out: a connection with reservations but not customers gets every reservation answer (list, detail, counters, calendar, planning, agenda, search) with the customer, the billing identity, the delivery and return addresses, and every free text that may name them (the team's and the customer's notes, the activity descriptions and details, payment notes) null or empty, and a search by name matches the number only. Payments are left out the same way: without payments read, a reservation comes with no payment rows and no Stripe ids, its payment and deposit entries have no description, every history entry keeps only the details its type lists as free of payment data (`PAYMENT_FREE_ACTIVITY_KEYS` in `services/reservations.ts`), and the payment-method filter is refused (`PERMISSION_DENIED`, payments:read); it keeps `rentalPaid`, what was paid toward the rental, as the dashboard's list shows a paid status to anyone who reads reservations. A cancellation's preview also shows what was paid, for the same reason. The product timeline and history refuse instead (`PERMISSION_DENIED`), as each of their rows is a booking.
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
- On success, `structuredContent` is the output as JSON (dates as ISO strings). A text block says it is done, gives the output's `links` on a line of their own when it has some, and repeats the JSON. A write puts its receipt in `_meta`: `io.louez/operationId` and `io.louez/replayed`.
- On failure, the result has `isError: true`. Its text gives the message, `code`, `retryable` and the details; `structuredContent.error` holds the same facts. `CONFIRMATION_REQUIRED` spells out the preview and the token, and tells the model to ask the user, then call again with the same arguments and `confirmationToken`.

`tools/list` shows only the tools of the connection's bundles that it may call: the member's role cut down to the connection's scopes. The list only shows. Every exposed tool can still be called, and the procedure authorizes the call, so a refusal says `PERMISSION_DENIED` instead of "not found". `packages/mcp/src/tool-registry.ts` serves the list and the calls, because the SDK cannot show a subset of what may be called.

### Stores, tool bundles and instructions

- **Stores.** A connection over several stores (an OAuth grant) names the store of each request: the `Louez-Store` header, or the `storeId` argument every store tool then takes. A grant over all stores takes `storeId` even while it reaches one, since it may create another. A grant that reaches no store yet still connects: the account tools run, the store tools are listed as for an owner and answer `NO_STORE_YET` (a grant over chosen stores that lost them: `NO_STORE_ACCESS`), and resources and prompts are not served. The handler reads `storeId` from the tool call before the context is resolved, so hand-written tools get it too. Without one, the tools are listed, a call that needs a store answers `STORE_REQUIRED`, and resources and prompts are not served. A `storeId` the connection does not reach answers `NO_STORE_ACCESS` from the tool, not from the door. `stores_list` (an account procedure) needs no store.
- **Bundles.** `meta.mcp.bundle` says which bundle a tool is in (`daily`, `catalog`, `settings`, `integrations`, `team`, `billing`); a hand-written tool's bundle follows its domain. `tools/list` shows only the bundles of an OAuth grant; an API key lists every bundle. A tool outside the bundles is still callable: the bundles only show, the scope authorizes. An account tool (`stores_list`, `stores_check_slug_availability`, `stores_create`) is listed whatever the bundles, when the connection may call it.
- **Instructions.** The server's instructions name the store, the bundles listed and those that are not, and say that the user enables a bundle in Louez (Settings > Integrations > MCP > Connected agents, with that page's URL), never the agent. With no store yet, they say how to create one (`stores_check_slug_availability`, then `stores_create`), or, for a connection that may not, that the user creates it or connects the agent again with "Read and edit" rights. They also say that records come with `links` to give the user as they are, and that the agent never builds or guesses a Louez URL.

### Hand-written tools

The tools, resources and prompts written before the bridge stay until their domain moves to procedures. They already sit behind the same boundary: the per-request context, `requirePermission` with the role cut down to the scopes (a missing domain is `none`), the plan check and the shared rate limit. Their platform errors answer in the bridge's format. The customer and payment tools give the dashboard links of what they show in their text, through the same helpers; a link to another domain's record only when the connection may read that domain. Those that move money or delete (`record_payment`, `delete_payment`, `return_deposit`) declare `sensitive` on `legacyTool`: they take `confirmationToken` and run through `requireConfirmation` before their handler, with a preview of the call and a state read from the record (its status, the amounts, the counts it would delete), under the procedure name `mcp.<tool>`. A call that takes none of a tool's sensitive paths runs directly.

Known limit, accepted until these tools become procedures (lot 2c for payments): the confirmation's state is read and its token checked before the handler, outside the transaction it writes in, so a change landing between the check and the write is not caught. A procedure asks for its confirmation under its domain's lock, inside the write.

## A new store

`stores.create` (`stores_create`, `POST /stores`) creates a store owned by the caller. The onboarding's store step calls it through the server-side client when the user has no incomplete store to finish; an agent calls it on MCP. One implementation, `services/store-creation.ts`, does what the onboarding always did, in one transaction under the user row's lock:

- the store with the onboarding's default settings (payment mode, one hour minimum, a day's notice, no buffer, the default business hours), its country's time zone, a referral code of its own, and `onboardingCompleted` false: it is offline until the user launches it;
- the owner's membership;
- the referral attribution and the sign-up origin, read from the cookies of a dashboard request (`ports.newStores.signupAttribution`); an agent's store is attributed to no one;
- the billing marks of the store and its legacy snapshot, and the subscription (`ports.newStores.subscribe`): once the store row exists, the billing code decides through the transaction whether Louez bills it, writes its row then (pay-as-you-go with the offer for new stores, the referred welcome gift included), and returns the terms of that one decision;
- in the outbox: the welcome AI credits (`store.welcomeCredits`, the amount `ports.newStores.welcomeCredits` gives at the creation, frozen in the row; none while the credit layer is off) and the analytics events (`store.creationAnalytics`: the referral attribution, the referred reward when the store got one, the store info saved).

The web address is checked first (`stores.checkSlugAvailability`, which suggests free ones close to it); one taken meanwhile fails on the unique key as `STORE_SLUG_TAKEN`, with suggestions. A standalone instance with a store online refuses another one. A key or a token creates `STORE_CREATION_DAILY_LIMIT` (3) stores per account in 24 hours at most, counted on the database's clock under the user row's lock; a session has no cap. The creation is sensitive (`money`): it starts a billing relationship, so an agent first gets a preview with the name, the future public URL, the country, the currency and the pricing that applies, as the billing code says it for a store created now (`ports.newStores.previewTerms`: none on an instance without platform billing, Louez's pay-as-you-go ladder, or the billing service's offer label), bound to the confirmation's state. The preview comes before the store exists and before the creation's lock: the creation compares the terms `subscribe` returns under that lock with the ones confirmed, and when they differ (a billing cutoff passed while it waited) it rolls everything back with `STORE_TERMS_CHANGED`, so the caller asks for a new preview. A caller that runs directly gets the terms in force, and the answer always shows the terms of the decision. The answer holds the store's id, its dashboard link (no storefront link while it is offline), the future public URL, the pricing and the next steps an agent can take with tools that exist today.

A human who opens the dashboard of an agent's store lands in the onboarding wizard, which resumes that store (the dashboard sends every store whose onboarding is not completed there, and the store step edits the active store instead of creating one), prefilled with what the agent filled in. The account's own steps (profile, acquisition source) belong to that wizard and never gate the dashboard itself: once a store is online, the dashboard opens whether or not they were answered.

## Store settings

`dashboard.settings.*` (`routers/dashboard/settings.ts`, `services/settings.ts`, the `settings_*` tools of the `settings` bundle, `/api/v1/settings`) holds what a store needs before it goes live: one read, `settings.get` (`settings_get`), and one write per section: store info (name, description, contact, coordinates), company (country and time zone, currency, billing address), legal texts (terms, legal notice, footer note), reservation rules, business hours and closures, delivery, pickup points (create, update, show or hide) and taxes. Reading needs `settings` read; writing needs `settings` write and the member permission `manage_settings`, as the dashboard's settings pages do. Each answer carries the links of its settings page; legal texts and store info link to the online store editor.

- **Partial writes.** A field left out stays; `null` clears it. The business hours take days by name (`monday`…`sunday`, stored as 0 to 6 from Sunday); their closures are replaced as a list, and one sent without an id gets one. Delivery fees are decimal strings in the store's currency.
- **Texts.** The description, the terms and the legal notice take plain text (a blank line makes a paragraph, a line break a `<br>`) or HTML, sanitised as the editor's own (`toEditorHtml`); blank text is null. The sanitiser (`sanitizeRichTextHtml` from `@louez/utils/sanitize-rich-text`, also applied on read) parses the HTML with `sanitize-html` (htmlparser2) against the editor's allow-list, and it is idempotent: a bare `&`, `<` or `>` is escaped, a character reference already there is kept, a link's `href` stays as written (its scheme is checked on a decoded copy), so a text saved again and rendered again reads the same. Its cost follows the input's length: htmlparser2 pays the depth on each open tag, so a one-pass scanner first turns any tag deeper than 256 levels into text, following the parser's own void, raw-text and implied-close rules. It cuts nothing: a write checks the sanitised HTML against its TEXT column (65,535 bytes, `TEXT_TOO_LONG`), so what the storefront renders is bounded by what can be stored. It runs on the server only: it is not exported from the package's root, the storefront's `RichText` is a server component, a client component renders HTML its server parent sanitised (`RichTextHtml`), and `apps/web/lib/client-bundle-boundary.test.ts` fails when an import from a client module reaches it. Whether a text shows anything is `hasRichTextContent` (`@louez/utils`), for the API's summaries as for the storefront.
- **One lock.** Every write locks the store row first, then reads the row and writes it back: the `settings` JSON holds every section, so two writes of different sections never lose each other's change. No check reads reservations, so no other row is locked. Every other writer of `settings` or `theme` does the same through `mergeStoreRow` (or `lockStoreRow` inside its own transaction) from `@louez/db`: the onboarding's store step, branding and completion, inspections, integrations, customer fields, and the store's own JSON columns beside `settings`: the store's and the customers' notification settings, Review Booster's.
- **Currencies.** A currency is one of `SUPPORTED_CURRENCY_CODES` (`@louez/utils`), the ones the app formats and Stripe charges in; `stores.create` and the onboarding take the same list. Another code is refused before any preview (`CURRENCY_NOT_SUPPORTED`), except the store's own currency sent back unchanged: a store set up in one Stripe no longer takes (HRK) keeps it while it saves the rest, and the company page offers it as a former currency.
- **Reading.** `settings.get` shows the legal texts as a summary (set or not, length, the store's last change); `includeLegalTexts: true` adds the texts themselves.
- **Confirmation.** What customers see or pay at checkout is confirmed with a preview of each value before and after, bound to those values and asked under the lock: a new country or currency, the booking mode or the share paid online, any delivery setting, any tax setting. A write that changes none of them runs directly; text, hours and pickup points never ask.
- **Rules.** Payment mode needs Stripe charges enabled (`STRIPE_REQUIRED`), as the dashboard's dialog said; the shortest rental may not be longer than the longest one; delivery needs the store's coordinates (`STORE_COORDINATES_REQUIRED`). A store has 50 pickup points at most (`LOCATION_LIMIT_REACHED`); one above keeps them.
- **Billing.** The company marks the store, and every reservation of the store on a new currency; taxes mark every reservation when the rate the dashboard's totals add changes (`beforeTaxRateBps`) ([DL-13](../code-review/04-data-layer.md)).
- **Effects.** Each write emits `store.settingsUpdated` with its section: the app revalidates the section's pages (the business hours every storefront page of the store), and the company and reservation rules notify the platform, as their server actions did.

`dashboard.onlineStore.*` (`routers/dashboard/online-store.ts`, `services/online-store.ts`, the `online_store_*` tools, also in the `settings` bundle, `/api/v1/online-store`) holds the storefront, under the `online_store` domain (an API key made before that domain existed has `none`) and `manage_settings`:

- `online_store.update` is the online store editor's one save: each section it sends (identity, home, contact, legal, seo) replaces what it covers. `online_store.updateAppearance` takes the look field by field: theme, colour, logos, favicon, banner photos and their layout. Both take the store's own images only (`IMAGE_NOT_OWNED` otherwise), and both lock the store row before they patch the `theme` and `settings` JSON. A changed theme invalidates the storefront's cached theme colour (`store.storefrontUpdated`).
- `online_store.createImageUpload` and `completeImageUpload` upload a logo or favicon (`kind: "logo"`) or a banner photo (`kind: "hero"`), as [Uploads](#uploads) describes; the dashboard keeps its own file route.
- `online_store.checkSlugAvailability` and `online_store.updateSlug` change the store's web address. Louez keeps no history of former addresses, so a link to the old one stops working once the store is online: the change is sensitive (`destructive`) and its preview shows the old and the new URL and that nothing redirects, bound to the old address and to whether the store is online, both read under the store's lock. A reserved address is refused by the input (`RESERVED_SLUGS`, which holds every first path segment of the app and of the proxy; `apps/web/lib/reserved-slugs.test.ts` walks the app router as Next.js reads it, through route groups, parallel slots and intercepting routes, and fails when one is missing), for a new store too; one taken by another store before the lock answers `STORE_SLUG_TAKEN` with suggestions, and two stores taking the same address at once meet on the unique key, where the second gets the same answer. The slug is in the store's billing snapshot, so the store is marked. The app revalidates the dashboard, the editor and both storefront paths, and drops both addresses' cached theme (`store.slugChanged`). Every event of these writes names the store by the slug its locked row holds, so a rename that committed while a write waited is the one invalidated.

`settings.get` also shows the storefront: its address and URL, tagline, language and look.

The former tools `get_store_settings`, `update_store_info` and `update_store_legal` are aliases of `settings_get`, `settings_update_store_info` and `settings_update_legal`, with the same arguments.

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

Creating, changing and revoking a grant are session-only account procedures (`dashboard.agentConnections.*`, `actors: ["session"]`), recorded in `api_operations` on the account scope, so a user with no store yet can connect an agent. The consent page then offers only "all my stores, including the next ones", says the agent can create the store with "Read and edit" rights, and the grant reaches every store the user creates later, the agent's own included. A store granted before that the user can no longer open is dropped from what the page and the connection editor start from (a user left with no store reconnects over every store to come); the procedures refuse such a store with `AGENT_CONNECTION_STORE_INVALID` and change nothing. "Agents connectés" on Settings > Integrations > MCP lists the grants with their stores, preset, bundles, last action (the last write in `api_operations`) and creation date. Revoking deletes the grant; its consent and its tokens go with it (see below), so the next authorization asks again.

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
