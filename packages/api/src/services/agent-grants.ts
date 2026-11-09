import {
  apiAgentGrantStores,
  apiAgentGrants,
  apiOperations,
  db,
  oauthClients,
  storeMembers,
  stores,
  users,
} from "@louez/db";
import { clientIconOrigin } from "@louez/auth/oauth-client-icon";
import { and, asc, desc, eq, inArray, isNotNull, isNull, max, or } from "drizzle-orm";

import {
  agentClientIconUrl,
  agentConnectionErrors,
  type AgentClient,
  type AgentConnection,
} from "../contracts/agent-connections";
import { CHATGPT_CLIENT_ID, clientWithholding } from "../platform/agent-clients";
import { bundlesWithTools, createExposure } from "../platform/exposure";
import { MCP_BUNDLES, type McpBundle } from "../platform/meta";
import { failCredentialHandoffs } from "./handoffs";
import type { AgentPreset } from "../platform/permissions";

/**
 * Agent connections (OAuth grants): what a user granted an OAuth client on
 * the consent page. A grant is one row per user and client; the calls of that
 * client read it again every time (`loadActiveGrant`), so a change applies on
 * the next call and a revoked grant refuses it.
 */

type GrantStores = { all: true } | { all: false; ids: string[] };

export interface GrantTerms {
  stores: GrantStores;
  preset: AgentPreset;
  confirmSensitive: boolean;
  bundles: McpBundle[];
}

/** A grant as a call reads it: who, for which client, on what terms. */
export interface ActiveGrant {
  id: string;
  userId: string;
  email: string | null;
  clientId: string;
  /** The client's name, for the audit trail. */
  clientName: string;
  preset: AgentPreset;
  confirmSensitive: boolean;
  bundles: McpBundle[];
  /** Null: every store of the user. */
  stores: string[] | null;
}

const knownBundles = (raw: unknown): McpBundle[] =>
  Array.isArray(raw) ? MCP_BUNDLES.filter((bundle) => raw.includes(bundle)) : [];

let appToolBundles: Promise<readonly McpBundle[]> | undefined;

/**
 * The bundles the consent page and the connection editor offer `client`:
 * those that hold a tool today (`bundlesWithTools`, read once from the app's
 * exposure; the router is loaded on first use, as it imports this module),
 * without those its directory forbids it (`clientWithholding`).
 */
export async function offeredBundles(client: {
  clientId: string;
  name: string | null;
}): Promise<McpBundle[]> {
  appToolBundles ??= import("../router").then(({ appRouter }) =>
    bundlesWithTools(createExposure(appRouter).procedures),
  );
  const withheld = clientWithholding(client).bundles;
  return (await appToolBundles).filter((bundle) => !withheld.includes(bundle));
}

/** A grant's bundles, without those offered nowhere: they come back once they hold a tool. */
const shownBundles = (bundles: readonly McpBundle[], offered: readonly McpBundle[]) =>
  bundles.filter((bundle) => offered.includes(bundle));

/** The grant of `userId` for `clientId`, when it exists and the client is still allowed. */
export async function loadActiveGrant(input: {
  userId: string;
  clientId: string;
}): Promise<ActiveGrant | null> {
  const [row] = await db
    .select({
      id: apiAgentGrants.id,
      userId: apiAgentGrants.userId,
      email: users.email,
      clientId: apiAgentGrants.clientId,
      clientName: oauthClients.name,
      clientDisabled: oauthClients.disabled,
      allStores: apiAgentGrants.allStores,
      preset: apiAgentGrants.preset,
      confirmSensitive: apiAgentGrants.confirmSensitive,
      bundles: apiAgentGrants.bundles,
    })
    .from(apiAgentGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, apiAgentGrants.clientId))
    .innerJoin(users, eq(users.id, apiAgentGrants.userId))
    .where(
      and(eq(apiAgentGrants.userId, input.userId), eq(apiAgentGrants.clientId, input.clientId)),
    )
    .limit(1);
  if (!row || row.clientDisabled) return null;

  const storeIds = row.allStores
    ? null
    : (
        await db
          .select({ storeId: apiAgentGrantStores.storeId })
          .from(apiAgentGrantStores)
          .where(eq(apiAgentGrantStores.grantId, row.id))
      ).map((entry) => entry.storeId);

  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    clientId: row.clientId,
    // The audit column holds 100 characters.
    clientName: (row.clientName ?? row.clientId).slice(0, 100),
    preset: row.preset,
    confirmSensitive: row.confirmSensitive,
    bundles: knownBundles(row.bundles),
    stores: storeIds,
  };
}

