import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { GRANT_CLAIM, createAccessTokenVerifier } from "./oauth";

/**
 * Access tokens for tests: a throwaway signing key, a verifier that trusts
 * only it, and a signer that writes tokens shaped like Better Auth's (type
 * `at+jwt`, `azp` the client, the grant claim). Tests of the API and the MCP endpoint replace
 * `verifyMcpAccessToken` with `verify`, and call nothing outside the process.
 */
export async function createTestAccessTokens(options: { issuer: string; audience: string }) {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "EdDSA" };
  const verify = createAccessTokenVerifier({
    issuer: options.issuer,
    audience: options.audience,
    loadJwks: async () => ({ keys: [jwk] }),
  });

  const sign = (claims: {
    userId: string;
    clientId: string;
    /** The grant the token names; null leaves the claim out. */
    grantId: string | null;
    audience?: string;
    issuer?: string;
    /** Seconds from now; negative for an expired token. */
    expiresIn?: number;
  }) => {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = claims.expiresIn ?? 3600;
    return new SignJWT({
      azp: claims.clientId,
      client_id: claims.clientId,
      scope: "openid",
      ...(claims.grantId ? { [GRANT_CLAIM]: claims.grantId } : {}),
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: "test-key" })
      .setIssuer(claims.issuer ?? options.issuer)
      .setAudience(claims.audience ?? options.audience)
      .setSubject(claims.userId)
      .setIssuedAt(Math.min(now, now + expiresIn - 60))
      .setExpirationTime(now + expiresIn)
      .sign(privateKey);
  };

  return { sign, verify };
}
