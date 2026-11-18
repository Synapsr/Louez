import {
  aiVisibilityErrors,
  getAiTrafficInput,
  getAiTrafficOutput,
  getAiVisibilityInput,
  getAiVisibilityOutput,
} from "../../contracts/ai-visibility";
import {
  getVisibilityInput,
  getVisibilityOutput,
  setVisibilityStepInput,
  setVisibilityStepOutput,
} from "../../contracts/visibility";
import { storeProcedure } from "../../platform/procedures";
import { getAiTraffic as readAiTraffic, getAiVisibility } from "../../services/ai-visibility";
import { getVisibility, setVisibilityStep } from "../../services/visibility";

/**
 * The "Se faire connaître" guide (services/visibility.ts): a guide of the
 * dashboard's interface for a person in a session, never a key, an OAuth or
 * MCP connection or the in-app assistant (`actors`), and not exposed.
 */
const visibility = storeProcedure.meta({
  actors: ["session"],
  mcp: { exclude: "dashboard guide, human session only" },
});

const get = visibility
  .meta({
    capability: "online_store.getVisibility",
    scope: { domain: "online_store", level: "read" },
  })
  .input(getVisibilityInput)
  .output(getVisibilityOutput)
  .handler(({ context }) => getVisibility(context.actor.storeId));

const setStep = visibility
  .meta({
    capability: "online_store.setVisibilityStep",
    scope: { domain: "online_store", level: "write" },
  })
  .input(setVisibilityStepInput)
  .output(setVisibilityStepOutput)
  .handler(({ context, input }) =>
    setVisibilityStep({
      storeId: context.actor.storeId,
      userId: context.actor.credential.userId,
      step: input.step,
      status: input.status,
    }),
  );

/** A store without « Être trouvé par les IA » (`ports.aiVisibility`) is refused. */
async function assertAiVisibilityIncluded(context: {
  actor: { storeId: string };
  ports: { aiVisibility?: (storeId: string) => Promise<boolean> };
}): Promise<void> {
  const included = (await context.ports.aiVisibility?.(context.actor.storeId)) ?? false;
  if (!included) throw aiVisibilityErrors.notIncluded();
}

/**
 * « Être trouvé par les IA »: what the store's data lacks for an assistant to
 * describe it, the visits assistants sent and their crawlers' reads. Only
 * for a store that gets the feature (`ports.aiVisibility`).
 */
const getAi = visibility
  .meta({
    capability: "online_store.getAiVisibility",
    scope: { domain: "online_store", level: "read" },
  })
  .input(getAiVisibilityInput)
  .output(getAiVisibilityOutput)
  .handler(async ({ context }) => {
    await assertAiVisibilityIncluded(context);
    return getAiVisibility(context.actor.storeId);
  });

/**
 * The AI sources view of Analyses: visits from assistants and the
 * reservations made during them, over an analytics period. Same entitlement.
 */
const getAiTraffic = visibility
  .meta({
    capability: "online_store.getAiTraffic",
    scope: { domain: "online_store", level: "read" },
  })
  .input(getAiTrafficInput)
  .output(getAiTrafficOutput)
  .handler(async ({ context, input }) => {
    await assertAiVisibilityIncluded(context);
    return readAiTraffic(context.actor.storeId, input.period);
  });

export const dashboardVisibilityRouter = {
  get,
  getAi,
  getAiTraffic,
  setStep,
};
