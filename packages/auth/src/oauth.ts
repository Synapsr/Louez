import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import {
  getOAuthProviderState,
  verifyOAuthQueryParams,
  type ClientMetadataResourceFetch,
} from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

/**
 * OAuth for MCP clients (Claude.ai, ChatGPT, Claude Code…): Louez is the
 * authorization server they sign in through, and `/api/mcp` the protected
 * resource. Better Auth's `mcp()` plugin is the OAuth 2.1 provider; `cimd()`
 * lets a client identify itself by the URL of its metadata document; dynamic
 * client registration stays open for clients that only know it.
 *
 * What a connection may do in Louez (stores, rights, confirmation, tool
 * bundles) is not an OAuth scope: it is the grant the user accepted on the
 * consent page (`api_agent_grants`), read again on every call.
 */

/** Where the authorization flow sends a visitor who is not signed in: the usual sign-in page. */
export const OAUTH_LOGIN_PAGE = "/login";
/** Where it sends a signed-in user to accept or refuse a client. */
export const OAUTH_CONSENT_PAGE = "/oauth/consent";

/**
 * Better Auth endpoints the app turns off (`disabledPaths`). The JWT plugin's
 * session token endpoint: a session JWT would be signed with the access
 * tokens' key. The OAuth provider's consent endpoints: Louez keeps what a user
 * granted an agent in its own grants (`api_agent_grants`), changed and revoked
 * from the dashboard only; deleting or rewriting a consent behind them would
 * leave the grant, its rights and its handoff links standing.
 */
export const AUTH_DISABLED_PATHS = [
  "/token",
  "/oauth2/get-consent",
  "/oauth2/get-consents",
  "/oauth2/update-consent",
  "/oauth2/delete-consent",
];

const AUTH_BASE_PATH = "/api/auth";
const MCP_PATH = "/api/mcp";

/** The URLs of the authorization server and of the MCP resource, all on the app's origin. */
export interface McpOAuthEndpoints {
  /** The token issuer: `<app>/api/auth`. */
  issuer: string;
  /** The MCP resource tokens are bound to (their audience): `<app>/api/mcp`. */
  resource: string;
  /** RFC 9728 metadata of the resource, announced on a 401. */
  resourceMetadataUrl: string;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The OAuth endpoints for the app at `authUrl`, or null when OAuth cannot be
 * served there: MCP requires HTTPS, plain HTTP only on a loopback host. A
 * self-hosted instance on plain HTTP keeps API keys and no OAuth.
 */
export function mcpOAuthEndpoints(authUrl: string | undefined): McpOAuthEndpoints | null {
  if (!authUrl) return null;
  let url: URL;
  try {
    url = new URL(authUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    return null;
  }
  return {
    issuer: `${url.origin}${AUTH_BASE_PATH}`,
    resource: `${url.origin}${MCP_PATH}`,
    resourceMetadataUrl: `${url.origin}/.well-known/oauth-protected-resource${MCP_PATH}`,
  };
}

/**
 * The Better Auth plugins of the authorization server. The issuer is fixed to
 * AUTH_URL's origin, even where the base URL follows the request host (the
 * development Localify hosts): a token names one issuer, and the resource
 * checks that one.
 */
/**
 * The access-token claim naming the grant (`api_agent_grants.id`) the token
 * was issued under. It is the lineage's `referenceId`: set when the
 * authorization starts, carried by the code, the refresh tokens and every
 * token refreshed from them, never re-read from the user's current grant. So
 * nothing issued under a revoked grant acts for a newer grant of the same
 * user and client.
 */
export const GRANT_CLAIM = "louez_grant";

const lineageRevoked = () =>
  new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: "This connection was revoked. Connect again.",
  });

/**
 * The `mcp()` plugin with its discovery documents (the protected resource
 * metadata, the authorization server metadata and the OpenID configuration,
 * all answered by its `onRequest`) cleared of `dpop_signing_alg_values_supported`.
 * Better Auth always lists it, but the MCP endpoint takes bearer tokens only
 * and refuses a DPoP-bound one (`createAccessTokenVerifier`): a client that
 * took the offer would get tokens `/api/mcp` cannot use. Every other answer
 * passes through as it was.
 */
