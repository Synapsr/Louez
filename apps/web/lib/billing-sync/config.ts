import { isBillingSyncEnabled } from "@louez/db";

// Louez's configuration for the billing service (louez-billing docs/api, README §4.3
// and §12). Read from process.env at call time, like lib/billing/mode.ts.

export { isBillingSyncEnabled };

/** The test secrets printed in the API docs. Both sides refuse to start with them. */
const TEST_SECRETS = new Set([
  "test-request-secret-not-for-production",
  "test-response-secret-not-for-production",
]);
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type KeyRing = ReadonlyMap<string, string>;

export type BillingSyncConfig = {
  /** The service origin, such as `https://billing.louez.io`. */
  readonly origin: string;
  /** The host part of the signed strings: lower case, with a non-default port. */
  readonly signingHost: string;
  readonly outboundKeys: KeyRing;
  readonly activeKid: string;
  readonly responseKeys: KeyRing;
  /** Stores created at or after it are new: never billed by Louez's legacy code. */
  readonly newStoresFrom: Date;
};

export type ConfigResult =
  | { readonly ok: true; readonly config: BillingSyncConfig }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

function keyRing(name: string, raw: string | undefined, prefix: string, errors: string[]): KeyRing {
  const ring = new Map<string, string>();
  if (!raw?.trim()) {
    errors.push(`${name} is required`);
    return ring;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push(`${name} must be a JSON object {"<kid>": "<secret>"}`);
    return ring;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push(`${name} must be a JSON object {"<kid>": "<secret>"}`);
    return ring;
  }
  for (const [kid, secret] of Object.entries(parsed)) {
    if (!KID.test(kid) || !kid.startsWith(prefix)) {
      errors.push(
        `${name} has a kid that is not 1 to 64 of A-Z a-z 0-9 . _ - starting with ${prefix}`,
      );
    } else if (typeof secret !== "string" || secret.length < 32) {
      errors.push(`${name} has a secret shorter than 32 characters`);
    } else if (TEST_SECRETS.has(secret)) {
      errors.push(`${name} uses a test secret from the API docs`);
    } else {
      ring.set(kid, secret);
    }
  }
  if (ring.size === 0 && !errors.some((error) => error.startsWith(name))) {
    errors.push(`${name} must hold at least one key`);
  }
  return ring;
}

/** Checks the BILLING_* variables. Only meaningful when sync is enabled. */
export function readBillingSyncConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const errors: string[] = [];
  let origin = "";
  let signingHost = "";
  try {
    const url = new URL(env.BILLING_SERVICE_URL ?? "");
    const https = url.protocol === "https:";
    // README §2: plain HTTP only to a loopback host, and never in production.
    const devLoopback =
      env.NODE_ENV !== "production" && url.protocol === "http:" && LOOPBACK.has(url.hostname);
    if (!https && !devLoopback) {
      errors.push("BILLING_SERVICE_URL must use https, except a loopback host in development");
    } else if (url.pathname !== "/" || url.search || url.hash) {
      errors.push("BILLING_SERVICE_URL must be an origin, with no path");
    }
    origin = url.origin;
    signingHost = url.port
      ? `${url.hostname.toLowerCase()}:${url.port}`
      : url.hostname.toLowerCase();
  } catch {
    errors.push("BILLING_SERVICE_URL must be a URL");
  }
  const outboundKeys = keyRing(
    "BILLING_OUTBOUND_KEYS",
    env.BILLING_OUTBOUND_KEYS,
    "louez-req-",
    errors,
  );
  const responseKeys = keyRing(
    "BILLING_RESPONSE_KEYS",
    env.BILLING_RESPONSE_KEYS,
    "billing-res-",
    errors,
  );
  const activeKid = env.BILLING_OUTBOUND_ACTIVE_KID?.trim() ?? "";
  if (!outboundKeys.has(activeKid)) {
    errors.push("BILLING_OUTBOUND_ACTIVE_KID must be one of the kids in BILLING_OUTBOUND_KEYS");
  }
  for (const secret of outboundKeys.values()) {
    if ([...responseKeys.values()].includes(secret)) {
      errors.push("BILLING_OUTBOUND_KEYS and BILLING_RESPONSE_KEYS must not share a secret");
      break;
    }
  }
  const newStoresFrom = new Date(env.BILLING_NEW_STORES_FROM ?? "");
  if (!env.BILLING_NEW_STORES_FROM || Number.isNaN(newStoresFrom.getTime())) {
    errors.push("BILLING_NEW_STORES_FROM must be an ISO date, such as 2027-01-25T00:00:00Z");
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: { origin, signingHost, outboundKeys, activeKid, responseKeys, newStoresFrom },
  };
}

let cached: { key: string; result: ConfigResult } | null = null;

/** The checked configuration; throws with every error when it is not valid. */
export function billingSyncConfig(): BillingSyncConfig {
  const key = [
    process.env.NODE_ENV,
    process.env.BILLING_SERVICE_URL,
    process.env.BILLING_OUTBOUND_KEYS,
    process.env.BILLING_OUTBOUND_ACTIVE_KID,
    process.env.BILLING_RESPONSE_KEYS,
    process.env.BILLING_NEW_STORES_FROM,
  ].join("\u0000");
  if (cached?.key !== key) cached = { key, result: readBillingSyncConfig() };
  const { result } = cached;
  if (!result.ok) throw new Error(`billing sync is misconfigured: ${result.errors.join("; ")}`);
  return result.config;
}
