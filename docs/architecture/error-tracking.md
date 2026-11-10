# Server error tracking

Production server errors go to PostHog error tracking, with their stack trace, so a fault seen once in production can be read without reproducing it. Only what nobody expected is sent, sanitized, and capped: the PostHog free plan is enough.

The logs (evlog, `.evlog/logs` in the container) still get every error, as before.

## What is sent

An error is sent when it is **unexpected**: an exception, or an HTTP status of 500 or more.

| Where it is caught                                                                  | `source`    | How                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A procedure, on every transport (RPC `/api/rpc`, OpenAPI `/api/v1`, MCP `/api/mcp`) | `procedure` | oRPC client interceptor `reportUnexpectedErrors` (`packages/api/src/platform/error-reporting.ts`), in the RPC and OpenAPI handlers and in MCP's `call()` |
| A hand-written MCP tool, or a tool that throws past its own handling                | `mcp_tool`  | `reportToolError` (`packages/mcp/src/utils/errors.ts`)                                                                                                   |
| A route handler, a server component, a server action, the proxy                     | `request`   | `onRequestError` in `apps/web/instrumentation.ts`                                                                                                        |
| A cron task, or the cron itself                                                     | `cron`      | `runIsolatedTasks` and the cron route's catch (`apps/web/app/api/cron/`)                                                                                 |
| A background job (AI photos), or the job runner                                     | `job`       | `runJob` (`packages/api/src/services/jobs.ts`), `apps/web/lib/api/jobs.ts`                                                                               |
| The dispatch of a write's effects                                                   | `effects`   | `apps/web/lib/api/effects.ts`                                                                                                                            |
| A rejection or exception nothing caught                                             | `process`   | `unhandledRejection` and `uncaughtExceptionMonitor` listeners, set in `register()`                                                                       |

**Never sent:** a refusal (4xx: validation, `NOT_FOUND`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `CONFIRMATION_REQUIRED`, `NOT_AVAILABLE_TO_THIS_AGENT`, `RATE_LIMITED`…), a 503 our code marks `retryable` (`LARGE_BODY_BUSY`), a caller that went away (`AbortError`), Next's control flow (`redirect()`, `notFound()`, dynamic bailouts) and React's postpone.

An oRPC procedure's error is answered as a 500 by its handler: it reaches error tracking once, from the interceptor, never again from `onRequestError`.

### What goes with an error

A **copy** of the error: its name, its message, its stack frames, and up to two levels of `cause`. Never the error object itself, whose properties may hold a request or a payload. The message and every frame go through the sanitizer; a failed Drizzle query loses its `params:` (the query's values). Messages are cut at 1,000 characters, stacks at 30 frames.

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

The sanitizer is given by the app (`TextSanitizer`). It is the logs' handoff redactor for now; it becomes the generic error sanitizer of `packages/api` (e-mails, bearer and basic tokens, API keys, JWTs, URL queries) when that lands, in `apps/web/lib/error-tracking.ts`. Keep `POSTHOG_ERROR_TRACKING_ENABLED` off until then.

## How many

Per server process, in `error-reporting.ts`:

- **One fault, once per 10 minutes** (`ERROR_REPEAT_WINDOW_MS`). A fault is its fingerprint: the error's type and code, its message with ids, numbers and quoted values replaced, and its first frame in our code, without line and column. The repeats in between are counted and sent with the next one (`repeats_suppressed`). The fingerprint is also the PostHog issue's (`$exception_fingerprint`), so a fault stays one issue across releases.
- **20 errors per hour, all faults together** (`ERROR_HOURLY_CAP`): at worst 14,400 a month per process. Past it, errors are dropped until the hour ends, and one `errorTracking.hourly_cap_reached` warning is logged.
- **500 faults remembered** (`MAX_TRACKED_FAULTS`), the oldest forgotten first.
- **A sample rate**, optional: `POSTHOG_ERROR_TRACKING_SAMPLE_RATE` (0 to 1, default 1). A fault dropped by sampling is not counted.

Sending never holds a request: the event leaves in the background as soon as it is captured (`flushAt: 1`), with one try of 3 seconds at most, and the client is shut down with 2 seconds to spare when the process exits. Reporting never throws.

## Configuration

| Variable                             | Where                   | Value                                                  |
| ------------------------------------ | ----------------------- | ------------------------------------------------------ |
| `POSTHOG_ERROR_TRACKING_ENABLED`     | server                  | `true` to send; anything else, or unset, sends nothing |
| `POSTHOG_ERROR_TRACKING_SAMPLE_RATE` | server, optional        | from `0` to `1`, default `1`                           |
| `NEXT_PUBLIC_POSTHOG_KEY`            | already set (analytics) | the project's key, shared with analytics               |
| `NEXT_PUBLIC_POSTHOG_HOST`           | already set (analytics) | the ingestion host, default `https://eu.i.posthog.com` |

Development and tests send nothing: the flag is off unless set, even where the analytics key is. `next build` sends nothing either.

Error tracking has its own `posthog-node` client, not the analytics one (`apps/web/lib/posthog.ts`), which its callers shut down after each event.

### Stack traces

Frames point at the compiled server chunks of the standalone build (`.next/server/…`), with their function names. Server source maps are not uploaded: it needs PostHog's CLI and a personal API key in the image build, and runtime source maps (`--enable-source-maps`) slow down every thrown error, refusals included. The procedure, the route and the message usually say enough; upload server source maps if a fault needs more.

## Tests

```bash
cd packages/api && SKIP_ENV_VALIDATION=true node --import tsx --test src/platform/error-reporting.test.ts
```

Filtering, the copy and its sanitizing, fingerprints, the repeat window, the hourly cap, sampling and the interceptor, without network. `apps/web/lib/error-tracking.test.ts` checks that it stays off without the flag, the key, or during the build; `packages/mcp/src/utils/errors.test.ts` and `apps/web/app/api/cron/isolated-tasks.test.ts` the MCP and cron hooks.

## Related

- [API and agents](api-and-agents.md) — the transports and the platform's errors
- [Application logging (GN-03)](../code-review/00-general.md)
- [Security review rules](../code-review/06-security.md)
- [PostHog error tracking for Node.js](https://posthog.com/docs/error-tracking/installation/node)
