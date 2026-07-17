# Effect Engineering Capability Audit

Session: `ses_0907d552dffeOdRJnEMuSbK6xX`

Mode: development, read-only audit. No project files were modified during the audit.

## Findings

### Expected failures are fragmented and not composable

**Current state**

Failures use incompatible mechanisms:

- `ApiServiceError` exposes only five broad codes and an unvalidated `details?: unknown` in `packages/api/src/services/errors.ts:1-18`.
- `toORPCError()` accepts `unknown`, logs unexpected failures through `console.error`, then erases them into a generic 500 in `packages/api/src/utils/orpc-error.ts:24-43`.
- `createReservation()` returns ad hoc `{ error: string }` values while other paths throw exceptions in `apps/web/app/(storefront)/[slug]/checkout/actions.ts:532-572`.
- Infrastructure, validation, provider, and domain failures frequently share the same exception channel.

**Why it matters**

Function signatures do not reveal what can fail. Callers cannot exhaustively handle expected failures, retries cannot reliably classify transient errors, and workflows routinely convert failures into strings or apparent success.

This is weaker than a closed error model. It is not merely stylistic.

**Effect comparison**

`t3code` declares `Effect<_, ProviderServiceError>` service operations, `stack` uses a closed `StackError` union, and Executor separates schema-tagged expected failures from opaque internal failures carrying a trace ID.

Effect would provide a major improvement here: errors remain explicit through composition and can be recovered by tag. That gain only exists if Louez defines narrow domain errors instead of using `unknown`, `orDie`, or indiscriminate `catchAll`, weaknesses also present in some reference projects.

---

### Boundary validation is strong in oRPC but dangerously inconsistent elsewhere

**Current state**

The oRPC layer is generally good:

- Authentication, tenancy, and permissions are centralized in `packages/api/src/procedures.ts:24-125`.
- Inputs use bounded Zod schemas in `packages/validations/src/api.ts`.
- Google Calendar responses are decoded with Zod in `apps/web/lib/integrations/providers/google-calendar/google-calendar-client.ts:13-38`.

But equivalent boundaries bypass those guarantees:

- `createReservation(input: CreateReservationInput)` trusts an erased TypeScript interface and immediately reads nested values and constructs dates in `checkout/actions.ts:532-558`.
- Most oRPC procedures lack output schemas.
- Drizzle `$type<T>()` JSON columns and several external responses are trusted through casts.
- Tulip's transport starts from `unknown` but ultimately returns `payload as T` in `apps/web/lib/integrations/tulip/client.ts:183-225`.

**Why it matters**

The project has two safety levels: validated oRPC paths and effectively unvalidated server actions/integration paths. Invalid quantities, dates, persisted JSON, or provider payloads can enter business logic while TypeScript falsely presents them as trusted.

**Effect comparison**

`effect-monorepo` decodes database results through `Schema.decode`; `building-an-app-with-effect` attaches schemas directly to SQL operations; `accountability` and `effect-tanstack-start` reuse schemas across HTTP/RPC clients and handlers.

Effect Schema would make one codec usable across input, output, persistence, and serialization. However, Effect is not required here. Extending the existing Zod/oRPC discipline would provide equivalent boundary safety with less machinery. The problem is inconsistent enforcement, not Zod.

---

### Dependency injection is partial and collapses into globals plus an optional service locator

**Current state**

`BaseContext` in `packages/api/src/context.ts:90-577` contains a large collection of optional callbacks. Meanwhile, procedures still import global `auth` and `db` directly in `packages/api/src/procedures.ts:1-5,85-88`.

Other infrastructure is also module-global: DB pool, Stripe, S3, SMTP, SMS, PostHog, and mutable auth hooks. The DB pool is created at import time in `packages/db/src/index.ts:8-30`.

**Why it matters**

Required capabilities are not visible in procedure types. Missing callbacks become runtime errors, while globally imported dependencies cannot be replaced locally. Tests need module mocking, import-order control, or global mutation.

The current context is not clean dependency injection. It is a large optional service locator combined with hidden globals.

**Effect comparison**

`stack` replaces `Git`, `Store`, `Progress`, and `CodeHost` through test layers. `opencode`'s `LayerNode` verifies replacement dependencies and errors statically. Kilo builds one explicit `ManagedRuntime`. Foldkit ties shared resources to a runtime-owned scope.

Effect would provide a major improvement by making each operation's required services explicit and statically provisioned. Narrow ordinary TypeScript interfaces and manual factories could achieve similar testability, but the current implementation does not.

---

