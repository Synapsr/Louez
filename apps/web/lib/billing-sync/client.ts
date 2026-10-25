import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { sha256Hex } from "@/lib/billing-sync/canonical-json";
import { type BillingSyncConfig, type KeyRing, billingSyncConfig } from "@/lib/billing-sync/config";

// The signed HTTP client for the billing service (louez-billing docs/api, README §4).
// Requests are HMAC-signed with an outbound key; every response Louez acts on is
// verified with a response key before its body is parsed.

export const BILLING_CONTRACT = "1";
export const BILLING_API_PREFIX = "/api/v1/louez";

const REQUEST_LABEL = "louez-billing.req.v1";
const RESPONSE_LABEL = "louez-billing.res.v1";
const RESPONSE_WINDOW_SECONDS = 300;
const UNIX_SECONDS = /^[1-9][0-9]{0,11}$/;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/;
const RETRY_AFTER_MAX_SECONDS = 3600;

/** Louez's timeout per endpoint (README §1). */
export const BILLING_TIMEOUTS_MS = {
  events: 10_000,
  heartbeat: 10_000,
  manifests: 30_000,
  policies: 30_000,
  health: 5_000,
} as const;

export type BillingEndpoint = keyof typeof BILLING_TIMEOUTS_MS;

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(message, "utf8").digest("hex");
}

/** The seven parts of README §4.1, joined with line feeds. */
export function requestSigningString(parts: {
  readonly timestamp: string;
  readonly method: "GET" | "POST";
  readonly host: string;
  readonly pathAndQuery: string;
  readonly contract: string;
  readonly ifNoneMatch: string;
  readonly bodyHash: string;
}): string {
  return [
    REQUEST_LABEL,
    parts.timestamp,
    parts.method,
    `${parts.host}${parts.pathAndQuery}`,
    parts.contract,
    parts.ifNoneMatch,
    parts.bodyHash,
  ].join("\n");
}

/** The five parts of README §4.2, joined with line feeds. */
export function responseSigningString(parts: {
  readonly timestamp: string;
  readonly status: number;
  readonly requestSignature: string;
  readonly bodyHash: string;
}): string {
  return [
    RESPONSE_LABEL,
    parts.timestamp,
    String(parts.status),
    parts.requestSignature,
    parts.bodyHash,
  ].join("\n");
}

