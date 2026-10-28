import assert from "node:assert/strict";
import { type KeyObject, generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";

import {
  type HandoffClaims,
  buildHandoffClaims,
  mintHandoffToken,
  readHandoffSigningKey,
} from "./handoff";
import {
  HANDOFF_CLAIM_NAMES,
  decodeTokenPart,
  serviceRefusal as refusal,
} from "./handoff-verifier.fixtures";

// The hand-off token (louez-billing docs/api, README §10; openapi `HandoffTokenHeader`
// and `HandoffTokenClaims`), checked against the service's verifier rules
// (handoff-verifier.fixtures.ts). Each test makes its own key pair.

const DASHBOARD = "https://app.billing.test";
const BILLING = "https://billing.billing.test";
const KID = "louez-sso-test-1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    privateKey,
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

/** The service's answer with these keys at this second. */
const serviceRefusal = (token: string, keys: ReadonlyMap<string, KeyObject>, nowSeconds: number) =>
  refusal(token, { keys, dashboardOrigin: DASHBOARD, billingOrigin: BILLING, nowSeconds });

function claimsAt(now: Date, overrides: Partial<Parameters<typeof buildHandoffClaims>[0]> = {}) {
  return buildHandoffClaims({
    dashboardOrigin: DASHBOARD,
    billingOrigin: BILLING,
    userId: "owner1",
    storeId: "V1StGXR8_Z5jdHi6B-myT",
    role: "owner",
    locale: "fr",
    to: "/payment-method",
    now,
    ...overrides,
  });
}

function signingKey(pem: string, kid = KID) {
  const result = readHandoffSigningKey({ BILLING_SSO_PRIVATE_KEY: pem, BILLING_SSO_KID: kid });
  assert.ok(result.ok, result.ok ? "" : result.errors.join("; "));
  return result.key;
}

describe("the hand-off token", () => {
  test("passes the service's checks: EdDSA, the kid, the signature and every claim", () => {
    const pair = keyPair();
    const now = new Date("2026-12-01T10:00:00.400Z");
    const claims = claimsAt(now);
    const token = mintHandoffToken(claims, signingKey(pair.pem));
    const nowSeconds = Math.floor(now.getTime() / 1000);

    assert.equal(serviceRefusal(token, new Map([[KID, pair.publicKey]]), nowSeconds), null);
    assert.deepEqual(decodeTokenPart(token, 0), { alg: "EdDSA", typ: "JWT", kid: KID });
    assert.deepEqual(decodeTokenPart(token, 1), claims);
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(claims.iat, nowSeconds);
    // Still good at the edges of the service clock, refused past them.
    const keys = new Map([[KID, pair.publicKey]]);
    assert.equal(serviceRefusal(token, keys, nowSeconds - 30), null);
    assert.equal(serviceRefusal(token, keys, nowSeconds + 30), null);
    assert.equal(serviceRefusal(token, keys, nowSeconds + 31), "issued_at");
    assert.equal(serviceRefusal(token, keys, nowSeconds + 60), "expired");
  });

  test("carries the contract's claims and nothing else: no email, no name, no act", () => {
    const claims: HandoffClaims = claimsAt(new Date());
    assert.deepEqual(Object.keys(claims).sort(), HANDOFF_CLAIM_NAMES);
    assert.equal(claims.iss, DASHBOARD);
    assert.equal(claims.aud, BILLING);
    assert.equal(claims.return_url, `${DASHBOARD}/dashboard/billing/return`);
    assert.match(claims.jti, UUID);
    assert.notEqual(claims.jti, claimsAt(new Date()).jti, "a fresh jti every time");
  });

  test("a platform admin's token says so, with their own user id in sub", () => {
    const pair = keyPair();
    const now = new Date();
    const claims = claimsAt(now, { userId: "admin_1", role: "platform_admin" });
    const token = mintHandoffToken(claims, signingKey(pair.pem));
    assert.equal(
      serviceRefusal(token, new Map([[KID, pair.publicKey]]), Math.floor(now.getTime() / 1000)),
      null,
    );
    assert.equal(claims.role, "platform_admin");
    assert.equal(claims.sub, "admin_1");
  });

  test("the service refuses it under another key or kid, and once tampered with", () => {
    const pair = keyPair();
    const other = keyPair();
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const token = mintHandoffToken(claimsAt(now), signingKey(pair.pem));
    assert.equal(serviceRefusal(token, new Map([[KID, other.publicKey]]), nowSeconds), "signature");
    assert.equal(
      serviceRefusal(token, new Map([["louez-sso-old", pair.publicKey]]), nowSeconds),
      "kid",
    );
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claimsAt(now), store_id: "another_store" }),
    ).toString("base64url");
    assert.equal(
      serviceRefusal(
        `${header}.${forged}.${signature}`,
        new Map([[KID, pair.publicKey]]),
        nowSeconds,
      ),
      "signature",
    );
  });

  test("opens a billing page of the contract, or the overview", () => {
    const now = new Date();
    assert.equal(claimsAt(now, { to: "/statements/stmt_2026-11" }).to, "/statements/stmt_2026-11");
    assert.equal(claimsAt(now, { to: "/details" }).to, "/details");
    for (const to of [
      null,
      "",
      "/",
      "/admin",
      "https://evil.test/",
      "//evil.test",
      "/statements/",
    ]) {
      assert.equal(claimsAt(now, { to }).to, "/", String(to));
    }
  });

  test("is never minted for an id or a locale the service would refuse", () => {
    const now = new Date();
    assert.throws(() => claimsAt(now, { userId: "a".repeat(33) }), /user id/);
    assert.throws(() => claimsAt(now, { userId: "owner 1" }), /user id/);
    assert.throws(() => claimsAt(now, { storeId: "store/1" }), /LouezId/);
    assert.throws(() => claimsAt(now, { locale: "fr-FR" }), /two letters/);
  });
});

describe("readHandoffSigningKey", () => {
  test("reads an Ed25519 PKCS#8 PEM and its kid, also pasted on one line", () => {
    const pair = keyPair();
    const key = signingKey(pair.pem);
    assert.equal(key.kid, KID);
    assert.equal(key.privateKey.asymmetricKeyType, "ed25519");
    const oneLine = signingKey(pair.pem.trim().replaceAll("\n", "\\n"));
    assert.ok(oneLine.privateKey.equals(pair.privateKey));
  });

  test("names what is missing or wrong, never the value", () => {
    assert.deepEqual(readHandoffSigningKey({}), {
      ok: false,
      errors: ["BILLING_SSO_PRIVATE_KEY is required", "BILLING_SSO_KID is required"],
    });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    const ed = keyPair();
    for (const pem of [
      rsa,
      "not a key",
      ed.publicKey.export({ format: "pem", type: "spki" }).toString(),
    ]) {
      const result = readHandoffSigningKey({ BILLING_SSO_PRIVATE_KEY: pem, BILLING_SSO_KID: KID });
      assert.deepEqual(result, {
        ok: false,
        errors: ["BILLING_SSO_PRIVATE_KEY must be an Ed25519 private key in PKCS#8 PEM"],
      });
    }
    const badKid = readHandoffSigningKey({
      BILLING_SSO_PRIVATE_KEY: ed.pem,
      BILLING_SSO_KID: "a kid",
    });
    assert.deepEqual(badKid, {
      ok: false,
      errors: ["BILLING_SSO_KID must be 1 to 64 of A-Z a-z 0-9 . _ -"],
    });
  });
});
