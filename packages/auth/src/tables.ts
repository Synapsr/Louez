import {
  accounts,
  authRateLimits,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  passkeyTable,
  sessions,
  users,
  verification,
} from "@louez/db/schema";

/** The Drizzle table behind each Better Auth model, core and plugins. */
export const authTables = {
  user: users,
  account: accounts,
  session: sessions,
  verification,
  rateLimit: authRateLimits,
  passkey: passkeyTable,
  jwks,
  oauthClient: oauthClients,
  oauthResource: oauthResources,
  oauthClientResource: oauthClientResources,
  oauthRefreshToken: oauthRefreshTokens,
  oauthAccessToken: oauthAccessTokens,
  oauthConsent: oauthConsents,
  oauthClientAssertion: oauthClientAssertions,
};