export type SignatureCheck =
  | { readonly ok: true; readonly kid: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Verifies a response signature (README §4.2): the kid must be a configured response
 * key and `Billing-Timestamp` within 300 seconds of `nowSeconds`.
 */
export function verifyResponseSignature(input: {
  readonly headers: { get(name: string): string | null };
  readonly status: number;
  readonly body: Uint8Array;
  readonly requestSignature: string;
  readonly responseKeys: KeyRing;
  readonly nowSeconds: number;
}): SignatureCheck {
  const kid = input.headers.get("billing-key-id");
  const timestamp = input.headers.get("billing-timestamp");
  const signature = input.headers.get("billing-signature");
  if (!kid || !timestamp || !signature) return { ok: false, reason: "response is not signed" };
  const secret = input.responseKeys.get(kid);
  if (secret === undefined) return { ok: false, reason: `unknown response kid ${kid}` };
  if (!UNIX_SECONDS.test(timestamp)) return { ok: false, reason: "malformed Billing-Timestamp" };
  if (Math.abs(input.nowSeconds - Number(timestamp)) > RESPONSE_WINDOW_SECONDS) {
    return { ok: false, reason: "Billing-Timestamp is outside the 300-second window" };
  }
  if (!HEX_SIGNATURE.test(signature)) return { ok: false, reason: "malformed Billing-Signature" };
  const expected = hmacHex(
    secret,
    responseSigningString({
      timestamp,
      status: input.status,
      requestSignature: input.requestSignature,
      bodyHash: sha256Hex(input.body),
    }),
  );
  const matches = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  return matches ? { ok: true, kid } : { ok: false, reason: "invalid response signature" };
}

export type BillingClientOptions = {
  readonly config?: BillingSyncConfig;
  readonly fetch?: typeof fetch;
};

export type BillingRequest = {
  readonly endpoint: Exclude<BillingEndpoint, "health">;
  readonly method: "GET" | "POST";
  /** After the API prefix, such as `/events`. */
  readonly path: string;
  /** The query string without `?`, sent and signed byte for byte. */
  readonly query?: string;
  /** The JSON body of a POST, already serialized. */
  readonly json?: string;
  /** The exact `If-None-Match` value, quotes included. */
  readonly ifNoneMatch?: string;
};

export type BillingResponse = {
  readonly kind: "response";
  readonly status: number;
  readonly body: Buffer;
  readonly signature: SignatureCheck;
  /** `Retry-After` in seconds, capped at an hour, or null. */
  readonly retryAfterSeconds: number | null;
  readonly requestId: string | null;
};

export type BillingNetworkFailure = {
  readonly kind: "network";
  /** True when Louez's timeout fired, which counts like a 5xx (README §6). */
  readonly timeout: boolean;
  readonly message: string;
};

export type BillingCallResult = BillingResponse | BillingNetworkFailure;

// Signatures sent in the current second. Two identical requests in one second would
// carry the same signature, and the service would refuse the second as a replay.
const recentSignatures = new Map<string, number>();

function rememberSignature(signature: string, seconds: number): boolean {
  for (const [known, at] of recentSignatures) {
    if (at < seconds) recentSignatures.delete(known);
  }
  if (recentSignatures.has(signature)) return false;
  recentSignatures.set(signature, seconds);
  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function readRetryAfter(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(1, Number(value.trim())));
}

/**
 * Sends one signed request and reads the whole answer. Never throws for a network
 * error, a timeout or a redirect: those come back as `{ kind: "network" }`.
 */
export async function callBillingService(
  request: BillingRequest,
  options: BillingClientOptions = {},
): Promise<BillingCallResult> {
  const config = options.config ?? billingSyncConfig();
  const fetchImpl = options.fetch ?? fetch;
  const secret = config.outboundKeys.get(config.activeKid);
  if (secret === undefined) throw new Error("BILLING_OUTBOUND_ACTIVE_KID has no secret");

  const pathAndQuery = `${BILLING_API_PREFIX}${request.path}${request.query ? `?${request.query}` : ""}`;
  const body = Buffer.from(request.json ?? "", "utf8");
  const bodyHash = sha256Hex(body);
  const ifNoneMatch = request.ifNoneMatch ?? "";

  let timestamp = "";
  let signature = "";
  for (;;) {
    const seconds = Math.floor(Date.now() / 1000);
    timestamp = String(seconds);
    signature = hmacHex(
      secret,
      requestSigningString({
        timestamp,
        method: request.method,
        host: config.signingHost,
        pathAndQuery,
        contract: BILLING_CONTRACT,
        ifNoneMatch,
        bodyHash,
      }),
    );
    if (rememberSignature(signature, seconds)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 5));
  }

  const headers = new Headers({
    "Louez-Key-Id": config.activeKid,
    "Louez-Timestamp": timestamp,
    "Louez-Signature": signature,
    "Louez-Contract": BILLING_CONTRACT,
    Accept: "application/json",
  });
  if (request.method === "POST") headers.set("Content-Type", "application/json");
  if (request.ifNoneMatch !== undefined) headers.set("If-None-Match", request.ifNoneMatch);

  try {
    const response = await fetchImpl(`${config.origin}${pathAndQuery}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? body : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(BILLING_TIMEOUTS_MS[request.endpoint]),
    });
    // The bytes as received (after decompression), verified before any parsing.
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      kind: "response",
      status: response.status,
      body: bytes,
      signature: verifyResponseSignature({
        headers: response.headers,
        status: response.status,
        body: bytes,
        requestSignature: signature,
        responseKeys: config.responseKeys,
        nowSeconds: Math.floor(Date.now() / 1000),
      }),
      retryAfterSeconds: readRetryAfter(response.headers.get("retry-after")),
      requestId: response.headers.get("billing-request-id"),
    };
  } catch (error) {
    return { kind: "network", timeout: isTimeout(error), message: errorMessage(error) };
  }
}

/** `GET /health`, unsigned: true when the service and its database answer. */
export async function checkBillingHealth(options: BillingClientOptions = {}): Promise<boolean> {
  const config = options.config ?? billingSyncConfig();
  const fetchImpl = options.fetch ?? fetch;
  try {
    const response = await fetchImpl(`${config.origin}${BILLING_API_PREFIX}/health`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(BILLING_TIMEOUTS_MS.health),
    });
    await response.arrayBuffer();
    return response.status === 200;
  } catch {
    return false;
  }
}

/** Parses a verified JSON body. A response that failed its check is never parsed. */
export function readSignedJson<T>(
  response: BillingResponse,
  schema: z.ZodType<T>,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string } {
  if (!response.signature.ok) return { ok: false, reason: response.signature.reason };
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    return { ok: false, reason: "the body is not JSON" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      reason: `the body does not match the contract at /${issue?.path.join("/") ?? ""}`,
    };
  }
  return { ok: true, value: result.data };
}

const problemSchema = z.object({ code: z.string() });

/** The `code` of a problem body, signed or not. Only used to word logs and alerts. */
export function readProblemCode(response: BillingResponse): string | null {
  try {
    const result = problemSchema.safeParse(JSON.parse(response.body.toString("utf8")));
    return result.success ? result.data.code : null;
  } catch {
    return null;
  }
}

/** A short description of a failed call, for logs and `last_error`. */
export function describeCall(result: BillingCallResult): string {
  if (result.kind === "network") return result.timeout ? "timeout" : result.message;
  const code = readProblemCode(result);
  const id = result.requestId ? ` (request ${result.requestId})` : "";
  return `HTTP ${result.status}${code ? ` ${code}` : ""}${id}`;
}

/** What every task does with an answer it cannot use (README §6). */
export type CallFailure =
  | { readonly kind: "retry_after"; readonly seconds: number; readonly detail: string }
  | { readonly kind: "auth"; readonly detail: string }
  | { readonly kind: "contract"; readonly detail: string }
  | { readonly kind: "transport"; readonly serverError: boolean; readonly detail: string };

/**
 * Classifies a call that did not give Louez a usable answer. `429` or `503` with
 * `Retry-After` waits; a `401` other than a replay or a `406` stops and alerts;
 * the rest is a transport failure (`serverError` for a 5xx or a timeout).
 */
export function classifyFailure(result: BillingCallResult): CallFailure {
  const detail = describeCall(result);
  if (result.kind === "network") return { kind: "transport", serverError: result.timeout, detail };
  if ((result.status === 429 || result.status === 503) && result.retryAfterSeconds !== null) {
    return { kind: "retry_after", seconds: result.retryAfterSeconds, detail };
  }
  if (result.status === 401) {
    return readProblemCode(result) === "replayed_request"
      ? { kind: "transport", serverError: false, detail }
      : { kind: "auth", detail };
  }
  if (result.status === 406) return { kind: "contract", detail };
  return { kind: "transport", serverError: result.status >= 500, detail };
}