### Background workflows are race-prone and do not have durable execution semantics

**Current state**

`processCalendarSyncQueue()` selects pending rows without claiming or locking them in `apps/web/lib/integrations/calendar/sync.ts:328-365`. Concurrent workers can process the same row and create duplicate remote events.

The retry ceiling is broken:

```ts
syncStatus: nextAttemptCount >= MAX_ATTEMPTS ? 'failed' : 'failed'
```

See `sync.ts:376-388`. Failed rows remain eligible indefinitely.

The unified cron executes unrelated tasks sequentially without a lease in `apps/web/app/api/cron/route.ts:66-127`. Similar check-then-act or send-then-log races exist in SMS top-ups, reminders, reviews, and Stripe webhooks.

**Why it matters**

These are concrete correctness failures: duplicate credits, duplicate notifications, duplicate remote events, permanently retried poison jobs, and partial state after crashes.

**Effect comparison**

Alchemy persists intermediate lifecycle states before external effects and tests interrupted recovery. Executor implements idempotent concurrent resume. `t3code` and Kilo use atomic refs, deferred values, scoped workers, and explicit cancellation states.

Effect would improve local workflow composition, interruption, retry policy, and race testing. It would not by itself solve distributed execution. Louez still needs database claims, unique constraints, transactions, leases, and persisted state. Adopting Effect without those would be cosmetic.

---

### Cancellation, deadlines, and resource lifecycles are mostly unmanaged

**Current state**

Tulip is a positive exception: it uses `AbortController`, a timeout, typed network mapping, and `finally` cleanup in `apps/web/lib/integrations/tulip/client.ts:131-181`.

Most other outbound requests have no timeout or caller cancellation. The DB pool has an unlimited waiter queue and no exported shutdown operation in `packages/db/src/index.ts:14-30`. Detached analytics, webhook notifications, and cache refreshes can outlive request ownership or disappear when the runtime stops.

**Why it matters**

A stalled provider can block an entire request or sequential cron run. Shutdown cannot reliably drain resources. Detached required work has no completion, cancellation, or durability guarantee.

Manual `AbortController` and `try/finally` work, but the repository applies them inconsistently.

**Effect comparison**

`opencode` scopes subprocesses and removes abort listeners automatically. Foldkit releases runtime resources when scopes close. `stack` scopes child processes. Kilo's runner handles cancellation across every state. `effect-monorepo` uses `acquireRelease` for DB pools and finalizers for SSE queues.

This is one of the strongest arguments for Effect: interruption and cleanup become properties of composition rather than optional discipline repeated per client.

---

### The test system is not capable of validating the risky behavior

**Current state**

There is no root or package `test` script and no Turbo test task: `package.json:35-58`, `apps/web/package.json:5-13`, and `turbo.json:4-41`.

The existing tests primarily cover deterministic pure helpers. There is effectively no coverage for webhooks, transactions, authorization, queue races, cancellation, provider timeouts, migrations, or resource cleanup.

**Why it matters**

The project's most dangerous defects are concurrency and failure-path defects, but the test system primarily verifies calculations. There is no demonstrated mechanism for deterministic clocks, controlled retries, replacing global services, interrupting fibers/tasks, or asserting finalizer behavior.

**Effect comparison**

`effect-monorepo` tests TTL and eviction with `TestClock`; Kilo tests cancellation and replacement races; Alchemy tests interrupted deployment recovery; Executor tests concurrent idempotent resume; `stack` replaces complete services with memory layers.

Effect would immediately add useful primitives for virtual time, fibers, scopes, and layer replacement. It will not fix the absence of a test command or CI gate. That part is plain engineering neglect, independent of framework choice.

---

### Configuration validation exists but production deliberately undermines it

**Current state**

The environment schemas are extensive and generally strong. However:

- `skipValidation: !!process.env.SKIP_ENV_VALIDATION` bypasses every guarantee for any non-empty value in `apps/web/env.ts:342`.
- Docker defaults that flag to `true` in `docker/Dockerfile.web:62-64`.
- Next compiles it into application code in `apps/web/next.config.ts:272-277`.
- Production builds ignore TypeScript errors in `next.config.ts:266-271`.

**Why it matters**

The application can start with missing or wrongly typed secrets while TypeScript treats them as validated. Failures move from deterministic startup to whichever production path first consumes the bad value.

**Effect comparison**

`effect-monorepo` models integers, URLs, literals, redacted secrets, and defaults through Effect Config. Effect's config tests distinguish missing values from malformed present values. Kilo generates live and test config layers from the same declaration.

