import type { ApiEffectPayloads } from "@louez/api/platform/effects";
import type { SetupActor, StoreSetupSummary } from "@louez/api/platform/setup-analytics";

// The PostHog properties of a store's setup analytics (packages/api
// platform/setup-analytics.ts): who made a write, an agent's setup action,
// and who set the store up, on its go-live. Every value is a fixed name, an
// enum, a count or a yes/no: never what a person typed.

type Properties = Record<string, string | number | boolean | string[] | null>;

/** Who made the write: the credential's kind, and for an agent which one. */
export function setupActorProperties(actor: SetupActor): Properties {
  return {
    credential_kind: actor.credentialKind,
    ...(actor.agentClient ? { agent_client: actor.agentClient } : {}),
  };
}

/** Who set the store up, at its go-live. */
export function setupSummaryProperties(setup: StoreSetupSummary): Properties {
  return {
    setup_by: setup.setupBy,
    store_created_by: setup.createdBy,
    agent_action_count: setup.agentActionCount,
    human_action_count: setup.humanActionCount,
    agent_clients: setup.agentClients,
    seconds_to_launch: setup.secondsSinceCreation,
  };
}

/** `agent_store_setup_action`: one setup write of an agent, what it filled. */
export function agentSetupActionProperties(
  payload: ApiEffectPayloads["store.agentSetupAction"],
): Properties {
  return {
    feature: "store_setup",
    surface: payload.transport,
    actor: "agent",
    store_id: payload.storeId,
    procedure: payload.procedure,
    transport: payload.transport,
    ...setupActorProperties({
      credentialKind: payload.credentialKind,
      agentClient: payload.agentClient,
    }),
    confirmation_accepted: payload.confirmed,
    fields_set: payload.fieldsSet,
    fields_set_count: payload.fieldsSet.length,
    fields_cleared: payload.fieldsCleared,
    ...payload.facts,
  };
}
