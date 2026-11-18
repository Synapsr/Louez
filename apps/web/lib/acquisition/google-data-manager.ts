/**
 * Google's Data Manager API, for one thing: uploading the "account created" conversion
 * of an ad click (`events:ingest`) into Louez's own Google Ads account. Data Manager,
 * not the Google Ads API's UploadClickConversions: since 15 June 2026 a developer token
 * that had not uploaded offline conversions before is refused there
 * (CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE), and Google sends new integrations to
 * Data Manager. https://developers.google.com/data-manager/api/devguides/events
 *
 * It signs in as a service account (OAuth 2.0 JWT bearer, scope datamanager), which
 * must be a user of the Google Ads account. No secret leaves this file: an error says
 * the HTTP status and Google's own message, never the key, the assertion or the token.
 */

import { createSign } from "node:crypto";

import type {
  GoogleAdsConversionsConfig,
  GoogleServiceAccount,
} from "@/lib/acquisition/google-ads-config";
import type { PendingGoogleAdsConversion } from "@/lib/acquisition/google-ads-conversion";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DATA_MANAGER_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";

/** Each call's time limit, well inside the upload's 5-minute lease. */
const CALL_TIMEOUT_MS = 20_000;
/** The longest error text kept: Google's message, never a whole response. */
const MAX_ERROR_LENGTH = 500;

/** The conversion as the upload sends it: no name, no address, only the click. */
export type UploadedConversion = Pick<
  PendingGoogleAdsConversion,
  | "userId"
  | "clickIdType"
  | "clickId"
  | "convertedAt"
  | "adUserDataConsent"
  | "adPersonalizationConsent"
>;

const CONSENT = { granted: "CONSENT_GRANTED", denied: "CONSENT_DENIED" } as const;

/**
 * The `events:ingest` body of one conversion. Its transaction id is the account's id:
 * Google keeps the first event of a transaction id per conversion action, so an upload
 * run twice counts once. No value is sent: the conversion action's default applies.
 */
export function ingestRequestBody(
  config: GoogleAdsConversionsConfig,
  conversion: UploadedConversion,
  options: { validateOnly?: boolean } = {},
) {
  return {
    destinations: [
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: config.customerId },
        ...(config.loginCustomerId
          ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: config.loginCustomerId } }
          : {}),
        productDestinationId: config.conversionActionId,
      },
    ],
    events: [
      {
        transactionId: conversion.userId,
        eventTimestamp: conversion.convertedAt.toISOString(),
        eventSource: "WEB",
        adIdentifiers: { [conversion.clickIdType]: conversion.clickId },
        consent: {
          adUserData: CONSENT[conversion.adUserDataConsent],
          adPersonalization: CONSENT[conversion.adPersonalizationConsent],
        },
      },
    ],
    validateOnly: options.validateOnly ?? false,
  };
}

/** A failed call: what Google answered, never a credential. */
export class DataManagerError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or null when no answer came. */
    readonly status: number | null,
  ) {
    super(message.slice(0, MAX_ERROR_LENGTH));
    this.name = "DataManagerError";
  }
}

export interface DataManagerClient {
  /** Uploads one conversion. Google's request id, for its diagnostics. */
  ingest(
    conversion: UploadedConversion,
    options?: { validateOnly?: boolean },
  ): Promise<{ requestId: string | null }>;
}

type Fetch = typeof fetch;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed JWT a service account trades for an access token (RFC 7523). */
function signedAssertion(account: GoogleServiceAccount, nowMs: number) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: DATA_MANAGER_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(account.privateKey)
    .toString("base64url");
  return `${header}.${claims}.${signature}`;
}

/** Google's own words for a failed call, from its JSON error; the status otherwise. */
async function describeFailure(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return `HTTP ${response.status}`;
  }
  const record = (body ?? {}) as Record<string, unknown>;
  // The token endpoint: { error, error_description }.
  if (typeof record.error === "string") {
    const description =
      typeof record.error_description === "string" ? `: ${record.error_description}` : "";
    return `HTTP ${response.status} ${record.error}${description}`;
  }
  // Google APIs: { error: { code, status, message, details: [BadRequest…] } }.
  const error = (record.error ?? {}) as Record<string, unknown>;
  const parts = [`HTTP ${response.status}`];
  if (typeof error.status === "string") parts.push(error.status);
  if (typeof error.message === "string") parts.push(error.message);
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations as Array<Record<string, unknown>>) {
      parts.push(`${String(violation.field ?? "")}: ${String(violation.description ?? "")}`);
    }
  }
  return parts.join(" — ");
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    throw new DataManagerError(`No answer from ${new URL(url).host} (${name})`, null);
  }
}

export function createDataManagerClient(
  config: GoogleAdsConversionsConfig,
  options: { fetch?: Fetch; now?: () => number } = {},
): DataManagerClient {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    // A minute of margin: a token is never used in its last minute.
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const response = await call(fetchImpl, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signedAssertion(config.serviceAccount, now()),
      }),
    });
    if (!response.ok) {
      throw new DataManagerError(
        `Token refused: ${await describeFailure(response)}`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") {
      throw new DataManagerError("Token refused: no access_token in the answer", response.status);
    }
    const lifetimeS = typeof body.expires_in === "number" ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + lifetimeS * 1000 };
    return token.value;
  }

  return {
    async ingest(conversion, ingestOptions = {}) {
      const response = await call(fetchImpl, DATA_MANAGER_INGEST_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(ingestRequestBody(config, conversion, ingestOptions)),
      });
      if (!response.ok) {
        throw new DataManagerError(
          `Upload refused: ${await describeFailure(response)}`,
          response.status,
        );
      }
      const body = (await response.json().catch(() => ({}))) as { requestId?: unknown };
      return { requestId: typeof body.requestId === "string" ? body.requestId : null };
    },
  };
}