Effect could make configuration injectable and typed in the service graph, but it cannot prevent an explicit "skip all validation" escape hatch. Removing that bypass would produce the largest immediate improvement.

---

### Financial idempotency proves Effect is not required for strong guarantees

**Current state**

Pay-as-you-go billing is one of the strongest subsystems:

- It claims a unique store/month invoice before Stripe calls in `apps/web/lib/pay-as-you-go/billing.ts:164-185`.
- It freezes request values across retries and uses deterministic Stripe idempotency keys in `billing.ts:202-246`.
- Metering serializes per store with `SELECT ... FOR UPDATE` and performs writes transactionally in `apps/web/lib/pay-as-you-go/metering.ts:195-274`.
- Duplicate insertion is handled as an explicit idempotent outcome in `metering.ts:275-280`.

**Why it matters**

This provides real cross-process guarantees: DB serialization, stable external idempotency, and resumability. An Effect rewrite would not strengthen those properties automatically.

This subsystem is materially better than several Effect references whose queues remain process-local or unbounded.

**Effect comparison**

Alchemy's persisted lifecycle model is comparable, but Louez already achieves the essential guarantees with Drizzle, MySQL, and Stripe idempotency. Effect could improve typed failure classification and testing around this code, not its core consistency model.

---

### The plain execution model is currently more transparent for simple request paths

**Current state**

Most Louez code is ordinary TypeScript: Next handlers, oRPC procedures, Zod schemas, Drizzle transactions, and explicit `async` control flow. The production path can usually be traced without understanding fibers, layers, causes, scopes, schedules, or managed runtimes.

**Why it matters**

Effect adds a substantial runtime and abstraction vocabulary. That cost is justified for complex service composition, cancellation, workflows, and failure algebra. It is not justified for every CRUD query, schema parse, or deterministic pricing function.

Several references demonstrate the danger of over-crediting Effect:

- `effect-tanstack-start` uses an in-memory `Ref` and proves little about persistence.
- Accountability swallows security-relevant failures with `catchAll`.
- Alchemy uses `orDie`, casts, and mutable maps in important paths.
- Kilo and ghui still contain global state, Promise queues, manual timers, and uncancelled fire-and-forget work.

**Effect comparison**

The current approach is preferable for pure pricing code, straightforward transactional SQL, simple oRPC handlers, and framework-native Next.js integration. Introduce Effect only where the execution semantics materially change.

## Five Strongest Arguments

1. **Typed failure composition:** replace mixed exceptions, string results, and `unknown` with explicit recoverable domain failures.
2. **Scoped resource safety:** propagate cancellation and guarantee cleanup across HTTP, DB, subprocess, queue, and background-task boundaries.
3. **Explicit service requirements:** replace optional mega-contexts and module globals with statically provisioned, replaceable capabilities.
4. **Deterministic concurrency testing:** test retries, time, cancellation, finalizers, and worker races without real sleeps or global mocks.
5. **Consistent operational instrumentation:** attach spans, annotations, retries, and failure causes at service operations rather than sporadically at route boundaries.

## Already Strong Without Effect

- oRPC authentication, tenancy, permission middleware, and input schemas.
- Google Calendar response decoding.
- Tulip timeout and network-error handling, aside from its final unchecked generic cast.
- Pay-as-you-go transaction locking, idempotency keys, frozen retry inputs, and duplicate handling.
- Pure pricing and referral logic with focused boundary tests.
- The direct, framework-native execution model for uncomplicated request/response code.

## First Three Immediate Improvements

1. **External clients and background workers:** shared timeout, cancellation, retry classification, scopes, and finalizers.
2. **API/service failure contracts:** tagged domain errors with safe transport encoding and opaque correlated internal errors.
3. **Service/test composition:** replace global DB/provider clients and optional context callbacks with explicit live and test layers.

## Verdict

Effect would provide real, major technical improvements in Louez's asynchronous infrastructure, failure model, service composition, and testing capability.

It should not replace the whole application. The validated oRPC paths, transactional SQL, and financial idempotency already prove that ordinary TypeScript can provide equally strong guarantees.

The blunt reality is that Louez's core weakness is not "lack of Effect." It is inconsistent engineering discipline: excellent guarantees in isolated billing code, weak guarantees in equally critical checkout, webhook, cron, and integration code. Effect is valuable here because it can make cancellation, dependency requirements, failure channels, and lifecycle handling harder to omit. It will not rescue bad schemas, swallowed errors, missing DB constraints, or non-durable workflows.