/**
 * Whether an agent can act on the store now: a grant of one of its members,
 * through a client still allowed, that covers it (all of the member's stores,
 * or this one by name). The dashboard home stops offering to connect one then.
 */
export async function storeHasAgentConnection(storeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: apiAgentGrants.id })
    .from(apiAgentGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, apiAgentGrants.clientId))
    .innerJoin(
      storeMembers,
      and(eq(storeMembers.userId, apiAgentGrants.userId), eq(storeMembers.storeId, storeId)),
    )
    .leftJoin(
      apiAgentGrantStores,
      and(
        eq(apiAgentGrantStores.grantId, apiAgentGrants.id),
        eq(apiAgentGrantStores.storeId, storeId),
      ),
    )
    .where(
      and(
        or(isNull(oauthClients.disabled), eq(oauthClients.disabled, false)),
        or(eq(apiAgentGrants.allStores, true), isNotNull(apiAgentGrantStores.storeId)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Client ids shown as "Vérifié": the exact metadata document URLs of clients
 * Louez knows, each documented by its publisher. A metadata document proves
 * only who serves it, not that the name in it is true, so a CIMD client is
 * not verified for being one; these are, because their host is the client's
 * publisher and the code goes only to a redirect their document lists, on
 * that host. Anthropic documents Claude's two (public, and `private_key_jwt`)
 * at https://claude.com/docs/connectors/building/authentication; OpenAI
 * documents ChatGPT's at https://developers.openai.com/plugins/build/auth (the
 * stable id it uses with a server that returns `iss`, as Louez does).
 *
 * Claude Code's document (https://claude.ai/oauth/claude-code-client-metadata)
 * is left out on purpose: it redirects to a loopback address, which any local
 * program can claim, so its name is no more certain than the consent page's
 * loopback warning says.
 */
const VERIFIED_CLIENT_IDS: ReadonlySet<string> = new Set([
  "https://claude.ai/oauth/mcp-oauth-client-metadata",
  "https://claude.ai/oauth/mcp-oauth-client-metadata/confidential_client",
  CHATGPT_CLIENT_ID,
]);

function hostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host || null;
  } catch {
    return null;
  }
}

