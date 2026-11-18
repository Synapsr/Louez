import {
  getVisibilityInput,
  getVisibilityOutput,
  setVisibilityStepInput,
  setVisibilityStepOutput,
} from "../../contracts/visibility";
import { storeProcedure } from "../../platform/procedures";
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

export const dashboardVisibilityRouter = {
  get,
  setStep,
};
