import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cleanOpenAiAppsChallenge, openAiAppsChallengeResponse } from "./openai-apps-challenge";

// OpenAI's domain check reads the token alone, as plain text (docs/architecture/api-and-agents.md).

describe("cleanOpenAiAppsChallenge", () => {
  test("keeps a token, without the whitespace around it", () => {
    assert.equal(cleanOpenAiAppsChallenge("abc123_-.XYZ"), "abc123_-.XYZ");
    assert.equal(cleanOpenAiAppsChallenge("  abc123\n"), "abc123");
  });

  test("refuses no token, whitespace inside one, or more than 512 characters", () => {
    for (const value of [undefined, "", "   ", "\n\t"]) {
      assert.equal(cleanOpenAiAppsChallenge(value), null, JSON.stringify(value));
    }
    for (const value of ["abc 123", "abc\n123", "abc\t123", "one two"]) {
      assert.equal(cleanOpenAiAppsChallenge(value), null, JSON.stringify(value));
    }
    assert.equal(cleanOpenAiAppsChallenge("a".repeat(512)), "a".repeat(512));
    assert.equal(cleanOpenAiAppsChallenge("a".repeat(513)), null);
  });
});

describe("openAiAppsChallengeResponse", () => {
  test("answers 200 with the token alone in plain text, never cached", async () => {
    const response = openAiAppsChallengeResponse(" token-123 \n");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "token-123");
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("answers 404 without a usable token", async () => {
    for (const value of [undefined, "", "two words"]) {
      const response = openAiAppsChallengeResponse(value);
      assert.equal(response.status, 404, JSON.stringify(value));
      assert.equal(await response.text(), "Not Found");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
});
