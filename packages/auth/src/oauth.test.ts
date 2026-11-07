import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getAuthTables } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import {
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
    disabledPaths: ["/token"],
    plugins: mcpOAuthPlugins(endpoints, {
      // The grant Louez saved before the consent: the lineage's reference.
      currentGrantId: async () => grantId,
      isGrantActive: async ({ grantId: id }) => id === grantId,
      // A client metadata document, served without the network.
      fetchClientMetadata: async (input) => {
        const url = new Request(input).url;
        if (url !== CIMD_CLIENT_ID) return new Response(null, { status: 404 });
        return Response.json(
          {
            client_id: CIMD_CLIENT_ID,
            client_name: "Agent from a document",
            client_uri: "https://agent.example.org",
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          },
          { headers: { "cache-control": "max-age=60" } },
        );
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

test("discovery: protected resource and authorization server metadata at the root", async () => {
  const fx = await fixture();
  const resource = await fx.request("/.well-known/oauth-protected-resource/api/mcp");
  assert.equal(resource.status, 200);
  const resourceMetadata = (await resource.json()) as Record<string, unknown>;
  assert.equal(resourceMetadata.resource, endpoints.resource);
  assert.deepEqual(resourceMetadata.authorization_servers, [endpoints.issuer]);

  const server = await fx.request("/.well-known/oauth-authorization-server/api/auth");
  assert.equal(server.status, 200);
  const serverMetadata = (await server.json()) as Record<string, unknown>;
  assert.equal(serverMetadata.issuer, endpoints.issuer);
  assert.equal(serverMetadata.authorization_endpoint, `${endpoints.issuer}/oauth2/authorize`);
  assert.equal(serverMetadata.registration_endpoint, `${endpoints.issuer}/oauth2/register`);
  assert.equal(serverMetadata.client_id_metadata_document_supported, true);

  const openId = await fx.request("/api/auth/.well-known/openid-configuration");
  assert.equal(openId.status, 200);
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
