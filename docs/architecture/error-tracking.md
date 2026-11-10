# Server error tracking

Production server errors go to PostHog error tracking, with their stack trace, so a fault seen once in production can be read without reproducing it. Only what nobody expected is sent, sanitized, and capped: the PostHog free plan is enough.

The logs (evlog, `.evlog/logs` in the container) still get every error, as before.

## What is sent

An error is sent when it is **unexpected**: an exception, or an HTTP status of 500 or more.

| Where it is caught                                                                               | `source`    | How                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A procedure, on every transport (RPC `/api/rpc`, OpenAPI `/api/v1`, MCP `/api/mcp`)              | `procedure` | oRPC client interceptor `reportUnexpectedErrors` (`packages/api/src/platform/error-reporting.ts`), in the RPC and OpenAPI handlers and in MCP's `call()` |
| A hand-written MCP tool, or a tool that throws past its own handling                             | `mcp_tool`  | `reportToolError` (`packages/mcp/src/utils/errors.ts`)                                                                                                   |
| A route handler, a server component, a server action, the proxy                                  | `request`   | `onRequestError` in `apps/web/instrumentation.ts`                                                                                                        |
| A cron task, or the cron itself                                                                  | `cron`      | `runIsolatedTasks` and the cron route's catch (`apps/web/app/api/cron/`)                                                                                 |
| A background job (AI photos): a processing crash, a result or a failure not recorded, the runner | `job`       | `runImageJob` (`packages/api/src/services/product-images.ts`), `runJob`, `apps/web/lib/api/jobs.ts`                                                      |
| A write's effect: a sender that threw, a claim or an outcome not recorded                        | `effects`   | `dispatchEffects` (`packages/api/src/platform/effects.ts`, its `report` option), `apps/web/lib/api/effects.ts`                                           |
| A rejection or exception nothing caught                                                          | `process`   | `unhandledRejection` and `uncaughtExceptionMonitor` listeners, set in `register()`                                                                       |

**Never sent:** a refusal (4xx: validation, `NOT_FOUND`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `CONFIRMATION_REQUIRED`, `NOT_AVAILABLE_TO_THIS_AGENT`, `RATE_LIMITED`…), a 503 our code marks `retryable` (`LARGE_BODY_BUSY`), a caller that went away (`AbortError`), Next's control flow (`redirect()`, `notFound()`, dynamic bailouts) and React's postpone.

An oRPC procedure's error is answered as a 500 by its handler: it reaches error tracking once, from the interceptor, never again from `onRequestError`. An image job's expected failures (`ProductImageFailure`, a timeout) and an effect sender out of time (outcome unknown, the cron retries it) are not sent.

A 5xx oRPC error that wraps another stands for its cause: `toORPCError` (`packages/api/src/utils/orpc-error.ts`) keeps the original as `cause`, which no transport sends, and `rootFault` reports it, so two faults behind `errors.internalServerError` stay two issues.

### What goes with an error

