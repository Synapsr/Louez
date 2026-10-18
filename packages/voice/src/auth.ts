import { createHmac, timingSafeEqual } from "node:crypto";

const mac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("base64url");
const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const streamToken = (
  secret: string,
  conversationId: string,
  callId: string,
  expires: string,
) => mac(secret, `stream.${conversationId}.${callId}.${expires}`);

export function verifyStreamToken(
  secret: string,
  conversationId: string,
  callId: string,
  expires: string,
  token: string,
  now = Date.now(),
) {
  const deadline = Number(expires);
  return (
    Number.isSafeInteger(deadline) &&
    deadline >= now &&
    deadline <= now + 300_000 &&
    equal(streamToken(secret, conversationId, callId, expires), token)
  );
}

export const signRequest = (secret: string, path: string, timestamp: string, body: string) =>
  mac(secret, `POST.${path}.${timestamp}.${body}`);

export function verifyRequest(
  secret: string,
  path: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now = Date.now(),
) {
  if (!timestamp || !signature || !secret) return false;
  const time = Number(timestamp);
  return (
    Number.isSafeInteger(time) &&
    Math.abs(now - time) <= 60_000 &&
    equal(signRequest(secret, path, timestamp, body), signature)
  );
}

// Twilio signs the exact public HTTPS upgrade URL (no trusted forwarded host).
export function verifyTwilioUpgrade(
  authToken: string,
  publicUrl: string,
  signature: string | undefined,
) {
  if (!signature) return false;
  const expected = createHmac("sha1", authToken).update(publicUrl).digest("base64");
  return equal(expected, signature);
}
