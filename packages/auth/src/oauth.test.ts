import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getAuthTables } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { SignJWT, decodeJwt, exportJWK, generateKeyPair } from "jose";

import {
  AUTH_DISABLED_PATHS,
  GRANT_CLAIM,
  OAUTH_CONSENT_PAGE,
  answerOAuthConsent,
  readOAuthConsentQuery,
  OAUTH_LOGIN_PAGE,
  createAccessTokenVerifier,
  mcpOAuthEndpoints,
  mcpOAuthPlugins,
} from "./oauth";
import { createPasskeyOptions } from "./passkey";
import { authTables } from "./tables";

// The OAuth flow an MCP client runs against Louez, on a real Better Auth
// instance with the app's plugins and an in-memory database: registration,
// sign-in redirect, consent, code exchange, then the access token checked as
// the MCP endpoint checks it. Nothing leaves the process.

const ORIGIN = "https://app.example.com";
const endpoints = mcpOAuthEndpoints(ORIGIN)!;
const REDIRECT_URI = "https://client.example.org/callback";
const CIMD_CLIENT_ID = "https://agent.example.org/oauth/client.json";
const SECRET = "oauth-test-secret-never-used-in-production-1234567890";

// The metadata documents Claude, Claude Code and ChatGPT publish, as served
// on 2026-11-09, with test keys behind their `jwks_uri`, and Cursor's, as
// served on 2026-11-10: Cursor, its Bot and Grok (grok.com, Grok Bot) share it.
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CONFIDENTIAL = `${CLAUDE}/confidential_client`;
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const CHATGPT = "https://chatgpt.com/oauth/client.json";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
const CURSOR = "https://cursor.com/oauth/mcp-client.json";
const CURSOR_REDIRECTS = [
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "https://www.cursor.com/bot/mcp/oauth/callback",
  "https://grok.com/connectors-oauth-exchange-code/",
  "http://localhost:8787/callback",
  "http://127.0.0.1:8787/callback",
];
const claudeKeys = await generateKeyPair("ES256");
const chatGptKeys = await generateKeyPair("RS256");
const CLIENT_DOCUMENTS: Record<string, object> = {
  [CIMD_CLIENT_ID]: {
    client_id: CIMD_CLIENT_ID,
    client_name: "Agent from a document",
    client_uri: "https://agent.example.org",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  },
  [CLAUDE]: {
    client_id: CLAUDE,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CLAUDE_CALLBACK],
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  [CLAUDE_CONFIDENTIAL]: {
    client_id: CLAUDE_CONFIDENTIAL,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CLAUDE_CALLBACK],
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    jwks_uri: "https://claude.ai/v1/mcp/jwks",
  },
  [CLAUDE_CODE]: {
    client_id: CLAUDE_CODE,
    client_name: "Claude Code",
    client_uri: "https://claude.ai",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  [CHATGPT]: {
    client_id: CHATGPT,
    client_uri: "https://chatgpt.com/",
    redirect_uris: [CHATGPT_CALLBACK],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "ChatGPT",
    logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
    token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: "https://chatgpt.com/oauth/jwks.json",
  },
  [CURSOR]: {
    client_id: CURSOR,
    client_name: "Cursor",
    client_uri: "https://cursor.com",
    logo_uri:
      "https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/uploads/cursorlogomcpv3.svg",
    redirect_uris: CURSOR_REDIRECTS,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  "https://claude.ai/v1/mcp/jwks": {
    keys: [{ ...(await exportJWK(claudeKeys.publicKey)), kid: "claude", alg: "ES256" }],
  },
  "https://chatgpt.com/oauth/jwks.json": {
    keys: [{ ...(await exportJWK(chatGptKeys.publicKey)), kid: "chatgpt", alg: "RS256" }],
  },
};

const fixture = async (options: { grantId?: string | null } = {}) => {
  const grantId = options.grantId === undefined ? "grant_test_0000000001" : options.grantId;
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const model of Object.keys(authTables)) data[model] = [];
  const auth = betterAuth({
    baseURL: ORIGIN,
    basePath: "/api/auth",
    secret: SECRET,
    trustedOrigins: [ORIGIN],
    database: memoryAdapter(data),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: mcpOAuthPlugins(endpoints, {
      // The grant Louez saved before the consent: the lineage's reference.
      currentGrantId: async () => grantId,
      isGrantActive: async ({ grantId: id }) => id === grantId,
      // Client metadata documents and their keys, served without the network.
      fetchClientMetadata: async (input) => {
        const document = CLIENT_DOCUMENTS[new Request(input).url];
        if (!document) return new Response(null, { status: 404 });
        return Response.json(document, { headers: { "cache-control": "max-age=60" } });
      },
    }),
  });

  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const request = async (
    path: string,
    init: RequestInit & { form?: object; anonymous?: boolean } = {},
  ) => {
    const headers = new Headers(init.headers);
    headers.set("origin", ORIGIN);
    if (jar.size && !init.anonymous) headers.set("cookie", cookie());
    let body = init.body;
    if (init.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(init.form as Record<string, string>).toString();
    } else if (body) {
      headers.set("content-type", "application/json");
    }
    const response = await auth.handler(
      new Request(`${ORIGIN}${path}`, { ...init, headers, body, redirect: "manual" }),
    );
    for (const setCookie of response.headers.getSetCookie()) {
      const [nameValue] = setCookie.split(";");
      const separator = nameValue.indexOf("=");
      jar.set(nameValue.slice(0, separator), nameValue.slice(separator + 1));
    }
    return response;
  };

  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.com", password: "Test-only-1234!", name: "O" }),
  });
  assert.equal(signUp.status, 200, await signUp.text());

  const verify = createAccessTokenVerifier({
    issuer: endpoints.issuer,
    audience: endpoints.resource,
    loadJwks: () => auth.api.getJwks(),
  });
  return { auth, data, jar, cookie, request, verify };
};

