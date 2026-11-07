# API and agents

Every action a store user can take in the dashboard is one oRPC procedure in `packages/api`. The same procedure serves three transports:

| Transport | Endpoint   | Credential                             | Caller                                |
| --------- | ---------- | -------------------------------------- | ------------------------------------- |
| RPC       | `/api/rpc` | dashboard session cookie               | the dashboard, through TanStack Query |
| OpenAPI   | `/api/v1`  | API key (`Bearer lz_…`)                | scripts, n8n, integrations            |
| MCP       | `/api/mcp` | API key; OAuth access token from lot 1 | Claude, ChatGPT and other agents      |

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
  .input(categoryInputSchema)
  .output(categorySchema)
  .handler(async ({ context, input }) => createCategory(context.actor.storeId, input));
```

`storeProcedure` does this before the handler runs, on every call:

1. It checks that the credential is one the transport accepts and that it is still valid. A credential that is present but invalid fails. The procedure never falls back to another credential: a bad token never falls back to the cookie.
2. It checks `meta.actors`. `["session"]` refuses every key and token. Use it for anything that creates, changes or revokes a credential, changes a connection's confirmation setting, or invites or promotes a member, so an agent can never give itself more rights.
3. It checks `meta.platformAdmin`: platform staff, from a session only.
4. It resolves the store and reads the role the user holds there now. A removed or demoted member loses access on their next call.
5. It checks `meta.scope`. The right that applies is the member's role cut down to the connection's scopes. A session has its role only. A procedure without a scope is refused. A domain missing from a key's permissions is `none`.
6. For a key or a token, it checks that the store's plan has `apiAccess`, through `ports.planFeatures`, and applies the rate limit: 120 calls per minute per connection, counted in the database so every instance shares it.
7. It runs every write (`scope.level: "write"`) through `runOperation` (see below).

The handler reads `context.actor` (user, credential, transport, store id and role) and `context.store` (the store row).

`accountProcedure` is for calls made before any store is chosen, such as listing or creating stores.

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

A procedure that calls a provider (Stripe) before its own transaction passes the idempotency key on to the provider. An effect after the commit (e-mail, notification, sync) must never fail the operation once it has committed. Its state on the operation row arrives with the first procedure that has such effects.

## Sensitive operations

A procedure that moves money, deletes, sends to a customer or spends credits declares `meta.sensitive`. In its handler, after its checks and before its first write, it calls `requireConfirmation` (`platform/confirmation.ts`). It passes a one-sentence preview and the business `state` the preview shows, such as the amount, the recipients or the record's version.

- A dashboard session, or a connection whose confirmation is turned off (`api_keys.confirm_sensitive = false`), runs directly. The dashboard keeps its own confirmation dialogs.
- Otherwise, the first call does nothing. It fails with `CONFIRMATION_REQUIRED`, which carries the preview and a token valid for ten minutes. The caller sends the same input again with the token in the `Louez-Confirmation` header (`confirmationToken` for MCP tools).
- The token is bound to the actor, the connection, the store, the procedure, the input and the state. It can be used once. If any of these change, the token fails with `CONFIRMATION_INVALID`.

This proves the caller saw the preview. It does not prove that a human approved, because the same agent can make both calls. Human approval, through MCP elicitation or an approval link, comes with the first money procedures.

## Ports

The app lends the API only what is bound to Next.js or owned by the billing service, as one `ApiPorts` object (`platform/ports.ts`). The app builds it in `apps/web/lib/api/ports.ts`, and every handler passes it as `context.ports`. Stripe, e-mail, storage and the other providers are adapters inside the package, not ports.

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

- A procedure without its own route is `POST /api/v1/<path with slashes>`, such as `POST /api/v1/dashboard/categories/create`. The body is the input.
- The credential is an API key: `Authorization: Bearer lz_…`.
- A write answers with `Louez-Operation-Id`, its receipt. A replayed write also sends `Louez-Replayed: true`.
- An error keeps oRPC's JSON shape (`defined`, `code`, `status`, `message`) with our `data`: `code`, `retryable`, `i18nKey`, `details`.

The spec (`/api/v1/openapi.json`) and a Scalar reference (`/api/v1/docs`) are generated by oRPC, in development only. In production these paths answer 404. The spec documents the bearer API key scheme, the `Idempotency-Key` header on writes, the `Louez-Confirmation` header on sensitive procedures and the receipt headers. Its `operationId` is the tool name.

## MCP

`/api/mcp` (`apps/web/app/api/mcp/route.ts`) serves Streamable HTTP with the official SDK v2, statelessly. No session is kept between requests.

- Every request resolves its own context (`packages/mcp/src/auth/resolve.ts`): the key, the store and the role held there now, and the plan's API access. A revoked key, a removed member or a lower role applies on the next request.
- A request that fails there never reaches MCP. It gets the platform's error as JSON, with its HTTP status, and `WWW-Authenticate: Bearer` on a 401.
- Each request gets a server built for it. GET and DELETE answer 405: there is no session to stream on or to close.
- Rate limiting is the shared limiter. A tool call counts once, where it runs. Every other request counts at the door.

### The bridge

`packages/mcp/src/bridge.ts` makes one tool per exposed procedure.

- The name, description and annotations come from `meta.mcp`. The arguments are the input's JSON Schema.
- A write (`scope.level: "write"`) takes an optional `idempotencyKey`. A sensitive procedure takes an optional `confirmationToken`.
- The tool calls the procedure with `transport: "mcp"` and new headers: the request's `Authorization` and `Louez-Store`, `idempotency-key` from `idempotencyKey`, and `louez-confirmation` from `confirmationToken`. The procedure validates the input, so a bad input fails as it does on the other transports.
- On success, `structuredContent` is the output as JSON (dates as ISO strings). A text block says it is done and repeats the JSON. A write puts its receipt in `_meta`: `io.louez/operationId` and `io.louez/replayed`.
- On failure, the result has `isError: true`. Its text gives the message, `code`, `retryable` and the details; `structuredContent.error` holds the same facts. `CONFIRMATION_REQUIRED` spells out the preview and the token, and tells the model to ask the user, then call again with the same arguments and `confirmationToken`.

`tools/list` shows only the tools the connection may call: the member's role cut down to the connection's scopes. The list only shows. Every exposed tool can still be called, and the procedure authorizes the call, so a refusal says `PERMISSION_DENIED` instead of "not found". `packages/mcp/src/tool-registry.ts` serves the list and the calls, because the SDK cannot show a subset of what may be called.

### Hand-written tools

The tools, resources and prompts written before the bridge stay until their domain moves to procedures. They already sit behind the same boundary: the per-request context, `requirePermission` with the role cut down to the scopes (a missing domain is `none`), the plan check and the shared rate limit. Their platform errors answer in the bridge's format. The store settings tools also need the `manage_settings` permission, as in the dashboard.

---

## Related

- [module-ownership.md](module-ownership.md)
- [../code-review/04-data-layer.md](../code-review/04-data-layer.md)
- [../code-review/06-security.md](../code-review/06-security.md)
- [../from-scratch/04-backend.md](../from-scratch/04-backend.md)
