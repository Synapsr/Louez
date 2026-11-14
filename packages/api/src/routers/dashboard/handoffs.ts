import {
  HANDOFF_TTL_HOURS,
  decideHandoffInput,
  decideHandoffOutput,
  getHandoffInput,
  getHandoffOutput,
  handoffErrors,
  refreshHandoffInput,
  refreshHandoffOutput,
  type HandoffLink,
  type StepKind,
} from "../../contracts/handoffs";
import type { StoreActor } from "../../platform/actor";
import { platformErrors } from "../../platform/errors";
import { API_DOMAINS, allows } from "../../platform/permissions";
import { accountProcedure, missingTransport, storeProcedure } from "../../platform/procedures";
import { decideHandoff } from "../../services/handoff-decisions";
import {
  HANDOFF_CHECK_LEASE_SECONDS,
  getHandoffRow,
  handoffDomain,
  handoffView,
  issueHandoff,
  settlePendingCardSetup,
  upgradeStoredView,
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
export const HANDOFF_HELP = `It returns a link (url) for the user: a Louez page where they sign in, then continue to the provider and come back; only they can finish this step. The link works for ${HANDOFF_TTL_HOURS} hours, only for the user this connection acts for; a new call gives the same link ${HANDOFF_TTL_HOURS} more hours. handoff.id is what handoffs_get takes to follow the step: pending, opened, completed, expired or failed.`;

/** Every domain but the one a scope names: a read of any of them opens `handoffs_get`. */
const OTHER_DOMAINS = API_DOMAINS.filter((domain) => domain !== "settings");

/**
 * The store's step, for a caller who reads its domain. A step of a domain the
 * caller does not read answers as an id no step has: an id says nothing to
 * who may not read the step. An operation's approval is read by the
 * connection that asked for it, and by nobody else on any transport, its
 * domain's readers included: it holds the request's input and preview, which
 * are that connection's (its approver reads it on its page, signed in).
 */
async function readableHandoff(context: Pick<ProductContext, "actor">, id: string) {
  const row = await getHandoffRow(context.actor.storeId, id);
  const { credential } = context.actor;
  if (
    row.kind === "operation_approval" &&
    (row.credentialKind !== credential.kind || row.credentialId !== credential.id)
  ) {
    throw handoffErrors.notFound(id);
  }
  const domain = handoffDomain(row);
  if (!domain || !mayRead(context, domain)) throw handoffErrors.notFound(id);
  return { row, domain };
}

/** Starts or resumes a handoff for the caller, bound to their user and connection. */
export function startHandoff(context: ProductContext, kind: StepKind): Promise<HandoffLink> {
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
    // Opened by any domain's read; the handler reads only a step of a domain the caller reads (`readableHandoff`).
    scope: { domain: "settings", level: "read", anyOf: OTHER_DOMAINS },
    mcp: {
      name: "handoffs_get",
      title: "Get Handoff Status",
      description: `Where a step handed to the user stands: pending (the link is waiting), opened (the user is on the provider's page), completed, expired (the link ran out; calling the tool that started it again opens the same link for another day) or failed (with why). Takes the handoff's id, as the tool that started it returned it. It only reads: \`confirming\` is true while the user is back and the provider has not confirmed the step yet, which handoffs_refresh asks again. Once completed, the result is where the step leads (payments_sync_stripe_status, billing_get_status). \`url\` is the step's link, the same the tool that started it returned, for the user to open signed in to Louez. For a team invitation's approval, \`decision\` says what the user decided (approved or refused), when, and their own words if they gave any (\`reason\`, plain text); null until they answer. An approved invitation that could not go out stays approved there, and \`failure\` says why. Needs read access to the step's domain: settings for Stripe, billing for the billing card, team for a team invitation's approval; without it, the id answers as not found.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/handoffs/{id}" })
  .input(getHandoffInput)
  .output(getHandoffOutput)
  .handler(async ({ context, input }) => {
    const { row } = await readableHandoff(context, input.id);
    return handoffView(row, { now: new Date(), urls: context.ports.urls, store: context.store });
  });

/** Settling a step saves what the user did there: the right to change its domain. */
const REFRESH_SCOPE = {
  domain: "billing",
  level: "write",
  role: "manage_settings",
  anyOf: ["settings"],
} as const;

/**
 * The step a caller may settle: one they read, of a domain they may change.
 * The handler's check, and the one a stored answer is replayed behind.
 */
async function refreshableHandoff(actor: StoreActor, id: string) {
  const { row, domain } = await readableHandoff({ actor }, id);
  if (!allows(actor.role, actor.credential.scopes, { ...REFRESH_SCOPE, domain, anyOf: [] })) {
    throw platformErrors.permissionDenied(`${domain}:write`);
  }
  return row;
}

/** The id of the step a stored refresh answer is about. */
function storedHandoffId(stored: unknown): string {
  const id = stored && typeof stored === "object" && "id" in stored ? stored.id : null;
  return typeof id === "string" ? id : "";
}

const refresh = storeProcedure
  .meta({
    capability: "handoffs.refresh",
    scope: REFRESH_SCOPE,
    authorizeReplay: async (stored, actor) => {
      await refreshableHandoff(actor, storedHandoffId(stored));
    },
    // Its answers stored before views carried `url` or `decision` replay with them.
    upgradeReplay: upgradeStoredView,
    mcp: {
      name: "handoffs_refresh",
      title: "Refresh Handoff Status",
      description: `Ask the provider again where a step handed to the user stands, and record it. It matters for a billing card the user came back from while Stripe had not confirmed it (\`confirming: true\`): once Stripe confirms, the billing service saves the card, replacing the one on file, and the step completes. Louez asks the provider at most once in ${HANDOFF_CHECK_LEASE_SECONDS.min} seconds, a wait that grows after each check up to ${HANDOFF_CHECK_LEASE_SECONDS.max / 60} minutes; during that wait, and for any other step, it answers as handoffs_get does without asking. Takes the handoff's id. Needs write access to the step's domain: billing for the billing card, settings for Stripe.`,
      bundle: "daily",
      effect: "overwrite",
      reach: "provider",
    },
  })
  .route({ method: "POST", path: "/handoffs/{id}/refresh" })
  .input(refreshHandoffInput)
  .output(refreshHandoffOutput)
  .handler(async ({ context, input }) => {
    const row = await settlePendingCardSetup(
      await refreshableHandoff(context.actor, input.id),
      context.ports,
    );
    return handoffView(row, { now: new Date(), urls: context.ports.urls, store: context.store });
  });

/**
 * A person's answer on a step's page (`/handoffs/<id>`), signed in: a
 * session only, so no agent decides for a person on any transport. Whose
 * step it is comes first, then whether they may still decide it, then its
 * kind's own decision (services/handoff-decisions.ts). A team invitation
 * approved runs as the dashboard's invitation, as the owner.
 */
const decide = accountProcedure
  .meta({
    capability: "handoffs.decide",
    // The only kind decided on its page today is a team invitation's approval.
    scope: { domain: "team", level: "write" },
    actors: ["session"],
    // A page opened from a link given before links were addressed by id posts its secret: nothing is replayed.
    secretOutput: true,
    mcp: { exclude: "a person decides on the step's page, signed in to Louez" },
  })
  .input(decideHandoffInput)
  .output(decideHandoffOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    const { effectIds, ...result } = await decideHandoff(
      { ...input, userId: context.actor.credential.userId },
      ports,
    );
    ports.dispatchEffects(effectIds);
    return result;
  });

export const dashboardHandoffsRouter = { get, refresh, decide };
