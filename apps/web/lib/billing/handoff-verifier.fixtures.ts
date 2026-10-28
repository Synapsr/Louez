import type { KeyObject } from "node:crypto";
import { verify } from "node:crypto";

// The billing service's checks of a hand-off token (louez-billing docs/api, README §10
// step 3; openapi `/sso`, `HandoffTokenHeader`, `HandoffTokenClaims`), in the order of
// its verifier (packages/core/src/billing/handoff-token.ts there), written out with
// node:crypto for the tests: Louez imports no service code.

/** The patterns of openapi.yaml. */
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LOUEZ_ID = /^[A-Za-z0-9_-]{1,32}$/;
const PAGE = /^\/(payment-method|statements(\/[A-Za-z0-9_-]{1,40})?|details)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The claims of `HandoffTokenClaims`, sorted: all required, and the token has no other. */
export const HANDOFF_CLAIM_NAMES = [
  "aud",
  "exp",
  "iat",
  "iss",
  "jti",
  "locale",
  "return_url",
  "role",
  "store_id",
  "sub",
  "to",
];

export type ServiceRules = {
  /** `LOUEZ_SSO_PUBLIC_KEYS`, by kid. */
  readonly keys: ReadonlyMap<string, KeyObject>;
  /** `LOUEZ_DASHBOARD_ORIGIN`. */
  readonly dashboardOrigin: string;
  /** `BILLING_PUBLIC_ORIGIN`. */
  readonly billingOrigin: string;
  readonly nowSeconds: number;
};

/** One part of a compact JWS, decoded. */
export const decodeTokenPart = (token: string, index: 0 | 1): unknown =>
  JSON.parse(Buffer.from(token.split(".")[index] ?? "", "base64url").toString("utf8"));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The claims of `token`, unverified: for assertions once `serviceRefusal` passed. */
export function decodeTokenClaims(token: string): Record<string, unknown> {
  const claims = decodeTokenPart(token, 1);
  if (!isRecord(claims)) throw new Error("the token's claims are not an object");
  return claims;
}

const matches = (value: unknown, pattern: RegExp) =>
  typeof value === "string" && pattern.test(value);

function isReturnUrl(value: unknown, dashboardOrigin: string): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).href === `${dashboardOrigin}/dashboard/billing/return`;
  } catch {
    return false;
  }
}

/** The service's refusal of `token`, or null when it accepts it. */
export function serviceRefusal(token: string, rules: ServiceRules): string | null {
  if (token.length > 4096 || !JWS.test(token)) return "malformed";
  const [header = "", payload = "", signature = ""] = token.split(".");
  const head = decodeTokenPart(token, 0);
  if (!isRecord(head) || head.typ !== "JWT") return "malformed";
  if (head.alg !== "EdDSA") return "algorithm";
  // The service ignores these; Louez never sends them.
  if (["jku", "x5u", "jwk"].some((name) => name in head)) return "foreign key header";
  const key = typeof head.kid === "string" ? rules.keys.get(head.kid) : undefined;
  if (!key) return "kid";
  const input = Buffer.from(`${header}.${payload}`);
  if (!verify(null, input, key, Buffer.from(signature, "base64url"))) return "signature";

  const claims = decodeTokenPart(token, 1);
  if (!isRecord(claims)) return "malformed";
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number") return "malformed";
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return "malformed";
  if (!matches(claims.sub, LOUEZ_ID) || !matches(claims.store_id, LOUEZ_ID)) return "malformed";
  if (!matches(claims.locale, /^[a-z]{2}$/) || !matches(claims.to, PAGE)) return "malformed";
  if (!matches(claims.jti, UUID) || typeof claims.return_url !== "string") return "malformed";
  if (typeof claims.iss !== "string" || typeof claims.aud !== "string") return "malformed";
  if (claims.iss !== rules.dashboardOrigin) return "issuer";
  if (claims.aud !== rules.billingOrigin) return "audience";
  if (rules.nowSeconds >= exp) return "expired";
  if (Math.abs(rules.nowSeconds - iat) > 30) return "issued_at";
  if (exp <= iat || exp - iat > 60) return "lifetime";
  if (!isReturnUrl(claims.return_url, rules.dashboardOrigin)) return "return_url";
  if (claims.role !== "owner" && claims.role !== "platform_admin") return "role";
  return null;
}
