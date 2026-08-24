import { pdpSupportedCountries, type StoreLegalProfileInput } from "@louez/validations";

import type { SuperPdpEnrollment } from "./queries";
import { isLegalIdentityComplete } from "./util.legal-profile-form";

/** Settings page the OAuth routes send the merchant back to. */
export const PDP_RETURN_PATH = "/dashboard/settings/invoicing";

/**
 * Redirect route that starts the Super PDP OAuth enrollment.
 * It is a route handler, so it must be reached with a plain document request.
 */
export const PDP_ENROLLMENT_START_HREF = `/api/integrations/superpdp/oauth/start?returnTo=${encodeURIComponent(
  PDP_RETURN_PATH,
)}`;

/** Why the enrollment cannot be started yet. */
export type PdpLockReason = "identityIncomplete" | "countryUnsupported";

export type PdpTransmissionState = "notConnected" | "pending" | "connected" | "actionRequired";

export type PdpErrorHint = "reconnectRequired" | "oauthFailed" | "operationFailed";

export type PdpVerificationStatus = "verified" | "failed" | "pending";

export type PdpTransmissionView = {
  /** Hint shown next to the reconnect call to action. */
  errorHint: PdpErrorHint | null;
  /** `null` when every prerequisite is met and the enrollment can be started. */
  lockReason: PdpLockReason | null;
  state: PdpTransmissionState;
  /** Only meaningful in the `connected` state. */
  verificationStatus: PdpVerificationStatus;
};

const isPdpSupportedCountry = (country: string): boolean =>
  pdpSupportedCountries.some((supported) => supported === country);

/**
 * Enrollment needs a complete legal identity (the PDP performs KYB on it)
 * and a country covered by the network. Receiving invoices does not require
 * Louez to issue the store's invoices.
 */
const resolveLockReason = (profile: StoreLegalProfileInput): PdpLockReason | null => {
  if (!isLegalIdentityComplete(profile)) return "identityIncomplete";
  if (!isPdpSupportedCountry(profile.country)) return "countryUnsupported";
  return null;
};

/** Integration health, mapped onto the four states step 3 can render. */
const resolveState = (enrollment: SuperPdpEnrollment | null): PdpTransmissionState => {
  if (!enrollment || !enrollment.enabled) return "notConnected";

  switch (enrollment.status) {
    case "active":
      return "connected";
    case "syncing":
      return "pending";
    case "needs_reconnect":
    case "error":
      return "actionRequired";
    case "disabled":
      return "notConnected";
  }
};

const resolveErrorHint = (enrollment: SuperPdpEnrollment): PdpErrorHint => {
  if (enrollment.lastErrorCode === "superpdp_oauth_failed") return "oauthFailed";
  if (
    enrollment.status === "needs_reconnect" ||
    enrollment.lastErrorCode === "superpdp_reconnect_required"
  ) {
    return "reconnectRequired";
  }
  return "operationFailed";
};

/** The provider returns a free-form status; only two values are actionable. */
const resolveVerificationStatus = (status: string | null): PdpVerificationStatus => {
  if (status === "verified") return "verified";
  if (status === "failed") return "failed";
  return "pending";
};

/** Single source of truth for what step 3 renders. */
export const resolvePdpTransmissionView = ({
  enrollment,
  profile,
}: {
  enrollment: SuperPdpEnrollment | null;
  profile: StoreLegalProfileInput;
}): PdpTransmissionView => {
  const state = resolveState(enrollment);

  return {
    errorHint: enrollment && state === "actionRequired" ? resolveErrorHint(enrollment) : null,
    lockReason: resolveLockReason(profile),
    state,
    verificationStatus: resolveVerificationStatus(enrollment?.companyVerificationStatus ?? null),
  };
};

/** Outcome the OAuth routes append to `returnTo` when they send the merchant back. */
export type PdpEnrollmentResult =
  | { kind: "success" }
  | {
      kind: "error";
      reason: "oauth" | "permissionDenied" | "legalProfileIncomplete" | "notConfigured" | "generic";
    };

const errorReasons: Record<string, Extract<PdpEnrollmentResult, { kind: "error" }>["reason"]> = {
  legalProfileIncomplete: "legalProfileIncomplete",
  oauth: "oauth",
  permissionDenied: "permissionDenied",
  superPdpNotConfigured: "notConfigured",
};

/** Read the `connected` / `error` query parameters left by the OAuth routes. */
export const resolvePdpEnrollmentResult = (params: {
  connected?: string;
  error?: string;
}): PdpEnrollmentResult | null => {
  if (params.connected === "superpdp") return { kind: "success" };
  if (!params.error) return null;
  return { kind: "error", reason: errorReasons[params.error] ?? "generic" };
};
