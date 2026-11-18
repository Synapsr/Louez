/**
 * The configuration of the Google Ads "account created" conversion
 * (docs/analytics/lifecycle.md). Off unless GOOGLE_ADS_CONVERSIONS_ENABLED is "true"
 * and the customer id, the conversion action id and the service account key are all
 * set and valid: a self-hosted instance, which sets none of them, sends nothing.
 *
 * Pure: the caller passes the variables (lib/acquisition/google-ads-conversion-record.ts
 * reads them from the env), so a test passes its own.
 */

import { z } from "zod";

export interface GoogleAdsConversionsEnv {
  GOOGLE_ADS_CONVERSIONS_ENABLED?: string | undefined;
  GOOGLE_ADS_CUSTOMER_ID?: string | undefined;
  GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID?: string | undefined;
  GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY?: string | undefined;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string | undefined;
}

/** The service account that signs the upload's token request. */
export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export interface GoogleAdsConversionsConfig {
  /** The Google Ads account that receives the conversion: 10 digits, no dashes. */
  customerId: string;
  /** The "Compte créé" conversion action, type import from clicks (UPLOAD_CLICKS). */
  conversionActionId: string;
  /** A manager account the service account reaches the customer through, or null. */
  loginCustomerId: string | null;
  serviceAccount: GoogleServiceAccount;
}

export type GoogleAdsConversionsConfigResult =
  | { enabled: true; config: GoogleAdsConversionsConfig }
  /**
   * `not_enabled` when the flag is off (the normal case off Louez Cloud); otherwise the
   * flag is on and `reason` names the variable that is missing or wrong, never its value.
   */
  | { enabled: false; reason: string };

const CUSTOMER_ID = /^\d{10}$/;
const NUMERIC_ID = /^\d{1,20}$/;

/** What a Google service account's JSON key must hold; the rest of it is ignored. */
const serviceAccountKey = z.object({
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
});

/** A Google Ads customer id as typed (`965-816-3529`), without its dashes and spaces. */
const customerIdOf = (value: string | undefined) => value?.replace(/[\s-]/g, "") ?? "";

/** The key as JSON, or as base64 of the JSON (easier to paste into a single env line). */
function parseServiceAccountKey(raw: string): GoogleServiceAccount | null {
  const candidates = [raw.trim(), Buffer.from(raw.trim(), "base64").toString("utf8")];
  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = serviceAccountKey.safeParse(json);
    if (parsed.success) {
      return { clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key };
    }
  }
  return null;
}

export function readGoogleAdsConversionsConfig(
  source: GoogleAdsConversionsEnv,
): GoogleAdsConversionsConfigResult {
  if (source.GOOGLE_ADS_CONVERSIONS_ENABLED?.trim().toLowerCase() !== "true") {
    return { enabled: false, reason: "not_enabled" };
  }

  const customerId = customerIdOf(source.GOOGLE_ADS_CUSTOMER_ID);
  if (!CUSTOMER_ID.test(customerId)) {
    return { enabled: false, reason: "GOOGLE_ADS_CUSTOMER_ID is missing or not 10 digits" };
  }

  const conversionActionId = source.GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID?.trim() ?? "";
  if (!NUMERIC_ID.test(conversionActionId)) {
    return {
      enabled: false,
      reason: "GOOGLE_ADS_ACCOUNT_CREATED_CONVERSION_ACTION_ID is missing or not numeric",
    };
  }

  const loginCustomerId = customerIdOf(source.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (loginCustomerId && !CUSTOMER_ID.test(loginCustomerId)) {
    return { enabled: false, reason: "GOOGLE_ADS_LOGIN_CUSTOMER_ID is not 10 digits" };
  }

  const rawKey = source.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY;
  const serviceAccount = rawKey ? parseServiceAccountKey(rawKey) : null;
  if (!serviceAccount) {
    return {
      enabled: false,
      reason:
        "GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_KEY is missing or not a service account JSON key",
    };
  }

  return {
    enabled: true,
    config: {
      customerId,
      conversionActionId,
      loginCustomerId: loginCustomerId || null,
      serviceAccount,
    },
  };
}
