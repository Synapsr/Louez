import assert from "node:assert/strict";
import { test } from "node:test";

import {
  registeredRedirectUris,
  vendorOfRedirect,
  verifiedDestination,
} from "./agent-destinations";

test("the redirect URIs the vendors publish are theirs", () => {
  const published: Array<[string, string, string]> = [
    ["https://www.cursor.com/agents/mcp/oauth/callback", "cursor", "cursor.com"],
    ["https://www.cursor.com/bot/mcp/oauth/callback", "cursor", "cursor.com"],
    ["https://cursor.com/callback", "cursor", "cursor.com"],
    ["https://grok.com/connectors-oauth-exchange-code/", "grok", "grok.com"],
    ["https://console.x.ai/oauth/callback", "grok", "x.ai"],
    ["https://chatgpt.com/connector_platform_oauth_redirect", "chatgpt", "chatgpt.com"],
    ["https://chatgpt.com/connector/oauth/abc123", "chatgpt", "chatgpt.com"],
    ["https://platform.openai.com/oauth/callback", "chatgpt", "openai.com"],
    ["https://claude.ai/api/mcp/auth_callback", "claude", "claude.ai"],
    ["https://claude.com/api/mcp/auth_callback", "claude", "claude.com"],
    // Case does not matter, in the scheme or the host.
    ["HTTPS://WWW.Cursor.COM/bot/mcp/oauth/callback", "cursor", "cursor.com"],
    ["https://cursor.com", "cursor", "cursor.com"],
    ["https://cursor.com?state=1", "cursor", "cursor.com"],
  ];
  for (const [uri, vendor, domain] of published) {
    assert.deepEqual(vendorOfRedirect(uri), { vendor, domain }, uri);
  }
});

test("a redirect URI that only looks like a vendor's is nobody's", () => {
  const hostile = [
    // Another host carrying the vendor's name.
    "https://cursor.com.evil.test/callback",
    "https://evilcursor.com/callback",
    "https://cursor-com.evil.test/callback",
    "https://evil.test/cursor.com",
    "https://evil.test/?redirect=https://cursor.com/",
    "https://evil.test#cursor.com",
    "https://cursor.co/callback",
    "https://cursor.com.au/callback",
    "https://xai/callback",
    "https://grok.com.x.ai.evil.test/",
    // User info: the host is evil.test, or the authority is not the host alone.
    "https://cursor.com@evil.test/callback",
    "https://cursor.com:pass@evil.test/callback",
    "https://user@cursor.com/callback",
    "https://user:pass@www.cursor.com/callback",
    // A port, even the default one.
    "https://cursor.com:8443/callback",
    "https://cursor.com:443/callback",
    // A trailing dot, an empty label, extra or missing slashes.
    "https://cursor.com./callback",
    "https://www.cursor.com../callback",
    "https://.cursor.com/callback",
    "https:///cursor.com/callback",
    "https:cursor.com/callback",
    "https:/cursor.com/callback",
    "//cursor.com/callback",
    // What a parser would rewrite: backslashes, percent escapes, whitespace.
    "https://evil.test\\@cursor.com/callback",
    "https://cursor.com\\@evil.test/callback",
    "https://evil.test\\.cursor.com/callback",
    "https://cursor%2Ecom/callback",
    "https://cursor.com%2F@evil.test/",
    "https://www%2Ecursor.com/callback",
    "https://evil.test\t.cursor.com/callback",
    "https://evil\n.cursor.com/callback",
    " https://cursor.com/callback",
    "https://cursor.com/callback ",
    // Internationalized hosts: look-alikes, and the vendor's in Unicode form.
    "https://сursor.com/callback", // Cyrillic с
    "https://cursor.cοm/callback", // Greek ο
    "https://xn--ursor-6ve.com/callback",
    "https://cursor。com/callback", // ideographic full stop
    "https://ｃｕｒｓｏｒ.com/callback", // full-width letters
    "https://cursor.com​/callback",
    // Not HTTPS.
    "http://cursor.com/callback",
    "http://www.cursor.com/bot/mcp/oauth/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "wss://cursor.com/callback",
    "javascript://cursor.com/%0aalert(1)",
    "data:text/html,https://cursor.com",
    // Loopback and addresses.
    "http://127.0.0.1:8787/callback",
    "http://localhost:8787/callback",
    "https://localhost/callback",
    "https://[::1]/callback",
    "https://104.18.0.1/callback",
    // Not a URL.
    "",
    "cursor.com",
    "https://",
    "not a url",
  ];
  for (const uri of hostile) {
    assert.equal(vendorOfRedirect(uri), null, JSON.stringify(uri));
  }
});

test("a client is a vendor's only when every redirect URI, the request's too, is on that vendor's domains", () => {
  const cursorBot = "https://www.cursor.com/bot/mcp/oauth/callback";
  const cursorAgents = "https://www.cursor.com/agents/mcp/oauth/callback";
  const cursor = { vendor: "cursor", domain: "cursor.com", name: "Cursor" };

  assert.deepEqual(verifiedDestination({ registered: [cursorBot], requested: cursorBot }), cursor);
  assert.deepEqual(
    verifiedDestination({ registered: [cursorBot, cursorAgents], requested: cursorAgents }),
    cursor,
  );
  // The list has no request: the registered URIs alone decide.
  assert.deepEqual(verifiedDestination({ registered: [cursorBot], requested: null }), cursor);

  // The domain shown is the one this request's code goes to.
  assert.deepEqual(
    verifiedDestination({
      registered: ["https://chatgpt.com/connector/oauth/1", "https://platform.openai.com/cb"],
      requested: "https://platform.openai.com/cb",
    }),
    { vendor: "chatgpt", domain: "openai.com", name: "ChatGPT" },
  );

  const elsewhere: Array<{ registered: string[]; requested: string | null }> = [
    // Cursor's own metadata document: grok.com and loopback ones too.
    {
      registered: [
        cursorAgents,
        cursorBot,
        "https://grok.com/connectors-oauth-exchange-code/",
        "http://localhost:8787/callback",
        "http://127.0.0.1:8787/callback",
      ],
      requested: cursorBot,
    },
    { registered: [cursorBot, "https://evil.test/callback"], requested: cursorBot },
    { registered: [cursorBot, "cursor://anysphere.cursor-mcp/oauth/callback"], requested: null },
    { registered: [cursorBot, "https://cursor.com.evil.test/callback"], requested: cursorBot },
    // Two vendors: no single one receives the code.
    {
      registered: [cursorBot, "https://grok.com/connectors-oauth-exchange-code/"],
      requested: null,
    },
    // A request that went elsewhere (Better Auth refuses it before; checked anyway).
    { registered: [cursorBot], requested: "https://evil.test/callback" },
    { registered: [cursorBot], requested: "https://grok.com/connectors-oauth-exchange-code/" },
    { registered: [], requested: cursorBot },
    { registered: [], requested: null },
  ];
  for (const input of elsewhere) {
    assert.equal(verifiedDestination(input), null, JSON.stringify(input));
  }
});

test("registered redirect URIs are read from Better Auth's JSON column, anything else as none", () => {
  assert.deepEqual(registeredRedirectUris('["https://cursor.com/a","https://cursor.com/b"]'), [
    "https://cursor.com/a",
    "https://cursor.com/b",
  ]);
  for (const raw of [
    null,
    "",
    "https://cursor.com/a",
    "{}",
    '"https://cursor.com/a"',
    "[1]",
    "[",
  ]) {
    assert.deepEqual(registeredRedirectUris(raw), [], String(raw));
  }
});
