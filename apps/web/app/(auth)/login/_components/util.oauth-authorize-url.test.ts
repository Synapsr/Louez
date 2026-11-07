import assert from "node:assert/strict";
import { test } from "node:test";

import { oauthAuthorizeUrl } from "./util.oauth-authorize-url";

test("an ordinary sign-in has no authorization to resume", () => {
  assert.equal(oauthAuthorizeUrl(new URLSearchParams("callbackUrl=/dashboard")), null);
  assert.equal(oauthAuthorizeUrl(new URLSearchParams("client_id=abc")), null);
});

test("an agent's sign-in goes back to the authorization endpoint, without the signature", () => {
  const url = oauthAuthorizeUrl(
    new URLSearchParams({
      response_type: "code",
      client_id: "https://claude.ai/oauth/client.json",
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      scope: "openid offline_access",
      prompt: "login consent",
      max_age: "0",
      exp: "1",
      ba_iat: "1",
      ba_param: "client_id",
      sig: "signature",
    }),
  );
  assert.ok(url);
  const parsed = new URL(url, "https://app.example.com");
  assert.equal(parsed.pathname, "/api/auth/oauth2/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "https://claude.ai/oauth/client.json");
  assert.equal(parsed.searchParams.get("scope"), "openid offline_access");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  for (const name of ["sig", "exp", "ba_iat", "ba_param", "max_age"]) {
    assert.equal(parsed.searchParams.has(name), false, name);
  }
});
