import {
  aiVisibilityErrors,
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
import { getAiVisibility } from "../../services/ai-visibility";
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
    const storeId = context.actor.storeId;
    const included = (await context.ports.aiVisibility?.(storeId)) ?? false;
    if (!included) throw aiVisibilityErrors.notIncluded();
    return getAiVisibility(storeId);
  });

export const dashboardVisibilityRouter = {
  get,
  getAi,
  setStep,
};
