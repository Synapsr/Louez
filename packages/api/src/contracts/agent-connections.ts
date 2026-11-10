import { z } from "zod";

import { apiError } from "../platform/errors";
import { MCP_BUNDLES } from "../platform/meta";
import { AGENT_PRESETS } from "../platform/permissions";

/**
 * Agent connections: what a user granted an OAuth client (Claude, ChatGPT…)
 * on the consent page, and the "Agents connectés" screen that lists, changes
 * and revokes them. Every procedure here is for a dashboard session only: an
 * agent never changes its own rights. No database here.
 */

const idSchema = z.string().min(1).max(64);

export const agentPresetSchema = z.enum(AGENT_PRESETS);
export const agentBundleSchema = z.enum(MCP_BUNDLES);
const bundlesSchema = z
  .array(agentBundleSchema)
  .min(1)
  .max(MCP_BUNDLES.length)
  .transform((bundles) => [...new Set(bundles)]);

/** The stores a connection covers: all of the user's (now and later), or a list. */
export const agentStoresSchema = z.discriminatedUnion("all", [
  z.object({ all: z.literal(true) }),
  z.object({ all: z.literal(false), ids: z.array(idSchema).min(1).max(200) }),
]);

/**
 * The OAuth client as the consent page and the list show it. Its name is only
 * what the client declared: the page says who declared it, and where the
 * browser goes back to, rather than vouching for the name.
 */
export const agentClientSchema = z.object({
  clientId: z.string(),
  /** As the client declared it, in its metadata document or its registration. */
  name: z.string().nullable(),
  /**
   * The host of the metadata document (CIMD) that declared the client, which
   * Louez fetched from that host. Null for a client that registered itself
   * (dynamic registration), whose metadata nobody vouches for.
   */
  declaredBy: z.string().nullable(),
  /** True only for a client id on Louez's own list of known clients. */
  verified: z.boolean(),
  /**
   * Where the app serves the website icon of the host in `declaredBy`
   * (`agentClientIconUrl`), fetched by Louez. Null for a client that
   * registered itself: the logo it declares is never shown.
   */
  iconUrl: z.string().nullable(),
  /**
   * Host the browser goes back to with the code: the redirect URI of this
   * authorization request, as the authorization server signed it. Null in
   * the list, which has no request.
   */
  redirectHost: z.string().nullable(),
  /** The redirect is a loopback address: any program on that computer may receive the code. */
  loopbackRedirect: z.boolean(),
});
export type AgentClient = z.infer<typeof agentClientSchema>;

/** The app route that serves a client's icon, from Louez's origin. */
export const AGENT_CLIENT_ICON_PATH = "/api/agent-connections/client-icon";
export const agentClientIconUrl = (clientId: string): string =>
  `${AGENT_CLIENT_ICON_PATH}?client_id=${encodeURIComponent(clientId)}`;

export const agentConnectionSchema = z.object({
  id: z.string(),
  client: agentClientSchema,
  stores: z.discriminatedUnion("all", [
    z.object({ all: z.literal(true) }),
    z.object({
      all: z.literal(false),
      items: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ]),
  preset: agentPresetSchema,
  confirmSensitive: z.boolean(),
  /** The bundles granted, among those offered. */
  bundles: z.array(agentBundleSchema),
  /** The bundles the editor offers: those that hold a tool today. */
  offeredBundles: z.array(agentBundleSchema),
  /** The last write the connection made, from the operations journal. */
  lastActionAt: z.date().nullable(),
  createdAt: z.date(),
});
export type AgentConnection = z.infer<typeof agentConnectionSchema>;

const memberStoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["owner", "member"]),
});

export const listAgentConnectionsOutput = z.object({
  items: z.array(agentConnectionSchema),
  /** The user's stores, to pick from when changing a connection's stores. */
  stores: z.array(memberStoreSchema),
});

/** What the consent page shows about a pending authorization. */
export const getAuthorizationInput = z.object({ oauthQuery: z.string().min(1).max(8192) });
export const getAuthorizationOutput = z.object({
  client: agentClientSchema,
  stores: z.array(memberStoreSchema),
  /** The tool bundles the page offers: those that hold a tool today. */
  offeredBundles: z.array(agentBundleSchema),
  /**
   * Whether the client may create a store (`stores_create`): false for a
   * client whose directory withholds the `stores` domain (`clientWithholding`),
   * so the page asks a user with no store to create it in Louez first.
   */
  canCreateStores: z.boolean(),
  /** The connection already granted to this client, to start from its terms. */
  current: z
    .object({
      stores: agentStoresSchema,
      preset: agentPresetSchema,
      confirmSensitive: z.boolean(),
      bundles: z.array(agentBundleSchema),
    })
    .nullable(),
});

export const authorizeInput = z.discriminatedUnion("accept", [
  z.object({ oauthQuery: z.string().min(1).max(8192), accept: z.literal(false) }),
  z.object({
    oauthQuery: z.string().min(1).max(8192),
    accept: z.literal(true),
    stores: agentStoresSchema,
    preset: agentPresetSchema,
    confirmSensitive: z.boolean(),
    bundles: bundlesSchema,
  }),
]);
export const authorizeOutput = z.object({
  /** Where to send the browser: back to the client, with a code or `access_denied`. */
  redirectUrl: z.string(),
});

export const updateAgentConnectionInput = z.object({
  id: idSchema,
  stores: agentStoresSchema.optional(),
  preset: agentPresetSchema.optional(),
  confirmSensitive: z.boolean().optional(),
  bundles: bundlesSchema.optional(),
});

export const revokeAgentConnectionInput = z.object({ id: idSchema });
export const revokeAgentConnectionOutput = z.object({ id: z.string(), revoked: z.literal(true) });

export const agentConnectionErrors = {
  notFound: (id: string) =>
    apiError("NOT_FOUND", "AGENT_CONNECTION_NOT_FOUND", {
      message: `You have no agent connection ${id}.`,
      i18nKey: "errors.agentConnectionNotFound",
      details: { id },
    }),
  storeNotFound: (ids: string[]) =>
    apiError("BAD_REQUEST", "AGENT_CONNECTION_STORE_INVALID", {
      message: "A connection can only cover stores you are a member of.",
      i18nKey: "errors.invalidData",
      details: { ids },
    }),
  requestInvalid: () =>
    apiError("BAD_REQUEST", "OAUTH_REQUEST_INVALID", {
      message:
        "This authorization request is invalid or expired. Start the connection again from the agent.",
      i18nKey: "errors.oauthRequestInvalid",
    }),
  clientNotFound: (clientId: string) =>
    apiError("NOT_FOUND", "OAUTH_CLIENT_NOT_FOUND", {
      message: "This agent is unknown or no longer allowed to connect.",
      i18nKey: "errors.oauthRequestInvalid",
      details: { clientId },
    }),
} as const;
