import { type KeyObject, createPrivateKey, randomUUID, sign } from "node:crypto";

import { BILLING_RETURN_PATH } from "@/lib/billing/billing-return";
import { readHandoffPage } from "@/lib/billing/billing-routes";

// The hand-off token (louez-billing docs/api, README §10 step 2 and §4.3; openapi
// `HandoffTokenHeader` and `HandoffTokenClaims`): a compact JWS signed with Ed25519,
// valid 60 seconds, used once. It carries no email and no name (README §11, Q1).
// Signed with node:crypto: the service verifies it with jose, against the public key
// of the same kid in its LOUEZ_SSO_PUBLIC_KEYS.

/** `exp − iat`: the service refuses more (README §10 step 3). */
export const HANDOFF_TOKEN_LIFETIME_SECONDS = 60;

/** Platform admin sessions are read-only on the billing pages. */
export type HandoffRole = "owner" | "platform_admin";

export type HandoffSigningKey = {
  readonly kid: string;
  readonly privateKey: KeyObject;
};

/** The claims of openapi `HandoffTokenClaims`, all required, nothing else. */
export type HandoffClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly store_id: string;
  readonly role: HandoffRole;
  readonly locale: string;
  readonly to: string;
  readonly return_url: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
};

/** `LouezId`, `KeyId` and the locale of openapi.yaml. */
const LOUEZ_ID = /^[A-Za-z0-9_-]{1,32}$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const LOCALE = /^[a-z]{2}$/;

export type HandoffKeyResult =
  | { readonly ok: true; readonly key: HandoffSigningKey }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/** A PEM pasted on one line, with `\n` for its line breaks, reads as the PEM. */
const unescapePem = (raw: string) => raw.trim().replaceAll("\\n", "\n");

/**
 * Checks BILLING_SSO_PRIVATE_KEY (an Ed25519 private key, PKCS#8 PEM) and
 * BILLING_SSO_KID (README §4.3). Required in service mode from M2 (README §12); the
 * errors name the variable and the rule, never the value.
 */
export function readHandoffSigningKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HandoffKeyResult {
  const errors: string[] = [];
  let privateKey: KeyObject | null = null;
  const pem = env.BILLING_SSO_PRIVATE_KEY?.trim() ? unescapePem(env.BILLING_SSO_PRIVATE_KEY) : "";
  if (!pem) {
    errors.push("BILLING_SSO_PRIVATE_KEY is required");
  } else {
    try {
      const key = createPrivateKey({ key: pem, format: "pem" });
      if (key.asymmetricKeyType === "ed25519" && pem.startsWith("-----BEGIN PRIVATE KEY-----")) {
        privateKey = key;
      }
    } catch {
      // Not a private key PEM: reported below.
    }
    if (!privateKey) {
      errors.push("BILLING_SSO_PRIVATE_KEY must be an Ed25519 private key in PKCS#8 PEM");
    }
  }
  const kid = env.BILLING_SSO_KID?.trim() ?? "";
  if (!kid) {
    errors.push("BILLING_SSO_KID is required");
  } else if (!KID.test(kid)) {
    errors.push("BILLING_SSO_KID must be 1 to 64 of A-Z a-z 0-9 . _ -");
  }
  if (errors.length > 0 || !privateKey) return { ok: false, errors };
  return { ok: true, key: { kid, privateKey } };
}

let cached: { key: string; result: HandoffKeyResult } | null = null;

/** The checked signing key; throws with every error when it is not valid. */
export function handoffSigningKey(): HandoffSigningKey {
  const key = [process.env.BILLING_SSO_PRIVATE_KEY, process.env.BILLING_SSO_KID].join("\u0000");
  if (cached?.key !== key) cached = { key, result: readHandoffSigningKey() };
  const { result } = cached;
  if (!result.ok)
    throw new Error(`the billing hand-off is misconfigured: ${result.errors.join("; ")}`);
  return result.key;
}

export type HandoffClaimsInput = {
  /** Louez's dashboard origin: `iss`, and the origin of `return_url`. */
  readonly dashboardOrigin: string;
  /** The billing pages' origin: `aud`. */
  readonly billingOrigin: string;
  readonly userId: string;
  readonly storeId: string;
  readonly role: HandoffRole;
  /** The user's dashboard language. */
  readonly locale: string;
  /** The billing page to open; anything but one of them opens the overview `/`. */
  readonly to: string | null;
  readonly now: Date;
};

/**
 * The claims of one hand-off (README §10, "Token claims"). Throws when an id or the
 * locale does not fit the contract, rather than mint a token the service refuses.
 */
export function buildHandoffClaims(input: HandoffClaimsInput): HandoffClaims {
  if (!LOUEZ_ID.test(input.userId)) throw new Error("the user id is not a contract LouezId");
  if (!LOUEZ_ID.test(input.storeId)) throw new Error(`store ${input.storeId} is not a LouezId`);
  if (!LOCALE.test(input.locale)) throw new Error(`locale ${input.locale} is not two letters`);
  const iat = Math.floor(input.now.getTime() / 1000);
  return {
    iss: input.dashboardOrigin,
    aud: input.billingOrigin,
    sub: input.userId,
    store_id: input.storeId,
    role: input.role,
    locale: input.locale,
    to: readHandoffPage(input.to),
    return_url: `${input.dashboardOrigin}${BILLING_RETURN_PATH}`,
    jti: randomUUID(),
    iat,
    exp: iat + HANDOFF_TOKEN_LIFETIME_SECONDS,
  };
}

const base64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

/** The compact JWS of `claims`: header `alg: EdDSA`, `typ: JWT` and the key's `kid`. */
export function mintHandoffToken(claims: HandoffClaims, key: HandoffSigningKey): string {
  const header = { alg: "EdDSA", typ: "JWT", kid: key.kid };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  return `${input}.${base64url(sign(null, Buffer.from(input), key.privateKey))}`;
}