type Fixture = Awaited<ReturnType<typeof fixture>>;

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

const register = async ({ request }: Fixture) => {
  const response = await request("/api/auth/oauth2/register", {
    method: "POST",
    anonymous: true,
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return ((await response.json()) as { client_id: string }).client_id;
};

const authorize = (fx: Fixture, clientId: string, challenge: string) =>
  fx.request(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "openid offline_access",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: endpoints.resource,
    })}`,
  );

/** Runs the flow to the code, the consent accepted through the server API (as the app does). */
const codeFor = async (fx: Fixture, clientId: string) => {
  const { verifier, challenge } = pkce();
  const redirect = await authorize(fx, clientId, challenge);
  assert.equal(redirect.status, 302);
  const location = new URL(redirect.headers.get("location")!, ORIGIN);
  assert.equal(location.pathname, OAUTH_CONSENT_PAGE);

  const url = await answerOAuthConsent(fx.auth, endpoints, {
    oauthQuery: location.search.slice(1),
    accept: true,
    headers: new Headers({ cookie: fx.cookie() }),
  });
  const back = new URL(url);
  assert.equal(`${back.origin}${back.pathname}`, REDIRECT_URI);
  assert.equal(back.searchParams.get("state"), "state-1");
  return { code: back.searchParams.get("code")!, verifier };
};

const exchange = async (fx: Fixture, clientId: string, code: string, verifier: string) => {
  const response = await fx.request("/api/auth/oauth2/token", {
    method: "POST",
    anonymous: true,
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: endpoints.resource,
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
};

test("OAuth is served on HTTPS, or plain HTTP on a loopback host only", () => {
  assert.deepEqual(mcpOAuthEndpoints("https://app.louez.io/"), {
    issuer: "https://app.louez.io/api/auth",
    resource: "https://app.louez.io/api/mcp",
    resourceMetadataUrl: "https://app.louez.io/.well-known/oauth-protected-resource/api/mcp",
  });
  assert.equal(
    mcpOAuthEndpoints("http://localhost:3000")?.resource,
    "http://localhost:3000/api/mcp",
  );
  assert.equal(mcpOAuthEndpoints("http://192.168.1.20:3000"), null);
  assert.equal(mcpOAuthEndpoints(undefined), null);
});

test("every column Better Auth writes exists, and no required column is left to it unset", () => {
  const expected = getAuthTables({
    rateLimit: { storage: "database" },
    plugins: [
      passkey(createPasskeyOptions(ORIGIN)),
      ...mcpOAuthPlugins(endpoints, {
        currentGrantId: async () => null,
        isGrantActive: async () => false,
      }),
    ],
  });
  for (const [model, table] of Object.entries(expected)) {
    const drizzle = authTables[model as keyof typeof authTables];
    assert.ok(drizzle, `no Drizzle table for Better Auth's ${model}`);
    const columns = getTableColumns(drizzle) as Record<
      string,
      { notNull: boolean; hasDefault: boolean }
    >;
    for (const [key, field] of Object.entries(table.fields)) {
      assert.ok(columns[field.fieldName ?? key], `${model}.${key} has no column`);
    }
    for (const [key, column] of Object.entries(columns)) {
      if (key === "id" || !column.notNull || column.hasDefault) continue;
      const field = table.fields[key];
      // Louez's own columns on `users` (none of them required) are not Better Auth's.
      if (!field) continue;
      assert.notEqual(
        field.required,
        false,
        `${model}.${key} is NOT NULL, Better Auth may omit it`,
      );
    }
  }
});

