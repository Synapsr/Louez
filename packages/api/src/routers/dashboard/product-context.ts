import { checkConfirmation, type ConfirmationPreview } from "../../platform/confirmation";
import { platformErrors } from "../../platform/errors";
import { allows } from "../../platform/permissions";
import type { StoreActor } from "../../platform/actor";
import type { ActorStore } from "../../platform/procedures";
import type { ApiPorts } from "../../platform/ports";
import type { ProductActor } from "../../services/products";

/**
 * What the products procedures share: the actor their services take, and the
 * confirmation they ask under the write's lock.
 */

export interface ProductContext {
  actor: StoreActor;
  store: ActorStore;
  ports: ApiPorts;
  headers: Headers;
}

export function productActor(context: ProductContext): ProductActor {
  return {
    storeId: context.actor.storeId,
    userId: context.actor.credential.userId,
    transport: context.actor.transport,
    store: {
      id: context.store.id,
      name: context.store.name,
      slug: context.store.slug,
      ownerUserId: context.store.userId,
      settings: context.store.settings ?? null,
    },
    afterCommit: context.ports.afterCommit,
  };
}

/** Whether the caller may read a domain: the member's role, cut down to the connection's scopes. */
export function mayRead(context: ProductContext, domain: "reservations" | "customers") {
  return allows(context.actor.role, context.actor.credential.scopes, { domain, level: "read" });
}

/** Refuses an answer that shows reservations and their customers to a caller who may not read them. */
export function requireReservationsAndCustomers(context: ProductContext) {
  for (const domain of ["reservations", "customers"] as const) {
    if (!mayRead(context, domain)) throw platformErrors.permissionDenied(`${domain}:read`);
  }
}

/** A confirmation asked under the write's lock, bound to what the preview shows. */
export function confirmUnderLock<TPreview extends { summary: string }>(
  context: ProductContext,
  path: readonly string[],
  input: unknown,
  describe: (preview: TPreview) => { state: unknown; details: ConfirmationPreview["details"] },
) {
  return (preview: TPreview, tx: Parameters<typeof checkConfirmation>[0]["executor"]) => {
    const { state, details } = describe(preview);
    return checkConfirmation({
      executor: tx,
      actor: context.actor,
      headers: context.headers,
      procedure: path.join("."),
      input,
      state,
      preview: { summary: preview.summary, details },
    });
  };
}
