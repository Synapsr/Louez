import { db, stores } from "@louez/db";
import { os } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { BaseContext } from "../context";
import {
  ACCOUNT_SCOPE,
  resolveAccountActor,
  resolveStoreActor,
  type AccountActor,
  type Credential,
  type ScopedActor,
  type StoreActor,
} from "./actor";
import { apiError, platformErrors } from "./errors";
import type { ApiMeta } from "./meta";
import { IDEMPOTENCY_HEADER, runOperation } from "./operations";
import { accountRefusal, allows, type ProcedureScope } from "./permissions";
import { consumeRateLimit, rateLimitKey } from "./rate-limit";
import { recordedSetupAction, setupProcedureName } from "./setup-analytics";

/** Store row handed to agent-ready procedures. */
export type ActorStore = typeof stores.$inferSelect;

/** Header with which a caller picks a store when its connection covers several (an OAuth grant). */
export const STORE_HEADER = "louez-store";

// Validation runs outside every middleware: the input is parsed before the
// guards and the operation record see it (so idempotency hashes what the
// handler gets), and the output is checked last, replays included.
const base = os
  .$config({
    initialInputValidationIndex: Number.NEGATIVE_INFINITY,
    initialOutputValidationIndex: Number.NEGATIVE_INFINITY,
  })
  .$meta<ApiMeta>({})
  .$context<BaseContext>();

/** A Standard Schema (Zod's included), as oRPC keeps a procedure's output schema. */
interface StandardSchema {
  "~standard": {
    validate: (
      value: unknown,
    ) =>
      | { value: unknown; issues?: undefined }
      | { issues: readonly unknown[] }
      | Promise<{ value: unknown; issues?: undefined } | { issues: readonly unknown[] }>;
  };
}

/** The output as the caller gets it: through the procedure's output schema, when it has one. */
async function validateOutput(schema: unknown, value: unknown): Promise<unknown> {
  if (!schema) return value;
  const result = await (schema as StandardSchema)["~standard"].validate(value);
  if (result.issues) {
    throw apiError("INTERNAL_SERVER_ERROR", "OUTPUT_INVALID", {
      message: "The procedure returned something its contract does not allow.",
    });
  }
  return result.value;
}

export function missingTransport() {
  return apiError("INTERNAL_SERVER_ERROR", "TRANSPORT_MISSING", {
    message: "The handler did not say which transport the call came through.",
  });
}

/** Who calls, checked on every call: shared by the account and the store procedures. */
const authenticated = base.use(async ({ context, next, procedure }) => {
  if (!context.transport) throw missingTransport();
  const meta = procedure["~orpc"].meta;
  const actor: AccountActor = await resolveAccountActor({
    transport: context.transport,
    headers: context.headers,
  });
  if (context.errorScope) {
    context.errorScope.client = actor.credential.kind;
    if (actor.credential.directory) context.errorScope.directory = actor.credential.directory;
  }
  // A procedure the client's directory forbids is refused first, before any
  // confirmation or idempotency key: a replay never reaches it either.
  if (meta.capability && actor.credential.withheld?.capabilities.includes(meta.capability)) {
    throw platformErrors.capabilityWithheldFromClient(meta.capability);
  }
  if (meta.actors && !meta.actors.includes(actor.credential.kind))
    throw platformErrors.sessionOnly();
  if (meta.platformAdmin && !(actor.isPlatformAdmin && actor.credential.kind === "session")) {
    throw platformErrors.permissionDenied("platform_admin");
  }
  return next({ context: { actor } });
});

/**
 * A write's run through `runOperation`: recorded, and replayed for a repeated
 * idempotency key. The handler's output is what an idempotent retry gets
 * back; `output()` answers a replay without running the handler. The replayed
 * output still goes through the procedure's output schema, which runs outside
 * the middleware (see `base`).
 */
async function recordWrite<T extends { output: unknown }>(input: {
  actor: ScopedActor;
  path: readonly string[];
  meta: ApiMeta;
  outputSchema: unknown;
  headers: Headers;
  receipt: BaseContext["receipt"];
  rawInput: unknown;
  dispatchEffects?: (ids: readonly string[]) => void;
  run: () => T | PromiseLike<T>;
  replay: (output: unknown) => T;
}): Promise<T> {
  let ran: T | undefined;
  const { actor } = input;
  const result = await runOperation(
    {
      actor,
      procedure: input.path.join("."),
      input: input.rawInput,
      idempotencyKey: input.meta.secretOutput ? null : input.headers.get(IDEMPOTENCY_HEADER),
      receipt: input.receipt,
      toStored: (raw) => validateOutput(input.outputSchema, raw),
      // A setup write marks the offline store it locks; an agent's then sends
      // its setup action (platform/setup-analytics.ts).
      marksSetup: setupProcedureName(input.path) !== null,
      recordedEffects: recordedSetupAction({
        credential: actor.credential,
        transport: actor.transport,
        path: input.path,
        input: input.rawInput,
      }),
      dispatchEffects: input.dispatchEffects,
    },
    async () => {
      ran = await input.run();
      return ran.output;
    },
  );
  return ran ?? input.replay(result);
}

