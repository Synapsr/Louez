import { db, stores } from "@louez/db";
import { os } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { BaseContext } from "../context";
import {
  resolveAccountActor,
  resolveStoreActor,
  type AccountActor,
  type StoreActor,
} from "./actor";
import { apiError, platformErrors } from "./errors";
import type { ApiMeta } from "./meta";
import { IDEMPOTENCY_HEADER, runOperation } from "./operations";
import { allows } from "./permissions";
import { consumeRateLimit, rateLimitKey } from "./rate-limit";

/** Store row handed to agent-ready procedures. */
export type ActorStore = typeof stores.$inferSelect;

/** Header with which a caller picks a store when its connection covers several (OAuth, lot 1). */
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

function missingTransport() {
  return apiError("INTERNAL_SERVER_ERROR", "TRANSPORT_MISSING", {
    message: "The handler did not say which transport the call came through.",
  });
}

/**
 * A signed-in account, before any store: list one's stores, create a store.
 * The credential is checked on every call.
 */
export const accountProcedure = base.use(async ({ context, next, procedure }) => {
  if (!context.transport) throw missingTransport();
  const meta = procedure["~orpc"].meta;
  const actor: AccountActor = await resolveAccountActor({
    transport: context.transport,
    headers: context.headers,
  });
  if (meta.actors && !meta.actors.includes(actor.credential.kind))
    throw platformErrors.sessionOnly();
  if (meta.platformAdmin && !(actor.isPlatformAdmin && actor.credential.kind === "session")) {
    throw platformErrors.permissionDenied("platform_admin");
  }
  return next({ context: { actor } });
});

/**
 * An action on one store. On every call, before the handler:
 *
 * 1. (accountProcedure) the credential is accepted by the transport and
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
export const storeProcedure = accountProcedure.use(
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
      throw platformErrors.permissionDenied(`${meta.scope.domain}:${meta.scope.level}`);
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

    // The handler's output is what an idempotent retry gets back; `output()`
    // answers a replay without running the handler. The replayed output still
    // goes through the procedure's output schema, which runs outside this
    // middleware (see `base`); the cast only drops the context a replay does
    // not add.
    let ran: Awaited<ReturnType<typeof next<typeof nextContext>>> | undefined;
    const result = await runOperation(
      {
        actor: storeActor,
        procedure: path.join("."),
        input,
        idempotencyKey: meta.secretOutput ? null : context.headers.get(IDEMPOTENCY_HEADER),
        receipt: context.receipt,
        toStored: (raw) => validateOutput(procedure["~orpc"].outputSchema, raw),
      },
      async () => {
        ran = await next({ context: nextContext });
        return ran.output;
      },
    );
    return ran ?? (output(result) as typeof ran & object);
  },
);
