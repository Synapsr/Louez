import type { SettingsActor } from "../../services/settings";
import type { ProductContext } from "./product-context";

/** The actor the settings and online store services take, from a procedure's context. */
export const settingsActor = (context: ProductContext): SettingsActor => ({
  storeId: context.actor.storeId,
  store: {
    id: context.store.id,
    name: context.store.name,
    slug: context.store.slug,
    ownerUserId: context.store.userId,
  },
  afterCommit: context.ports.afterCommit,
});
