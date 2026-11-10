import {
  HANDOFF_TTL_HOURS,
  getHandoffInput,
  getHandoffOutput,
  refreshHandoffInput,
  refreshHandoffOutput,
  type HandoffKind,
  type HandoffLink,
} from "../../contracts/handoffs";
import { platformErrors } from "../../platform/errors";
import { allows } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import {
  HANDOFF_CHECK_LEASE_SECONDS,
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
 * services/handoffs.ts. Reading a handoff changes nothing: a step completes
 * on the provider's return, on its webhook (Stripe Connect), or when the
 * caller asks the provider again (`handoffs_refresh`, for a billing card
 * Stripe had not confirmed on the return).
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
    // Opened by any domain a kind belongs to; the handler checks the step's own.
    scope: { domain: "settings", level: "read", anyOf: ["billing", "team"] },
    mcp: {
      name: "handoffs_get",
      title: "Get Handoff Status",
      description: `Where a step handed to the user stands: pending (the link is waiting), opened (the user is on the provider's page), completed, expired (the link ran out; the tool that started it makes a new one) or failed (with why). Takes the handoff's id, as the tool that started it returned it. It only reads: \`confirming\` is true while the user is back and the provider has not confirmed the step yet, which handoffs_refresh asks again. Once completed, the result is where the step leads (payments_sync_stripe_status, billing_get_status). Never returns the link again. Needs read access to the step's domain: settings for Stripe, billing for the billing card, team for a team invitation's approval.`,
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
    return handoffView(row, { now: new Date(), urls: context.ports.urls, store: context.store });
  });

/** Settling a step saves what the user did there: the right to change its domain. */
const REFRESH_SCOPE = {
  domain: "billing",
  level: "write",
  role: "manage_settings",
  anyOf: ["settings"],
} as const;

const refresh = storeProcedure
  .meta({
    capability: "handoffs.refresh",
    scope: REFRESH_SCOPE,
    mcp: {
      name: "handoffs_refresh",
      title: "Refresh Handoff Status",
      description: `Ask the provider again where a step handed to the user stands, and record it. It matters for a billing card the user came back from while Stripe had not confirmed it (\`confirming: true\`): once Stripe confirms, the billing service saves the card, replacing the one on file, and the step completes. At most one check per ${HANDOFF_CHECK_LEASE_SECONDS.min} seconds to ${HANDOFF_CHECK_LEASE_SECONDS.max / 60} minutes, longer after each; within that time, and for any other step, it answers as handoffs_get does. Takes the handoff's id. Needs write access to the step's domain: billing for the billing card, settings for Stripe.`,
      bundle: "daily",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({ method: "POST", path: "/handoffs/{id}/refresh" })
  .input(refreshHandoffInput)
  .output(refreshHandoffOutput)
  .handler(async ({ context, input }) => {
    let row = await getHandoffRow(context.actor.storeId, input.id);
    const domain = HANDOFF_KIND_DOMAINS[row.kind];
    const { role, credential } = context.actor;
    if (!allows(role, credential.scopes, { ...REFRESH_SCOPE, domain, anyOf: [] })) {
      throw platformErrors.permissionDenied(`${domain}:write`);
    }
    row = await settlePendingCardSetup(row, context.ports);
    return handoffView(row, { now: new Date(), urls: context.ports.urls, store: context.store });
  });

export const dashboardHandoffsRouter = { get, refresh };
