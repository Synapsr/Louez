import assert from "node:assert/strict";
import { test } from "node:test";
import { signRequest, streamToken, verifyRequest, verifyStreamToken } from "./auth.js";
import { resolveLiveVoice } from "./catalog.js";

test("stream credentials bind conversation, call and expiry", () => {
  const secret = "test-secret";
  const token = streamToken(secret, "conversation", "CA1", "1100");
  assert.ok(verifyStreamToken(secret, "conversation", "CA1", "1100", token, 1000));
  assert.ok(!verifyStreamToken(secret, "conversation", "CA2", "1100", token, 1000));
  assert.ok(!verifyStreamToken(secret, "other", "CA1", "1100", token, 1000));
  assert.ok(!verifyStreamToken(secret, "conversation", "CA1", "1100", token, 1101));
});
test("requests cannot be replayed to another endpoint, altered or used after expiry", () => {
  const body = '{"type":"start"}';
  const signature = signRequest("secret", "/api/voice/live", "1000", body);
  assert.ok(verifyRequest("secret", "/api/voice/live", "1000", signature, body, 2000));
  assert.ok(!verifyRequest("secret", "/preview", "1000", signature, body, 2000));
  assert.ok(!verifyRequest("secret", "/api/voice/live", "1000", signature, body + " ", 2000));
  assert.ok(!verifyRequest("secret", "/api/voice/live", "1000", signature, body, 61_001));
});
test("legacy voice ids never reach OpenAI and a valid selection wins", () => {
  assert.equal(resolveLiveVoice("fr", "old-elevenlabs-id"), "brise");
  assert.equal(resolveLiveVoice("en", "sillage"), "sillage");
  assert.equal(resolveLiveVoice("fr", "", "tempo"), "tempo");
  assert.equal(resolveLiveVoice("fr", "", "old"), "brise");
});

test("preview accepts all documented presets, rejects unknown voices and languages", async () => {
  const { LIVE_VOICES } = await import("./catalog.js");
  const { previewSchema } = await import("./protocol.js");
  assert.equal(LIVE_VOICES.length, 31);
  for (const voice of LIVE_VOICES)
    assert.ok(previewSchema.safeParse({ voiceId: voice.id, language: "fr" }).success);
  assert.ok(!previewSchema.safeParse({ voiceId: "legacy-elevenlabs", language: "fr" }).success);
  assert.ok(!previewSchema.safeParse({ voiceId: "brise", language: "../../etc/passwd" }).success);
});

test("Twilio upgrade signatures are bound to the configured public URL", async () => {
  const { createHmac } = await import("node:crypto");
  const { verifyTwilioUpgrade } = await import("./auth.js");
  const url = "https://voice.example.com/media";
  const signature = createHmac("sha1", "auth-token").update(url).digest("base64");
  assert.ok(verifyTwilioUpgrade("auth-token", url, signature));
  assert.ok(!verifyTwilioUpgrade("auth-token", "https://evil.example/media", signature));
  assert.ok(!verifyTwilioUpgrade("auth-token", url, undefined));
});