function withoutDpopMetadata<Plugin extends Pick<BetterAuthPlugin, "onRequest">>(
  plugin: Plugin,
): Plugin {
  const serve = plugin.onRequest;
  if (!serve) return plugin;
  return {
    ...plugin,
    onRequest: async (request, ctx) => {
      const handled = await serve(request, ctx);
      if (!handled || !("response" in handled) || request.method !== "GET") return handled;
      const { response } = handled;
      const isJson = response.headers.get("content-type")?.startsWith("application/json");
      if (response.status !== 200 || !isJson) return handled;
      const metadata: unknown = await response.clone().json();
      if (typeof metadata !== "object" || metadata === null) return handled;
      const advertised = Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== "dpop_signing_alg_values_supported"),
      );
      return {
        response: new Response(JSON.stringify(advertised), {
          status: 200,
          headers: response.headers,
        }),
      };
    },
  };
}

export function mcpOAuthPlugins(
  endpoints: McpOAuthEndpoints,
  options: {
    /**
     * The grant the user has now for a client: where a new lineage starts,
     * at the authorization (the consent records it, the code carries it).
     * Null: no grant yet, the consent page is shown.
     */
    currentGrantId: (input: { userId: string; clientId: string }) => Promise<string | null>;
    /** Whether the grant a lineage started under still exists, for this user and client. */
    isGrantActive: (input: {
      grantId: string;
      userId: string;
      clientId: string;
    }) => Promise<boolean>;
    fetchClientMetadata?: ClientMetadataResourceFetch;
  },
) {
  const [signing, provider, discovery] = [
    // Signs the access tokens and serves the keys at /api/auth/jwks. The
    // session JWT it can also issue is turned off (`disabledPaths` in the
    // auth config): it shares the signing key with the access tokens.
    jwt({ disableSettingJwtHeader: true, jwt: { issuer: endpoints.issuer } }),
    mcp({
      loginPage: OAUTH_LOGIN_PAGE,
      consentPage: OAUTH_CONSENT_PAGE,
      resource: endpoints.resource,
      // Registration without an account, for clients that do not publish a
      // metadata document (ChatGPT, older clients). Restricted: such a client
      // gets the standard scopes and the MCP resource only, never the
      // client-credentials grant, the endpoint is rate limited, and the
      // consent page says its name is not verified.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      // No one manages OAuth clients or resources from a session: a signed-in
      // user could otherwise create clients or change the MCP resource's
      // token policy through Better Auth's admin endpoints.
      clientPrivileges: () => false,
      resourcePrivileges: () => false,
      // The grant is the reference of the consent, so of the whole lineage:
      // the provider stores it on the code and on each refresh token. It is
      // read once, when the authorization starts. Nothing is ever redirected
      // to a post-login page: the reference is all this is for.
      postLogin: {
        page: OAUTH_CONSENT_PAGE,
        shouldRedirect: () => false,
        consentReferenceId: async ({ user }) => {
          // The provider sets the authorization's query (with its client)
          // before asking, at /oauth2/authorize and at /oauth2/consent.
          const query = (await getOAuthProviderState())?.query;
          const clientId = query ? new URLSearchParams(query).get("client_id") : null;
          if (!clientId) return undefined;
          return (await options.currentGrantId({ userId: user.id, clientId })) ?? undefined;
        },
      },
      // Every access token names the grant of its lineage. A lineage whose
      // grant is gone (revoked) gets nothing: the code exchange or the
      // refresh fails with invalid_grant. For a JWT access token the claims
      // are made before the refresh token rotates, so a refused refresh
      // leaves its row as it was. The database adds the second half: every
      // token row's reference is a foreign key to its grant (cascade), so a
      // revoke deletes the lineage and a rotation that inserts after it fails.
      extensions: [
        {
          claims: {
            accessToken: async ({ user, client, referenceId }) => {
              if (!user || !referenceId) throw lineageRevoked();
              const active = await options.isGrantActive({
                grantId: referenceId,
                userId: user.id,
                clientId: client.clientId,
              });
              if (!active) throw lineageRevoked();
              return { [GRANT_CLAIM]: referenceId };
            },
          },
        },
      ],
    }),
    cimd({
      fetchClientMetadataResource: options.fetchClientMetadata ?? fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
  return [signing, withoutDpopMetadata(provider), discovery];
}

/** What a verified access token says. */
export interface VerifiedAccessToken {
  userId: string;
  clientId: string;
  /** The grant the token was issued under (`GRANT_CLAIM`). */
  grantId: string;
  expiresAt: Date;
}

const JWKS_CACHE_MS = 5 * 60 * 1000;
// The JWT plugin signs with EdDSA by default; any asymmetric key it may be
// configured with is accepted, never a symmetric one.
const ACCESS_TOKEN_ALGORITHMS = [
  "EdDSA",
  "ES256",
  "ES384",
  "ES512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
];

/**
 * A verifier of MCP access tokens: the signature against the provider's keys,
 * the issuer, the audience (the MCP resource), the expiry and the token type
 * (`at+jwt`, so an ID token or a session JWT is refused), and the grant it
 * names (`GRANT_CLAIM`). A sender-constrained (DPoP) token is refused: the
 * MCP endpoint takes bearer tokens only.
 *
 * Returns null for any token that fails: the caller fails closed. The keys are
 * cached five minutes, and read again once when a token names an unknown key.
 */
export function createAccessTokenVerifier(options: {
  issuer: string;
  audience: string;
  loadJwks: () => Promise<JSONWebKeySet>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let cached: { keys: JSONWebKeySet; at: number } | null = null;

  const keySet = async (fresh: boolean) => {
    if (fresh || !cached || now() - cached.at > JWKS_CACHE_MS) {
      cached = { keys: await options.loadJwks(), at: now() };
    }
    return cached.keys;
  };

  const verifyWith = async (token: string, keys: JSONWebKeySet) => {
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: options.issuer,
      audience: options.audience,
      typ: "at+jwt",
      algorithms: ACCESS_TOKEN_ALGORITHMS,
      requiredClaims: ["sub", "azp", "exp", "iat", GRANT_CLAIM],
      currentDate: new Date(now()),
    });
    return payload;
  };

  return async function verifyAccessToken(token: string): Promise<VerifiedAccessToken | null> {
    if (token.split(".").length !== 3) return null;
    let payload;
    try {
      try {
        payload = await verifyWith(token, await keySet(false));
      } catch (error) {
        // A rotated key the cache does not know yet.
        if ((error as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
        payload = await verifyWith(token, await keySet(true));
      }
    } catch {
      return null;
    }
    if (payload.cnf !== undefined) return null;
    if (typeof payload.sub !== "string" || typeof payload.azp !== "string") return null;
    if (payload.client_id !== undefined && payload.client_id !== payload.azp) return null;
    const grantId = payload[GRANT_CLAIM];
    if (typeof grantId !== "string" || grantId.length === 0) return null;
    return {
      userId: payload.sub,
      clientId: payload.azp,
      grantId,
      expiresAt: new Date((payload.exp as number) * 1000),
    };
  };
}

/** The part of a Better Auth instance with the OAuth provider that the consent needs. */
interface ConsentApi {
  api: {
    oauth2Consent: (context: {
      body: { accept: boolean; oauth_query: string };
      headers: Headers;
      request: Request;
    }) => Promise<unknown>;
  };
}

/**
 * Answers the consent of a pending authorization for the signed-in user of
 * `headers` (their session cookie): Better Auth records the consent and gives
 * back where to send the browser, the client's redirect URI with a code, or
 * with `access_denied`. `oauthQuery` is the signed query of the consent page.
 */
export async function answerOAuthConsent(
  auth: ConsentApi,
  endpoints: McpOAuthEndpoints,
  input: { oauthQuery: string; accept: boolean; headers: Headers },
): Promise<string> {
  const result = await auth.api.oauth2Consent({
    body: { accept: input.accept, oauth_query: input.oauthQuery },
    headers: input.headers,
    // The provider resumes the authorization from the request it is handed.
    request: new Request(`${endpoints.issuer}/oauth2/consent`, {
      method: "POST",
      headers: input.headers,
    }),
  });
  // Handed a request, Better Auth answers with a Response.
  const body = (result instanceof Response ? await result.json() : result) as { url?: unknown };
  if (typeof body.url !== "string" || body.url.length === 0) {
    throw new Error("The OAuth provider did not say where to send the browser.");
  }
  return body.url;
}

/** A pending authorization, as the consent page reads it from its signed query. */
export interface OAuthConsentRequest {
  clientId: string;
  /** Where the code goes, as the client asked and the provider checked and signed. */
  redirectUri: string | null;
  scopes: string[];
}

/**
 * Reads the signed query the provider sends the consent page with. Null when
 * the signature does not match or the query expired (ten minutes): the page
 * then shows nothing about any client.
 */
export async function readOAuthConsentQuery(
  oauthQuery: string,
  secret: string,
): Promise<OAuthConsentRequest | null> {
  if (!oauthQuery || !(await verifyOAuthQueryParams(oauthQuery, secret))) return null;
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  if (!clientId) return null;
  return {
    clientId,
    redirectUri: params.get("redirect_uri"),
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
  };
}