test("a client registers, the user consents, and the token is bound to the MCP resource", async () => {
  const fx = await fixture();
  const clientId = await register(fx);

  // Signed out: the flow goes through the usual sign-in page with a signed query.
  const signedOut = await fx.auth.handler(
    new Request(
      `${ORIGIN}/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    ),
  );
  const login = new URL(signedOut.headers.get("location")!, ORIGIN);
  assert.equal(login.pathname, OAUTH_LOGIN_PAGE);
  assert.ok(login.searchParams.get("sig"));

  const { code, verifier } = await codeFor(fx, clientId);
  const tokens = await exchange(fx, clientId, code, verifier);
  assert.ok(tokens.refresh_token, "offline_access gives a refresh token");

  const verified = await fx.verify(tokens.access_token);
  assert.ok(verified);
  assert.equal(verified.clientId, clientId);
  assert.equal(verified.userId, (fx.data.user[0] as { id: string }).id);
  assert.equal(verified.grantId, "grant_test_0000000001", "the token names its grant");

  // The same key, another audience or another issuer: refused.
  const keys = () => fx.auth.api.getJwks();
  const otherAudience = createAccessTokenVerifier({
    issuer: endpoints.issuer,
    audience: "https://app.example.com/api/v1",
    loadJwks: keys,
  });
  assert.equal(await otherAudience(tokens.access_token), null);
  const otherIssuer = createAccessTokenVerifier({
    issuer: "https://evil.example.com/api/auth",
    audience: endpoints.resource,
    loadJwks: keys,
  });
  assert.equal(await otherIssuer(tokens.access_token), null);

  // Expired: two hours later.
  const later = createAccessTokenVerifier({
    issuer: endpoints.issuer,
    audience: endpoints.resource,
    loadJwks: keys,
    now: () => Date.now() + 2 * 60 * 60 * 1000,
  });
  assert.equal(await later(tokens.access_token), null);

  // An ID token is signed with the same key but is not an access token.
  if (tokens.id_token) assert.equal(await fx.verify(tokens.id_token), null);
  // Tampered or garbage.
  assert.equal(await fx.verify(`${tokens.access_token.slice(0, -4)}AAAA`), null);
  assert.equal(await fx.verify("lz_not_a_jwt"), null);
});

test("a token signed by another key is refused, even with the right claims", async () => {
  const fx = await fixture();
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const forged = await new SignJWT({
    azp: "client",
    client_id: "client",
    scope: "openid",
    [GRANT_CLAIM]: "grant",
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: "forged" })
    .setIssuer(endpoints.issuer)
    .setAudience(endpoints.resource)
    .setSubject("user")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  assert.equal(await fx.verify(forged), null);

  // The same token is accepted by a verifier that trusts that key: the claims were right.
  const trusting = createAccessTokenVerifier({
    issuer: endpoints.issuer,
    audience: endpoints.resource,
    loadJwks: async () => ({ keys: [{ ...(await exportJWK(publicKey)), kid: "forged" }] }),
  });
  assert.equal((await trusting(forged))?.clientId, "client");

  // A DPoP-bound token is refused: the MCP endpoint takes bearer tokens only.
  const bound = await new SignJWT({
    azp: "client",
    [GRANT_CLAIM]: "grant",
    cnf: { jkt: "thumbprint" },
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: "forged" })
    .setIssuer(endpoints.issuer)
    .setAudience(endpoints.resource)
    .setSubject("user")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  assert.equal(await trusting(bound), null);
});

test("a client identified by its metadata document (CIMD) reaches the consent page", async () => {
  const fx = await fixture();
  const redirect = await authorize(fx, CIMD_CLIENT_ID, pkce().challenge);
  assert.equal(redirect.status, 302, await redirect.clone().text());
  assert.equal(new URL(redirect.headers.get("location")!, ORIGIN).pathname, OAUTH_CONSENT_PAGE);
  const client = fx.data.oauthClient.find((row) => row.clientId === CIMD_CLIENT_ID);
  assert.equal(client?.name, "Agent from a document");
  assert.ok(client?.clientDiscoveryId, "marked as discovered from a document");
});

test("the session JWT and the client admin endpoints are closed", async () => {
  const fx = await fixture();
  assert.equal((await fx.request("/api/auth/token")).status, 404);
  const create = await fx.request("/api/auth/oauth2/create-client", {
    method: "POST",
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: "Mine" }),
  });
  assert.equal(create.status, 401);
  // Registration with a session cookie needs client privileges: refused too.
  const registerSigned = await fx.request("/api/auth/oauth2/register", {
    method: "POST",
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
  });
  assert.equal(registerSigned.status, 401);
});

test("the consent page trusts only its signed query; refusing sends the client access_denied", async () => {
  const fx = await fixture();
  const clientId = await register(fx);
  const redirect = await authorize(fx, clientId, pkce().challenge);
  const query = new URL(redirect.headers.get("location")!, ORIGIN).search.slice(1);

  assert.deepEqual(await readOAuthConsentQuery(query, SECRET), {
    clientId,
    redirectUri: REDIRECT_URI,
    scopes: ["openid", "offline_access"],
  });
  const tampered = query.replace(`client_id=${clientId}`, "client_id=someone-else");
  assert.equal(await readOAuthConsentQuery(tampered, SECRET), null);
  assert.equal(await readOAuthConsentQuery(query, "another-secret-of-enough-length-123456"), null);

  const url = new URL(
    await answerOAuthConsent(fx.auth, endpoints, {
      oauthQuery: query,
      accept: false,
      headers: new Headers({ cookie: fx.cookie() }),
    }),
  );
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("code"), null);
});

test("an authorization that started without a grant gets no token", async () => {
  const fx = await fixture({ grantId: null });
  const clientId = await register(fx);
  const { code, verifier } = await codeFor(fx, clientId);
  const refused = await fx.request("/api/auth/oauth2/token", {
    method: "POST",
    anonymous: true,
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: endpoints.resource,
    },
  });
  assert.equal(refused.status, 400);
  assert.equal(((await refused.json()) as { error?: string }).error, "invalid_grant");
});

// --- What Claude, Claude Code, ChatGPT, Cursor and Grok need --------------------

/** Starts an authorization for any client and redirect; PKCE when a challenge is given. */
const startAuthorization = (
  fx: Fixture,
  params: { clientId: string; redirectUri: string; challenge?: string } & Record<string, string>,
) => {
  const { clientId, redirectUri, challenge, ...extra } = params;
  return fx.request(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      state: "state-1",
      ...(challenge === undefined
        ? {}
        : { code_challenge: challenge, code_challenge_method: "S256" }),
      resource: endpoints.resource,
      ...extra,
    })}`,
  );
};

/** Where the provider sent the browser, when it went back to the client. */
const clientRedirect = (response: Response, redirectUri: string) => {
  assert.equal(response.status, 302, `expected a redirect, got ${response.status}`);
  const location = new URL(response.headers.get("location")!, ORIGIN);
  assert.equal(`${location.origin}${location.pathname}`, redirectUri);
  return location;
};

/** The consent accepted (or refused) as the app does, then the client's redirect. */
const consent = async (fx: Fixture, authorization: Response, accept = true) => {
  const location = new URL(authorization.headers.get("location")!, ORIGIN);
  assert.equal(location.pathname, OAUTH_CONSENT_PAGE, "reaches the consent page");
  return new URL(
    await answerOAuthConsent(fx.auth, endpoints, {
      oauthQuery: location.search.slice(1),
      accept,
      headers: new Headers({ cookie: fx.cookie() }),
    }),
  );
};

/** A `private_key_jwt` client assertion, as Claude's and ChatGPT's confidential clients sign it. */
const clientAssertion = (clientId: string, key: CryptoKey, alg: string, kid: string) =>
  new SignJWT({ jti: randomBytes(16).toString("hex") })
    .setProtectedHeader({ alg, kid, typ: "JWT" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(`${endpoints.issuer}/oauth2/token`)
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(key);

const CONFIDENTIAL_KEYS: Record<string, () => Promise<string>> = {
  [CLAUDE_CONFIDENTIAL]: () =>
    clientAssertion(CLAUDE_CONFIDENTIAL, claudeKeys.privateKey, "ES256", "claude"),
  [CHATGPT]: () => clientAssertion(CHATGPT, chatGptKeys.privateKey, "RS256", "chatgpt"),
};

/** A form-encoded token request, authenticated as the client's document says. */
const tokenRequest = async (fx: Fixture, clientId: string, form: Record<string, string>) => {
  const sign = CONFIDENTIAL_KEYS[clientId];
  return fx.request("/api/auth/oauth2/token", {
    method: "POST",
    anonymous: true,
    form: {
      client_id: clientId,
      ...(sign
        ? {
            client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            client_assertion: await sign(),
          }
        : {}),
      ...form,
    },
  });
};

type Tokens = { access_token: string; refresh_token?: string; token_type: string };

/** A redirect without its query: a custom scheme (`cursor://…`) has no origin to compare. */
const withoutQuery = (url: URL) => url.href.slice(0, url.href.length - url.search.length);

/** The whole flow for a client from its published document: consent, code, token. */
const connectClient = async (fx: Fixture, clientId: string, redirectUri: string) => {
  const { verifier, challenge } = pkce();
  const back = await consent(
    fx,
    await startAuthorization(fx, { clientId, redirectUri, challenge }),
  );
  assert.equal(withoutQuery(back), redirectUri);
  assert.equal(
    back.searchParams.get("iss"),
    endpoints.issuer,
    "RFC 9207: the code names its issuer",
  );
  const response = await tokenRequest(fx, clientId, {
    grant_type: "authorization_code",
    code: back.searchParams.get("code")!,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: endpoints.resource,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as Tokens;
};

const audienceOf = (token: string) => {
  const aud = decodeJwt(token).aud;
  return Array.isArray(aud) ? aud : [aud];
};

test("discovery: the metadata Claude and ChatGPT read before they connect, at the root", async () => {
  const fx = await fixture();
  const resource = (await (
    await fx.request("/.well-known/oauth-protected-resource/api/mcp")
  ).json()) as Record<string, unknown>;
  // Claude: `resource` is the URL the user enters; only the first server counts.
  assert.equal(resource.resource, "https://app.example.com/api/mcp");
  assert.deepEqual(resource.authorization_servers, [endpoints.issuer]);
  assert.deepEqual(resource.bearer_methods_supported, ["header"]);
  // /api/mcp takes bearer tokens only: no document offers DPoP.
  assert.equal("dpop_signing_alg_values_supported" in resource, false);
  for (const method of ["GET", "HEAD"]) {
    const answer = await fx.request("/.well-known/oauth-protected-resource/api/mcp", { method });
    assert.equal(answer.status, 200, method);
    assert.match(answer.headers.get("content-type") ?? "", /^application\/json/, method);
    assert.ok(answer.headers.get("cache-control"), method);
  }

  for (const path of [
    "/.well-known/oauth-authorization-server/api/auth",
    "/api/auth/.well-known/openid-configuration",
  ]) {
    const server = (await (await fx.request(path)).json()) as Record<string, unknown>;
    assert.equal(server.issuer, endpoints.issuer, path);
    assert.equal("dpop_signing_alg_values_supported" in server, false, path);
    assert.deepEqual(server.code_challenge_methods_supported, ["S256"], path);
    assert.equal(server.authorization_response_iss_parameter_supported, true, path);
    assert.equal(server.client_id_metadata_document_supported, true, path);
    assert.deepEqual(server.response_types_supported, ["code"], path);
    assert.deepEqual(server.response_modes_supported, ["query"], path);
    assert.equal(server.authorization_endpoint, `${endpoints.issuer}/oauth2/authorize`, path);
    assert.equal(server.token_endpoint, `${endpoints.issuer}/oauth2/token`, path);
    assert.equal(server.registration_endpoint, `${endpoints.issuer}/oauth2/register`, path);
    // Claude uses its metadata document only when public clients are taken;
    // ChatGPT's and Claude's confidential documents sign a client assertion.
    // Confidential clients keep their secrets.
    const authMethods = server.token_endpoint_auth_methods_supported as string[];
    for (const method of ["none", "private_key_jwt", "client_secret_basic", "client_secret_post"]) {
      assert.ok(authMethods.includes(method), `${path}: ${method}`);
    }
    for (const grant of ["authorization_code", "refresh_token"]) {
      assert.ok((server.grant_types_supported as string[]).includes(grant), `${path}: ${grant}`);
    }
    // Both add offline_access when it is advertised; ChatGPT asks for the OIDC scopes listed.
    assert.deepEqual(server.scopes_supported, ["openid", "profile", "email", "offline_access"]);
  }
});

test("every authorization response names the issuer (RFC 9207), errors included", async () => {
  const fx = await fixture();
  const clientId = await register(fx);
  const assertIssuer = (location: URL, error: string | null) => {
    assert.equal(location.searchParams.get("iss"), endpoints.issuer);
    assert.equal(location.searchParams.get("error"), error);
    assert.equal(location.searchParams.get("state"), "state-1");
  };

  // The user refuses (before any consent is on record).
  const refused = await consent(
    fx,
    await startAuthorization(fx, {
      clientId,
      redirectUri: REDIRECT_URI,
      challenge: pkce().challenge,
    }),
    false,
  );
  assertIssuer(refused, "access_denied");

  // Success: the code.
  const success = await consent(
    fx,
    await startAuthorization(fx, {
      clientId,
      redirectUri: REDIRECT_URI,
      challenge: pkce().challenge,
    }),
  );
  assertIssuer(success, null);
  assert.ok(success.searchParams.get("code"));

  // No PKCE: refused back to the client, which then knows who answered.
  assertIssuer(
    clientRedirect(
      await startAuthorization(fx, { clientId, redirectUri: REDIRECT_URI }),
      REDIRECT_URI,
    ),
    "invalid_request",
  );
  // A plain challenge: S256 only.
  assertIssuer(
    clientRedirect(
      await startAuthorization(fx, {
        clientId,
        redirectUri: REDIRECT_URI,
        code_challenge: "a".repeat(43),
        code_challenge_method: "plain",
      }),
      REDIRECT_URI,
    ),
    "invalid_request",
  );
  // A scope the client may not ask for.
  assertIssuer(
    clientRedirect(
      await startAuthorization(fx, {
        clientId,
        redirectUri: REDIRECT_URI,
        challenge: pkce().challenge,
        scope: "openid admin",
      }),
      REDIRECT_URI,
    ),
    "invalid_scope",
  );
  // Signed out with prompt=none.
  const signedOut = await fx.request(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "openid",
      state: "state-1",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      prompt: "none",
    })}`,
    { anonymous: true },
  );
  assertIssuer(clientRedirect(signedOut, REDIRECT_URI), "login_required");

  // An unknown redirect is never followed: the error stays on Louez.
  const unknown = await startAuthorization(fx, {
    clientId,
    redirectUri: "https://evil.example.net/callback",
    challenge: pkce().challenge,
  });
  assert.equal(new URL(unknown.headers.get("location")!, ORIGIN).origin, ORIGIN);
});

for (const [name, clientId, redirectUri] of [
  ["Claude", CLAUDE, CLAUDE_CALLBACK],
  ["Claude (confidential document)", CLAUDE_CONFIDENTIAL, CLAUDE_CALLBACK],
  ["Claude Code", CLAUDE_CODE, "http://127.0.0.1:53682/callback"],
  ["ChatGPT", CHATGPT, CHATGPT_CALLBACK],
] as const) {
  test(`${name} connects with its published metadata document`, async () => {
    const fx = await fixture();
    const tokens = await connectClient(fx, clientId, redirectUri);
    assert.equal(tokens.token_type.toLowerCase(), "bearer");
    assert.ok(audienceOf(tokens.access_token).includes(endpoints.resource), "aud is the resource");
    const verified = await fx.verify(tokens.access_token);
    assert.equal(verified?.clientId, clientId);
    assert.ok(tokens.refresh_token, "offline_access gives a refresh token");

    const client = fx.data.oauthClient.find((row) => row.clientId === clientId);
    assert.ok(client?.clientDiscoveryId, "known from its document, not registered");
    assert.equal(fx.data.oauthClient.length, 1, "no client registered per connection");
  });
}

test("Cursor and Grok connect with Cursor's document, through every redirect it lists", async () => {
  // Cursor's agents and Bot, grok.com and Grok Bot, and its local callback.
  for (const redirectUri of CURSOR_REDIRECTS) {
    const fx = await fixture();
    const tokens = await connectClient(fx, CURSOR, redirectUri);
    assert.ok(audienceOf(tokens.access_token).includes(endpoints.resource), redirectUri);
    assert.equal((await fx.verify(tokens.access_token))?.clientId, CURSOR, redirectUri);
    assert.ok(tokens.refresh_token, redirectUri);
    const [client, ...others] = fx.data.oauthClient;
    assert.equal(others.length, 0, "known from its document, not registered");
    assert.equal(client.name, "Cursor");
    assert.ok(client.clientDiscoveryId);
  }
});

test("a client that names the resource once, and no scope, gets tokens /api/mcp takes", async () => {
  // MCP clients must name the resource at both steps; one is enough here.
  // A client that never names it gets an opaque token, which /api/mcp refuses.
  const [redirectUri] = CURSOR_REDIRECTS;
  for (const namedAt of ["authorization", "token"] as const) {
    const fx = await fixture();
    const { verifier, challenge } = pkce();
    const authorization = await fx.request(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: CURSOR,
        redirect_uri: redirectUri,
        state: "state-1",
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(namedAt === "authorization" ? { resource: endpoints.resource } : {}),
      })}`,
    );
    const back = await consent(fx, authorization);
    const response = await tokenRequest(fx, CURSOR, {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      ...(namedAt === "token" ? { resource: endpoints.resource } : {}),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const tokens = (await response.json()) as Tokens;
    assert.equal((await fx.verify(tokens.access_token))?.clientId, CURSOR, namedAt);
    assert.ok(audienceOf(tokens.access_token).includes(endpoints.resource), namedAt);
    if (!tokens.refresh_token) continue;
    // A refresh that does not name it keeps the token's resource.
    const refreshed = await tokenRequest(fx, CURSOR, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const next = (await refreshed.json()) as Tokens;
    assert.equal((await fx.verify(next.access_token))?.clientId, CURSOR, `${namedAt}, refreshed`);
  }
});

test("Cursor's desktop app registers its redirects as a native client, cursor:// included", async () => {
  const fx = await fixture();
  const desktop = "cursor://anysphere.cursor-mcp/oauth/callback";
  const registration = (body: object) =>
    fx.request("/api/auth/oauth2/register", {
      method: "POST",
      anonymous: true,
      body: JSON.stringify({
        client_name: "Cursor",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...body,
      }),
    });
  const response = await registration({ redirect_uris: [desktop] });
  assert.equal(response.status, 201, await response.clone().text());
  const registered = (await response.json()) as { client_id: string; application_type?: string };
  assert.equal(registered.application_type, "native", "a private-use scheme is a native app");
  const tokens = await connectClient(fx, registered.client_id, desktop);
  assert.equal((await fx.verify(tokens.access_token))?.clientId, registered.client_id);
  // Its code goes to that exact URI only.
  const other = await startAuthorization(fx, {
    clientId: registered.client_id,
    redirectUri: "cursor://anysphere.cursor-mcp/other",
    challenge: pkce().challenge,
  });
  assert.equal(new URL(other.headers.get("location")!, ORIGIN).origin, ORIGIN);

  // The pair Cursor's documentation says the desktop app registers.
  const [web, , , loopback] = CURSOR_REDIRECTS;
  const pair = await registration({ redirect_uris: [web, loopback] });
  assert.equal(pair.status, 201, await pair.clone().text());
  const pairClient = ((await pair.json()) as { client_id: string }).client_id;
  const issued = await connectClient(fx, pairClient, web);
  assert.equal((await fx.verify(issued.access_token))?.clientId, pairClient);
  // Consented once, the client's other redirect gets its code straight away.
  const local = await startAuthorization(fx, {
    clientId: pairClient,
    redirectUri: loopback,
    challenge: pkce().challenge,
  });
  assert.ok(clientRedirect(local, loopback).searchParams.get("code"));

  // A web client may not take one; no client may take a browser or script scheme.
  const refused = async (body: object, why: string) => {
    const answer = await registration(body);
    assert.equal(answer.status, 400, why);
    assert.equal(((await answer.json()) as { error?: string }).error, "invalid_redirect_uri", why);
  };
  await refused({ redirect_uris: [desktop], application_type: "web" }, "web");
  for (const uri of ["javascript://cursor/%0aalert(1)", "data://cursor/x", "file://cursor/x"]) {
    await refused({ redirect_uris: [uri] }, uri);
  }
});

test("Claude Code's loopback redirect matches on any port, its hosts and path only", async () => {
  const fx = await fixture();
  const reaches = async (clientId: string, redirectUri: string) => {
    const response = await startAuthorization(fx, {
      clientId,
      redirectUri,
      challenge: pkce().challenge,
    });
    return new URL(response.headers.get("location")!, ORIGIN).pathname === OAUTH_CONSENT_PAGE;
  };
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const port of ["", ":1", ":8080", ":53682", ":65535"]) {
      assert.ok(await reaches(CLAUDE_CODE, `http://${host}${port}/callback`), `${host}${port}`);
    }
  }
  for (const refused of [
    "http://localhost:53682/other",
    "http://localhost:53682/callback/",
    "https://localhost:53682/callback",
    "http://[::1]:53682/callback",
    "http://127.0.0.2:53682/callback",
    "http://localhost.evil.example:53682/callback",
    "http://user@localhost:53682/callback",
    "http://localhost:53682/callback#fragment",
  ]) {
    assert.equal(await reaches(CLAUDE_CODE, refused), false, refused);
  }
  // Ports vary only on loopback: a web client's redirect is matched exactly.
  assert.ok(await reaches(CLAUDE, CLAUDE_CALLBACK));
  assert.equal(await reaches(CLAUDE, "https://claude.ai:8443/api/mcp/auth_callback"), false);
  assert.equal(await reaches(CLAUDE, "http://localhost:53682/api/mcp/auth_callback"), false);
  assert.equal(await reaches(CHATGPT, "https://chatgpt.com/connector/oauth/abc123"), false);
});

test("a registered client gets its own redirects, ChatGPT's per-connection one included", async () => {
  const fx = await fixture();
  const callback = "https://chatgpt.com/connector/oauth/cb_0123456789";
  const response = await fx.request("/api/auth/oauth2/register", {
    method: "POST",
    anonymous: true,
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const { client_id: clientId } = (await response.json()) as { client_id: string };
  const tokens = await connectClient(fx, clientId, callback);
  assert.ok(audienceOf(tokens.access_token).includes(endpoints.resource));
  assert.equal((await fx.verify(tokens.access_token))?.clientId, clientId);
});

test("a token is only for the resource the client named: another one is refused", async () => {
  const fx = await fixture();
  const { verifier, challenge } = pkce();
  const elsewhere = clientRedirect(
    await startAuthorization(fx, {
      clientId: CLAUDE,
      redirectUri: CLAUDE_CALLBACK,
      challenge,
      resource: "https://evil.example.net/mcp",
    }),
    CLAUDE_CALLBACK,
  );
  assert.equal(elsewhere.searchParams.get("error"), "invalid_target");
  assert.equal(elsewhere.searchParams.get("iss"), endpoints.issuer);

  // A code for the MCP resource cannot be exchanged for another one.
  const back = await consent(
    fx,
    await startAuthorization(fx, { clientId: CLAUDE, redirectUri: CLAUDE_CALLBACK, challenge }),
  );
  const swapped = await tokenRequest(fx, CLAUDE, {
    grant_type: "authorization_code",
    code: back.searchParams.get("code")!,
    redirect_uri: CLAUDE_CALLBACK,
    code_verifier: verifier,
    resource: `${ORIGIN}/api/v1`,
  });
  assert.equal(swapped.status, 400);
  assert.equal(((await swapped.json()) as { error?: string }).error, "invalid_target");
});

test("a refresh rotates the token; a spent, unknown or foreign one gets invalid_grant", async () => {
  const fx = await fixture();
  const first = await connectClient(fx, CLAUDE, CLAUDE_CALLBACK);
  const refresh = (clientId: string, refreshToken: string) =>
    tokenRequest(fx, clientId, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource: endpoints.resource,
    });

  const rotated = await refresh(CLAUDE, first.refresh_token!);
  assert.equal(rotated.status, 200, await rotated.clone().text());
  const second = (await rotated.json()) as Tokens;
  assert.ok(second.refresh_token);
  assert.notEqual(second.refresh_token, first.refresh_token, "a new refresh token every time");
  assert.equal((await fx.verify(second.access_token))?.clientId, CLAUDE);
  assert.ok(audienceOf(second.access_token).includes(endpoints.resource));

  // A retry whose answer was lost (30 seconds) gets the same answer, nothing new.
  const retried = await refresh(CLAUDE, first.refresh_token!);
  assert.equal(retried.status, 200, await retried.clone().text());
  assert.equal(((await retried.json()) as Tokens).refresh_token, second.refresh_token);

  const invalidGrant = async (response: Response, why: string) => {
    assert.equal(response.status, 400, why);
    assert.equal(((await response.json()) as { error?: string }).error, "invalid_grant", why);
  };
  await invalidGrant(await refresh(CLAUDE, "not-a-refresh-token"), "unknown");
  await invalidGrant(await refresh(CLAUDE, `${second.refresh_token}x`), "altered");
  // Another client's refresh token is not this client's to use.
  const other = await connectClient(fx, CLAUDE_CODE, "http://localhost:1455/callback");
  await invalidGrant(await refresh(CLAUDE, other.refresh_token!), "another client's");

  // The spent token, replayed after the provider's 30-second retry window.
  const row = fx.data.oauthRefreshToken.find((token) => token.rotatedAt);
  assert.ok(row, "the spent token is marked rotated");
  row.rotationReplayExpiresAt = new Date(Date.now() - 1000);
  await invalidGrant(await refresh(CLAUDE, first.refresh_token!), "spent");
  // Reuse is taken as theft: the whole family is revoked, the newest token too.
  await invalidGrant(await refresh(CLAUDE, second.refresh_token!), "revoked with its family");
});