A **copy** of the error: its name, its message, its stack frames, and up to two levels of `cause`. Never the error object itself, whose properties may hold a request or a payload. The message and every frame go through the sanitizer; a validation error (Zod's `issues`), at any level of the cause chain, is sent as its issue codes and paths, never the values its message quotes. A code is sent only in its own format (`[A-Z0-9_.-]`, 64 characters at most: `ER_DUP_ENTRY`, `ECONNREFUSED`, a SQLSTATE); any other is dropped. Messages are cut at 1,000 characters, stacks at 30 frames.

The context is a fixed list of names and ids, nothing a caller sent:

| Property                    | Example                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `source`                    | `procedure`                                                |
| `transport`                 | `rpc`, `openapi`, `mcp`                                    |
| `procedure`                 | `inbox.list`                                               |
| `mcp_tool`                  | `record_payment`                                           |
| `route`, `route_type`       | `/api/mcp`, `route` (Next's declared route, never the URL) |
| `cron_task`                 | `api-effects`                                              |
| `store_id`                  | the store, once the call resolved it                       |
| `client_kind`               | `session`, `api_key`, `oauth`, `storefront`                |
| `client_directory`          | `openai`, `anthropic`, `other` (OAuth clients)             |
| `http_status`, `error_code` | `500`, `OUTPUT_INVALID`, a SQLSTATE                        |
| `repeats_suppressed`        | hits of this fault not sent since the last one             |
| `$app_version`              | `NEXT_PUBLIC_APP_VERSION`, the build                       |

No body, no header, no token, no user or customer data, no person profile (the event is anonymous), no GeoIP.

### The sanitizer

The shared sanitizer of the logs and error tracking, `packages/api/src/platform/sanitize-error.ts`: the copy is built from `sanitizeError` (name, message, codes, frames and causes, each through `sanitizeText`; no other property of the error). `sanitizeText` replaces with `[redacted]`:

- e-mails and international phone numbers;
- bearer, basic, digest and token credentials; sensitive fields (`password=`, `"apiKey": "…"`, `x-api-key:`, cookies); JWTs; Louez API keys (`lz_`), Stripe `sk_`/`rk_`/`pk_` keys, client secrets and `whsec_`; PostHog, GitHub, Slack and AWS keys;
- URL userinfo, query strings and fragments, and a bare path's query (`/api/files/source?…`);
- what a database quotes back of the row: MySQL's `Duplicate entry '…'` and `Incorrect … value: '…'`, Postgres's `Key (…)=(…)` and `Failing row contains (…)`, Drizzle's `params: …`; table, column and key names stay;
- long hex and base64 blobs, and a handoff's secrets (`platform/redact.ts`).

The patterns err toward redacting; ids (`store_…`, nanoids), codes and numbers stay, so the text still says what broke. Frame paths are made relative to the repository (`platform/source-paths.ts`: `apps/…`, `packages/…`, `node_modules/…`, `.next/…`); a path outside it keeps only its file name.

### The last gate

posthog-node reads the source lines around each frame from disk (`pre_context`, `context_line`, `post_context`) after the copy is made. The client's `before_send` (`sanitizeExceptionEvent` in `apps/web/lib/error-tracking.ts`) drops them, makes every path relative and sanitizes again every string the event keeps: numbers and booleans stay, the fingerprint and `error_code` only in their own format, any other value is dropped. It refuses any event that is not an exception.

## How many

Per server process, in `error-reporting.ts`:

- **One fault, once per 10 minutes** (`ERROR_REPEAT_WINDOW_MS`). A fault is its fingerprint: the error's type and code, its message with ids, numbers and quoted values replaced, and its first frame in our code, without line and column. The repeats in between are counted and sent with the next one (`repeats_suppressed`). The fingerprint is also the PostHog issue's (`$exception_fingerprint`), so a fault stays one issue across releases.
- **20 errors per hour, all faults together** (`ERROR_HOURLY_CAP`): at worst 14,400 a month per process. Past it, errors are dropped until the hour ends, and one `errorTracking.hourly_cap_reached` warning is logged.
- **500 faults remembered** (`MAX_TRACKED_FAULTS`), the oldest forgotten first.
- **A sample rate**, optional: `POSTHOG_ERROR_TRACKING_SAMPLE_RATE` (0 to 1, default 1). A fault dropped by sampling is not counted.

Sending never holds a request: the event leaves in the background as soon as it is captured (`flushAt: 1`), with one try of 3 seconds at most. Reporting never throws.

Nothing waits in a buffer: each event is sent as soon as it is captured, so error tracking listens for no signal and no `beforeExit`. Next's standalone server handles SIGTERM and SIGINT on its own (it stops accepting connections, finishes the requests, then exits); a handler beside it could neither delay that exit nor, as PID 1 in Docker, re-raise the signal safely. The remaining risk: an event still in flight when the process exits, such as an error caught a moment before a deploy stops the container, is lost.

## Configuration

| Variable                             | Where                   | Value                                                                               |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------- |
| `POSTHOG_ERROR_TRACKING_ENABLED`     | server                  | `true` or `1` to send; anything else (`false`, `0`, empty), or unset, sends nothing |
| `POSTHOG_ERROR_TRACKING_SAMPLE_RATE` | server, optional        | from `0` to `1`, default `1`                                                        |
| `NEXT_PUBLIC_POSTHOG_KEY`            | already set (analytics) | the project's key, shared with analytics                                            |
| `NEXT_PUBLIC_POSTHOG_HOST`           | already set (analytics) | the ingestion host, default `https://eu.i.posthog.com`                              |

Development and tests send nothing: the flag is off unless set, even where the analytics key is. `next build` sends nothing either. The flag is parsed in `apps/web/lib/error-tracking.ts`, not by the env schema: with `SKIP_ENV_VALIDATION`, `env` hands over the raw string, and `"false"` must stay off.

Error tracking has its own `posthog-node` client, not the analytics one (`apps/web/lib/posthog.ts`), which its callers shut down after each event.

### Stack traces

Frames point at the compiled server chunks of the standalone build (`.next/server/…`), with their function names. Server source maps are not uploaded: it needs PostHog's CLI and a personal API key in the image build, and runtime source maps (`--enable-source-maps`) slow down every thrown error, refusals included. The procedure, the route and the message usually say enough; upload server source maps if a fault needs more.

## Tests

```bash
cd packages/api && SKIP_ENV_VALIDATION=true node --import tsx --test src/platform/sanitize-error.test.ts src/platform/source-paths.test.ts src/platform/error-reporting.test.ts
```

Without network: `sanitize-error.test.ts` plants canaries (e-mails, keys, tokens, rows a database quotes, queries, phones, blobs) and checks they are gone, `source-paths.test.ts` the relative paths; `error-reporting.test.ts` the filtering, the copy, the root fault behind `errors.internalServerError`, fingerprints, the repeat window, the hourly cap, sampling and the interceptor. `apps/web/lib/error-tracking.test.ts` checks the flag (`"false"`, `"0"`, empty, unset stay off), the build, the final event through the real client with PostHog's network intercepted (the source lines it reads from disk do not leave), and that no listener is set for SIGTERM, SIGINT, `beforeExit` or `exit`; `packages/api/src/services/product-images-failure.test.ts` an image job's failure the database did not record; `packages/mcp/src/utils/errors.test.ts` and `apps/web/app/api/cron/isolated-tasks.test.ts` the MCP and cron hooks.

## Related

- [API and agents](api-and-agents.md) — the transports and the platform's errors
- [Application logging (GN-03)](../code-review/00-general.md)
- [Security review rules](../code-review/06-security.md)
- [PostHog error tracking for Node.js](https://posthog.com/docs/error-tracking/installation/node)