function isLoopback(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const { hostname } = new URL(uri);
    return (
      hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

const clientColumns = {
  clientId: oauthClients.clientId,
  name: oauthClients.name,
  clientDiscoveryId: oauthClients.clientDiscoveryId,
  disabled: oauthClients.disabled,
};

function toAgentClient(
  row: {
    clientId: string;
    name: string | null;
    clientDiscoveryId: string | null;
    disabled: boolean | null;
  },
  redirectUri: string | null,
): AgentClient {
  // A client from a metadata document has its URL as its id: that URL's host
  // served what the client declares, and its website icon stands for it.
  const fromDocument = row.clientDiscoveryId !== null;
  const declaredBy = fromDocument ? hostOf(row.clientId) : null;
  const hasIcon = fromDocument && !row.disabled && clientIconOrigin(row.clientId) !== null;
  return {
    clientId: row.clientId,
    name: row.name,
    declaredBy,
    verified: VERIFIED_CLIENT_IDS.has(row.clientId),
    iconUrl: hasIcon ? agentClientIconUrl(row.clientId) : null,
    redirectHost: hostOf(redirectUri),
    loopbackRedirect: isLoopback(redirectUri),
  };
}

/**
 * The OAuth client of a pending authorization, as the consent page shows it,
 * with the redirect URI of that request (signed by the authorization server,
 * checked against the client's registered ones).
 */
export async function describeClient(
  clientId: string,
  redirectUri: string | null,
): Promise<AgentClient> {
  const [row] = await db
    .select(clientColumns)
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!row || row.disabled) throw agentConnectionErrors.clientNotFound(clientId);
  return toAgentClient(row, redirectUri);
}

/** The terms already granted to a client, for the consent page to start from. */
export async function currentTerms(input: {
  userId: string;
  clientId: string;
}): Promise<GrantTerms | null> {
  const grant = await loadActiveGrant(input);
  if (!grant) return null;
  const offered = await offeredBundles({ clientId: grant.clientId, name: grant.clientName });
  return {
    stores: grant.stores ? { all: false, ids: grant.stores } : { all: true },
    preset: grant.preset,
    confirmSensitive: grant.confirmSensitive,
    bundles: shownBundles(grant.bundles, offered),
  };
}

/** Refuses stores the user is not a member of. */
async function assertMemberOf(userId: string, storeIds: string[]): Promise<void> {
  const unique = [...new Set(storeIds)];
  const rows = await db
    .select({ storeId: storeMembers.storeId })
    .from(storeMembers)
    .where(and(eq(storeMembers.userId, userId), inArray(storeMembers.storeId, unique)));
  const member = new Set(rows.map((row) => row.storeId));
  const foreign = unique.filter((id) => !member.has(id));
  if (foreign.length > 0) throw agentConnectionErrors.storeNotFound(foreign);
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function replaceStores(tx: Transaction, grantId: string, terms: GrantStores) {
  await tx.delete(apiAgentGrantStores).where(eq(apiAgentGrantStores.grantId, grantId));
  if (!terms.all) {
    await tx
      .insert(apiAgentGrantStores)
      .values([...new Set(terms.ids)].map((storeId) => ({ grantId, storeId })));
  }
}

/**
 * Records what the user accepted for a client: a new grant, or the new terms
 * of the existing one (a client that asks again, with `prompt=consent`).
 */
export async function saveGrant(input: {
  userId: string;
  clientId: string;
  terms: GrantTerms;
}): Promise<{ id: string }> {
  const { terms } = input;
  if (!terms.stores.all) await assertMemberOf(input.userId, terms.stores.ids);
  await describeClient(input.clientId, null);

  return db.transaction(async (tx) => {
    await tx
      .insert(apiAgentGrants)
      .values({
        userId: input.userId,
        clientId: input.clientId,
        allStores: terms.stores.all,
        preset: terms.preset,
        confirmSensitive: terms.confirmSensitive,
        bundles: terms.bundles,
      })
      .onDuplicateKeyUpdate({
        set: {
          allStores: terms.stores.all,
          preset: terms.preset,
          confirmSensitive: terms.confirmSensitive,
          bundles: terms.bundles,
        },
      });
    const [grant] = await tx
      .select({ id: apiAgentGrants.id })
      .from(apiAgentGrants)
      .where(
        and(eq(apiAgentGrants.userId, input.userId), eq(apiAgentGrants.clientId, input.clientId)),
      )
      .for("update")
      .limit(1);
    if (!grant) throw new Error("The agent grant was not saved.");
    await replaceStores(tx, grant.id, terms.stores);
    return { id: grant.id };
  });
}

async function ownGrant(tx: Transaction, userId: string, id: string) {
  const [grant] = await tx
    .select({ id: apiAgentGrants.id, clientId: apiAgentGrants.clientId })
    .from(apiAgentGrants)
    .where(and(eq(apiAgentGrants.id, id), eq(apiAgentGrants.userId, userId)))
    .for("update")
    .limit(1);
  if (!grant) throw agentConnectionErrors.notFound(id);
  return grant;
}

/** Changes some terms of one of the user's grants; an absent field is left as is. */
export async function updateGrant(input: {
  userId: string;
  id: string;
  patch: Partial<GrantTerms>;
}): Promise<AgentConnection> {
  const { patch } = input;
  if (patch.stores && !patch.stores.all) await assertMemberOf(input.userId, patch.stores.ids);

  await db.transaction(async (tx) => {
    await ownGrant(tx, input.userId, input.id);
    const set = {
      ...(patch.stores ? { allStores: patch.stores.all } : {}),
      ...(patch.preset ? { preset: patch.preset } : {}),
      ...(patch.confirmSensitive !== undefined ? { confirmSensitive: patch.confirmSensitive } : {}),
      ...(patch.bundles ? { bundles: patch.bundles } : {}),
    };
    if (Object.keys(set).length > 0) {
      await tx.update(apiAgentGrants).set(set).where(eq(apiAgentGrants.id, input.id));
    }
    if (patch.stores) await replaceStores(tx, input.id, patch.stores);
  });

  const [connection] = await listGrants(input.userId, input.id);
  if (!connection) throw agentConnectionErrors.notFound(input.id);
  return connection;
}

/**
 * Revokes one of the user's grants by deleting it. The database does the
 * rest, in the same statement: Better Auth's consent and every refresh and
 * access token of the grant's lineage reference it (`reference_id`, cascade),
 * so they go with it, and the next authorization asks again. A refresh that
 * races the revoke cannot re-create a token for the gone grant (the foreign
 * key refuses the insert), and a replay of one of its old refresh tokens finds
 * nothing, so the provider never tears down the tokens of a newer grant of the
 * same user and client.
 */
export async function revokeGrant(input: { userId: string; id: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const grant = await ownGrant(tx, input.userId, input.id);
    await tx.delete(apiAgentGrants).where(eq(apiAgentGrants.id, grant.id));
  });
  // The links it handed to the user stop working.
  await failCredentialHandoffs({ kind: "oauth", id: input.id });
}

/** The user's grants, newest first, with their stores and their last action. */
export async function listGrants(userId: string, onlyId?: string): Promise<AgentConnection[]> {
  const rows = await db
    .select({
      id: apiAgentGrants.id,
      allStores: apiAgentGrants.allStores,
      preset: apiAgentGrants.preset,
      confirmSensitive: apiAgentGrants.confirmSensitive,
      bundles: apiAgentGrants.bundles,
      createdAt: apiAgentGrants.createdAt,
      ...clientColumns,
    })
    .from(apiAgentGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, apiAgentGrants.clientId))
    .where(
      onlyId
        ? and(eq(apiAgentGrants.userId, userId), eq(apiAgentGrants.id, onlyId))
        : eq(apiAgentGrants.userId, userId),
    )
    .orderBy(desc(apiAgentGrants.createdAt), asc(apiAgentGrants.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [storeRows, lastActions] = await Promise.all([
    db
      .select({
        grantId: apiAgentGrantStores.grantId,
        id: stores.id,
        name: stores.name,
      })
      .from(apiAgentGrantStores)
      .innerJoin(stores, eq(stores.id, apiAgentGrantStores.storeId))
      .where(inArray(apiAgentGrantStores.grantId, ids))
      .orderBy(asc(stores.name), asc(stores.id)),
    db
      .select({ grantId: apiOperations.credentialId, at: max(apiOperations.createdAt) })
      .from(apiOperations)
      .where(
        and(eq(apiOperations.credentialKind, "oauth"), inArray(apiOperations.credentialId, ids)),
      )
      .groupBy(apiOperations.credentialId),
  ]);
  const lastAction = new Map(lastActions.map((row) => [row.grantId, row.at]));

  const offered = await Promise.all(
    rows.map((row) => offeredBundles({ clientId: row.clientId, name: row.name })),
  );

  return rows.map((row, index) => ({
    id: row.id,
    client: toAgentClient(row, null),
    stores: row.allStores
      ? { all: true as const }
      : {
          all: false as const,
          items: storeRows
            .filter((store) => store.grantId === row.id)
            .map(({ id, name }) => ({ id, name })),
        },
    preset: row.preset,
    confirmSensitive: row.confirmSensitive,
    bundles: shownBundles(knownBundles(row.bundles), offered[index]),
    offeredBundles: offered[index],
    lastActionAt: lastAction.get(row.id) ?? null,
    createdAt: row.createdAt,
  }));
}
