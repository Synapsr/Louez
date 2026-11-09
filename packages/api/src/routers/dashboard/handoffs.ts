import {
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

/** What every procedure that starts a handoff says of the link it returns. */
export const HANDOFF_HELP = `It returns a link (url) for the user: a Louez page where they sign in, then continue to the provider and come back; only they can finish this step. The link works for ${HANDOFF_TTL_HOURS} hours, only for the user this connection acts for, and calling the tool again replaces it. handoff.id is what handoffs_get takes to follow the step: pending, opened, completed, expired or failed.`;

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
      description: `Where a step handed to the user stands: pending (the link is waiting), opened (the user is on the provider's page), completed, expired (the link ran out; the tool that started it makes a new one) or failed (with why). Takes the handoff's id, as the tool that started it returned it. Once completed, the result is where the step leads (payments_sync_stripe_status, billing_get_status). Never returns the link again. Needs read access to the step's domain: settings for Stripe, billing for the billing card.`,
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