/**
 * A signed-in account, before any store: list one's stores, create a store,
 * grant an agent. On every call, before the handler:
 *
 * 1. the credential is checked as for a store procedure (`meta.actors`,
 *    `meta.platformAdmin` included);
 * 2. a `meta.scope` is checked against the connection's scopes alone, as
 *    there is no store and so no role (`accountRefusal`); a session may do
 *    anything on its own account;
 * 3. a key or a token counts on the connection's rate limit, as a store call
 *    does.
 *
 * Writes (`scope.level === "write"`) then run through `runOperation`, on the
 * account scope (`ACCOUNT_SCOPE`): recorded, and replayed for a repeated
 * idempotency key.
 */
/**
 * Why a scope is refused: the agent's directory forbids the domain (no grant
 * changes it), else the connection or the role does not allow it.
 */
function scopeRefusal(credential: Credential, scope: ProcedureScope) {
  if (credential.withheld?.domains.includes(scope.domain)) {
    return platformErrors.withheldFromClient(scope.domain);
  }
  return platformErrors.permissionDenied(`${scope.domain}:${scope.level}`);
}

export const accountProcedure = authenticated.use(
  async ({ context, next, path, procedure }, input, output) => {
    const meta = procedure["~orpc"].meta;
    const { actor } = context;
    const { credential } = actor;
    if (meta.scope) {
      const refusal = accountRefusal(credential, meta.scope);
      // Withheld by the client's directory first: widening the connection would not help.
      if (refusal && credential.withheld?.domains.includes(meta.scope.domain)) {
        throw scopeRefusal(credential, meta.scope);
      }
      if (refusal === "bound" && credential.kind !== "session") {
        throw platformErrors.connectionBoundToStores(credential.kind);
      }
      if (refusal) throw scopeRefusal(credential, meta.scope);
    }
    if (credential.kind !== "session") {
      const limit = await consumeRateLimit(rateLimitKey(credential));
      if (!limit.allowed) throw platformErrors.rateLimited(limit.retryAfterSeconds);
    }
    if (meta.scope?.level !== "write") return next();

    return recordWrite({
      actor: { ...actor, storeId: ACCOUNT_SCOPE },
      path,
      meta,
      outputSchema: procedure["~orpc"].outputSchema,
      headers: context.headers,
      receipt: context.receipt,
      rawInput: input,
      dispatchEffects: context.ports?.dispatchEffects,
      run: () => next(),
      // The cast only drops the context a replay does not add.
      replay: (result) => output(result) as Awaited<ReturnType<typeof next>>,
    });
  },
);

/**
 * An action on one store. On every call, before the handler:
 *
 * 1. the credential is accepted by the transport and
 *    still valid; the procedure allows this kind of credential
 *    (`meta.actors`), and platform staff only (`meta.platformAdmin`);
 * 3. the store is resolved with the role the user holds there now;
 * 4. the role, cut down to the connection's scopes, allows `meta.scope`;
 * 5. for a key or a token: the store's plan includes API access, and the
 *    connection is within its rate limit.
 *
 * Writes (`scope.level === "write"`) then run through `runOperation`:
 * recorded, and replayed for a repeated idempotency key.
 */
export const storeProcedure = authenticated.use(
  async ({ context, next, path, procedure }, input, output) => {
    const meta = procedure["~orpc"].meta;
    const { actor } = context;
    const { credential } = actor;

    if (!meta.scope) {
      throw apiError("INTERNAL_SERVER_ERROR", "PROCEDURE_WITHOUT_SCOPE", {
        message: `Procedure ${path.join(".")} declares no scope.`,
      });
    }
    const storeActor: StoreActor = await resolveStoreActor(actor, {
      headers: context.headers,
      requestedStoreId: context.headers.get(STORE_HEADER) ?? undefined,
    });

    if (!allows(storeActor.role, credential.scopes, meta.scope)) {
      throw scopeRefusal(credential, meta.scope);
    }

    const { ports } = context;
    if (!ports) throw missingTransport();
    if (credential.kind !== "session") {
      const features = await ports.planFeatures(storeActor.storeId);
      if (!features.apiAccess) throw platformErrors.apiAccessNotInPlan();

      const limit = await consumeRateLimit(rateLimitKey(credential));
      if (!limit.allowed) throw platformErrors.rateLimited(limit.retryAfterSeconds);
    }

    const store = await db.query.stores.findFirst({ where: eq(stores.id, storeActor.storeId) });
    if (!store) throw platformErrors.noStore();

    const nextContext = { actor: storeActor, store: store as ActorStore, ports };
    if (meta.scope.level !== "write") return next({ context: nextContext });

    return recordWrite({
      actor: storeActor,
      path,
      meta,
      outputSchema: procedure["~orpc"].outputSchema,
      headers: context.headers,
      receipt: context.receipt,
      rawInput: input,
      dispatchEffects: ports.dispatchEffects,
      run: () => next({ context: nextContext }),
      // The cast only drops the context a replay does not add.
      replay: (result) =>
        output(meta.upgradeReplay ? meta.upgradeReplay(result, ports.urls) : result) as Awaited<
          ReturnType<typeof next<typeof nextContext>>
        >,
    });
  },
);
