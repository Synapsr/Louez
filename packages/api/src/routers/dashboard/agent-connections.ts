import {
  agentConnectionErrors,
  authorizeInput,
  authorizeOutput,
  getAuthorizationInput,
  getAuthorizationOutput,
  listAgentConnectionsOutput,
  revokeAgentConnectionInput,
  revokeAgentConnectionOutput,
  updateAgentConnectionInput,
  agentConnectionSchema,
} from "../../contracts/agent-connections";
import { connectionStores, type AccountActor } from "../../platform/actor";
import { accountProcedure } from "../../platform/procedures";
import {
  currentTerms,
  describeClient,
  listGrants,
  offeredBundles,
  revokeGrant,
  saveGrant,
  updateGrant,
} from "../../services/agent-grants";

/** Better Auth's side of the consent. Tests replace the module. */
async function oauthServer() {
  const { answerConsent, readConsentRequest } = await import("@louez/auth");
  return { answerConsent, readConsentRequest };
}

// A connection's rights, its stores, its confirmation setting and its tool
// bundles are set by the signed-in user only: an agent never changes what it
// may do. They belong to the account, not to a store: a user with no store
// yet can connect an agent that will create it. The writes are recorded on
// the account scope.
const connections = accountProcedure.meta({
  account: true,
  scope: { domain: "integrations", level: "write" },
  actors: ["session"],
  mcp: { exclude: "agent connections are granted and managed by the user in the dashboard only" },
});

/** The stores the signed-in user is a member of: what a connection may cover. */
async function memberStores(actor: AccountActor) {
  const stores = await connectionStores(actor);
  return stores.map(({ id, name, role }) => ({
    id,
    name,
    role: role === "owner" ? ("owner" as const) : ("member" as const),
  }));
}

/** The pending authorization behind a signed query: its client and its redirect URI. */
async function pendingRequest(oauthQuery: string) {
  const request = await (await oauthServer()).readConsentRequest(oauthQuery);
  if (!request) throw agentConnectionErrors.requestInvalid();
  return request;
}

/** What the consent page shows: who asks, the user's stores, the bundles it offers, and the terms granted before. */
const getAuthorization = connections
  .meta({
    capability: "account.authorizeAgentConnection",
    scope: { domain: "integrations", level: "read" },
  })
  .input(getAuthorizationInput)
  .output(getAuthorizationOutput)
  .handler(async ({ context, input }) => {
    const { clientId, redirectUri } = await pendingRequest(input.oauthQuery);
    const { userId } = context.actor.credential;
    const [client, stores, current] = await Promise.all([
      describeClient(clientId, redirectUri),
      memberStores(context.actor),
      currentTerms({ userId, clientId }),
    ]);
    return { client, stores, current, offeredBundles: await offeredBundles(client) };
  });

/**
 * Accepts or refuses a pending authorization. Accepting records the grant
 * first, then lets Better Auth issue the code: the client's first call finds
 * its terms. The answer is where to send the browser; it holds the code, so
 * it is never stored for a replay.
 */
const authorize = connections
  .meta({ capability: "account.authorizeAgentConnection", secretOutput: true })
  .input(authorizeInput)
  .output(authorizeOutput)
  .handler(async ({ context, input }) => {
    const { clientId } = await pendingRequest(input.oauthQuery);
    if (input.accept) {
      await saveGrant({
        userId: context.actor.credential.userId,
        clientId,
        terms: {
          stores: input.stores,
          preset: input.preset,
          confirmSensitive: input.confirmSensitive,
          bundles: input.bundles,
        },
      });
    }
    const { answerConsent } = await oauthServer();
    const redirectUrl = await answerConsent({
      oauthQuery: input.oauthQuery,
      accept: input.accept,
      headers: context.headers,
    });
    return { redirectUrl };
  });

const list = connections
  .meta({
    capability: "account.listAgentConnections",
    scope: { domain: "integrations", level: "read" },
  })
  .output(listAgentConnectionsOutput)
  .handler(async ({ context }) => {
    const [items, stores] = await Promise.all([
      listGrants(context.actor.credential.userId),
      memberStores(context.actor),
    ]);
    return { items, stores };
  });

const update = connections
  .meta({ capability: "account.updateAgentConnection" })
  .input(updateAgentConnectionInput)
  .output(agentConnectionSchema)
  .handler(async ({ context, input }) => {
    const { id, ...patch } = input;
    return updateGrant({ userId: context.actor.credential.userId, id, patch });
  });

const revoke = connections
  .meta({ capability: "account.revokeAgentConnection" })
  .input(revokeAgentConnectionInput)
  .output(revokeAgentConnectionOutput)
  .handler(async ({ context, input }) => {
    await revokeGrant({ userId: context.actor.credential.userId, id: input.id });
    return { id: input.id, revoked: true as const };
  });

export const dashboardAgentConnectionsRouter = {
  getAuthorization,
  authorize,
  list,
  update,
  revoke,
};
