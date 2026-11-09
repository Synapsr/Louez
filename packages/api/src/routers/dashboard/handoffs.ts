import {
  HANDOFF_POLL_SECONDS,
  HANDOFF_TTL_HOURS,
  getHandoffInput,
  getHandoffOutput,
  type HandoffKind,
  type HandoffLink,
} from "../../contracts/handoffs";
import { platformErrors } from "../../platform/errors";
import { storeProcedure } from "../../platform/procedures";
import {
  HANDOFF_KIND_DOMAINS,
  getHandoffRow,
  handoffView,
  issueHandoff,
  settlePendingCardSetup,
} from "../../services/handoffs";
import { mayRead, type ProductContext } from "./product-context";

/**
 * Handoffs, on every transport: `handoffs_get` on MCP, `/api/v1/handoffs/{id}`
 * on OpenAPI. Each kind is started by its own domain's procedure
 * (`payments_start_stripe_onboarding`, `payments_open_stripe_dashboard`,
 * `billing_start_card_setup`), with that domain's rights; the logic is in
 * services/handoffs.ts.
 */

/** What every procedure that starts a handoff tells the agent to do with the link. */
export const HANDOFF_HELP = `It returns a link (url) to give the user as is: a Louez page where they sign in, then continue to the provider and come back. Only the user can finish this step; never open the link yourself. The link works for ${HANDOFF_TTL_HOURS} hours and only for the user this connection acts for. Do not ask the user to tell you when they are done: call handoffs_get with handoff.id every ${HANDOFF_POLL_SECONDS.min} seconds to ${HANDOFF_POLL_SECONDS.max / 60} minutes while you wait, or watch inbox_list, until its status is completed (or expired or failed: then call this tool again for a new link to the same step; calling it again replaces the link the user has).`;

/** Starts or resumes a handoff for the caller, bound to their user and connection. */
export function startHandoff(context: ProductContext, kind: HandoffKind): Promise<HandoffLink> {
  const { actor, ports } = context;
  return issueHandoff(
    {
      storeId: actor.storeId,
      userId: actor.credential.userId,
      credentialKind: actor.credential.kind,
      credentialId: actor.credential.id,
      clientName: actor.credential.clientName,
    },
    kind,
    { urls: ports.urls },
  );
}

const get = storeProcedure
  .meta({
    capability: "handoffs.get",
    scope: { domain: "settings", level: "read", anyOf: ["billing"] },
    mcp: {
      name: "handoffs_get",
      title: "Get Handoff Status",
      description: `Where a step handed to the user stands: pending (the link is waiting), opened (the user is on the provider's page), completed, expired (the link ran out: ask the tool that started it for a new one) or failed (with why). Pass the handoff's id, as the tool that started it returned it. Poll it every ${HANDOFF_POLL_SECONDS.min} seconds to ${HANDOFF_POLL_SECONDS.max / 60} minutes while the user is on it, instead of asking them; once completed, read the result where it lands (payments_sync_stripe_status, billing_get_status). Never returns the link again. Needs read access to the step's domain: settings for Stripe, billing for the billing card.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/handoffs/{id}" })
  .input(getHandoffInput)
  .output(getHandoffOutput)
  .handler(async ({ context, input }) => {
    let row = await getHandoffRow(context.actor.storeId, input.id);
    const domain = HANDOFF_KIND_DOMAINS[row.kind];
    if (!mayRead(context, domain)) throw platformErrors.permissionDenied(`${domain}:read`);
    row = await settlePendingCardSetup(row, context.ports);
    return handoffView(row, { now: new Date(), urls: context.ports.urls, store: context.store });
  });

export const dashboardHandoffsRouter = { get };
